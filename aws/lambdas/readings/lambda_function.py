"""
IWM — Readings + Alerts Lambda
==============================

Serves live scale telemetry from the `IWM` DynamoDB table, plus everything
derived from it: dashboard totals, category breakdown, hourly/weekly trends,
and the alert engine.

    GET /readings                      raw rows (scoped by role)
    GET /dashboard/stats               today / yesterday / week totals
    GET /dashboard/alerts              computed alerts (see ALERT RULES)
    GET /analytics/category-breakdown  grouped by Message2 category
    GET /analytics/hourly-waste        kg by hour of day
    GET /analytics/weekly-trend        this week vs last week, per day

Query params: ?uid=DAL00001&from=2025-11-01&to=2025-11-30&days=7&limit=2000

Zero external dependencies — stdlib + boto3 (preinstalled in Lambda).

--------------------------------------------------------------------------
TABLE SHAPE (written by the existing ingest Lambda)
--------------------------------------------------------------------------
    UID                 partition key, e.g. "DAL00001"
    DateTime            sort key — UTC, e.g. "2025-06-12T17:22:00"
    Date                LOCAL date, "2025-06-12"
    Time                LOCAL time, "14:22:00"
    PerDepositWeight    Decimal
    RunningTotalWeight  Decimal
    Message1            device event, e.g. "Bin Dumped"
    Message2            waste category, e.g. "Overproduction"
    Message3            free text, lower-cased on ingest

The split is deliberate (see the ingest Lambda): the sort key is UTC so it can
be compared against server time, while Date/Time stay local so "today's total"
and "peak hours" reflect the kitchen's own day rather than drifting across
midnight UTC. This module honours that — windowing uses DateTime, all
daily/hourly aggregation uses Date and Time.

--------------------------------------------------------------------------
WHY THIS IS TIME-WINDOWED
--------------------------------------------------------------------------
The table holds ~250k items (~39 MB). Scanning it on every dashboard load
would take seconds and read the whole table each time, so instead:

* Every request works over a bounded window (default 7 days, max 365).
* Because DateTime is the sort key, readings for a known UID come back with a
  key condition — DynamoDB reads only the rows in range, not the whole table.
* The set of UIDs is discovered once via a projected scan and cached in module
  scope, so warm invocations skip it entirely.

That turns a ~39 MB full scan into a handful of small, indexed queries.

--------------------------------------------------------------------------
SCOPING
--------------------------------------------------------------------------
* Admins see EVERY UID present in the readings table, including devices never
  registered in iwm-scales. A scale emitting data that nobody provisioned is
  exactly what an operator needs to notice; filtering it out would hide it.
* Clients see only UIDs whose scale record is assigned to their organization,
  taken from their signed token — never from the request.

--------------------------------------------------------------------------
ALERT RULES
--------------------------------------------------------------------------
Three detectors run per device; the highest severity that fires wins.

  1. SINGLE DROP   one unexplained reading <= -10 kg  -> warning
                   one unexplained reading <= -100 kg -> critical
  2. SUSTAINED RUN >= 5  consecutive readings <= -10 kg  -> warning
                   >= 10 consecutive readings <= -100 kg -> critical
  3. DRIFT         >= 5  consecutive negative readings of any size -> warning

Rule 2 was the original specification. It is retained, but note that against
a full year of real telemetry it has never fired once: the longest observed
run below -10 kg is a single sample. Bin removals show up as one large
negative followed immediately by normal positive deposits, not as a sustained
decline — which is why rule 1 exists and is the one that actually triggers.

Readings whose Message1 explains the drop (Bin Dumped, System Tared, Mass
Removed) are excluded. Emptying a bin every night is normal operation, and
alerting on it would fire daily and train people to ignore the panel.

Every threshold is env-tunable; see below.

--------------------------------------------------------------------------
ENVIRONMENT VARIABLES
--------------------------------------------------------------------------
    READINGS_TABLE   default: IWM
    SCALES_TABLE     default: iwm-scales
    JWT_SECRET       REQUIRED — identical to the auth Lambda's
    ALLOWED_ORIGIN   default: *
    DEFAULT_DAYS     window when none requested       default: 7
    MAX_DAYS         largest window allowed           default: 365
    MAX_ROWS         rows returned by /readings       default: 2000
    WARN_RUN / WARN_KG   default: 5  / -10
    CRIT_RUN / CRIT_KG   default: 10 / -100
"""

import base64
import hashlib
import hmac
import json
import os
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

READINGS_TABLE = os.environ.get("READINGS_TABLE", "IWM")
SCALES_TABLE = os.environ.get("SCALES_TABLE", "iwm-scales")
JWT_SECRET = os.environ.get("JWT_SECRET", "")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

DEFAULT_DAYS = int(os.environ.get("DEFAULT_DAYS", "7"))
MAX_DAYS = int(os.environ.get("MAX_DAYS", "365"))
MAX_ROWS = int(os.environ.get("MAX_ROWS", "2000"))
# Half-width of the /readings/live band, in seconds (now ± this).
LIVE_WINDOW_SECONDS = int(os.environ.get("LIVE_WINDOW_SECONDS", "60"))

# Alerts are rare, so the endpoint widens its search until it finds some
# rather than reporting "none" when it just means "none this week".
ALERT_LOOKBACK_DAYS = [
    int(d) for d in os.environ.get("ALERT_LOOKBACK_DAYS", "7,30,90,365").split(",") if d.strip()
]

# --- Alert thresholds -----------------------------------------------------
# Three independent detectors, because real telemetry produces three different
# shapes of fault. Any one of them firing raises an alert for that device.
#
#   1. SINGLE  — one unexplained large drop. This is the detector that
#      actually fires in practice: a bin removal or theft shows up as a lone
#      big negative, immediately followed by normal positive deposits.
#   2. RUN     — several consecutive samples below a magnitude band. Kept
#      because it is the classic sustained-decline signature, even though the
#      current hardware has never produced one.
#   3. DRIFT   — a long run of small negatives, which is what a mis-calibrated
#      or slowly failing load cell looks like.
WARN_SINGLE_KG = float(os.environ.get("WARN_SINGLE_KG", "-10"))
CRIT_SINGLE_KG = float(os.environ.get("CRIT_SINGLE_KG", "-100"))

WARN_RUN = int(os.environ.get("WARN_RUN", "5"))
WARN_KG = float(os.environ.get("WARN_KG", "-10"))
CRIT_RUN = int(os.environ.get("CRIT_RUN", "10"))
CRIT_KG = float(os.environ.get("CRIT_KG", "-100"))

DRIFT_RUN = int(os.environ.get("DRIFT_RUN", "5"))

# Message1 values that legitimately explain a big negative — emptying the bin
# or re-zeroing the scale. Alerting on these would mean a red banner every
# night for normal operation, which trains people to ignore alerts entirely.
EXPLAINED_EVENTS = {
    e.strip().lower()
    for e in os.environ.get("EXPLAINED_EVENTS", "bin dumped,system tared,mass removed").split(",")
    if e.strip()
}

_dynamodb = boto3.resource("dynamodb")
_readings = _dynamodb.Table(READINGS_TABLE)
_scales = _dynamodb.Table(SCALES_TABLE)

# Message2 doubles as a waste-category tag and as a device event log. Only
# these three are categories; anything else ("Wifi Reconnected", blanks) is an
# event and must not be counted as waste.
CATEGORY_COLORS = {
    "Overproduction": "#EF4444",
    "Prep Waste": "#F59E0B",
    "Storage EXP": "#A78BFA",
}
UNCATEGORISED = "Uncategorised"
UNCATEGORISED_COLOR = "#64748B"

DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
HOUR_LABELS = [
    "12AM", "1AM", "2AM", "3AM", "4AM", "5AM", "6AM", "7AM", "8AM", "9AM", "10AM", "11AM",
    "12PM", "1PM", "2PM", "3PM", "4PM", "5PM", "6PM", "7PM", "8PM", "9PM", "10PM", "11PM",
]

# Discovered UID list, cached across warm invocations. The whole point of the
# admin view is to surface UIDs that were never registered, and the only way to
# find those is to look at the data — so we look once, not once per request.
_uid_cache = {"uids": None, "at": 0.0}
UID_CACHE_TTL = float(os.environ.get("UID_CACHE_TTL", "300"))


# ==========================================================================
# Shared helpers (duplicated across Lambdas by hand — see the note in
# aws/lambdas/api/lambda_function.py about why these aren't in a Layer)
# ==========================================================================

def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def verify_token(token: str):
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except (ValueError, AttributeError):
        return None
    expected = hmac.new(
        JWT_SECRET.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256
    ).digest()
    try:
        if not hmac.compare_digest(expected, _b64url_decode(signature_b64)):
            return None
        payload = json.loads(_b64url_decode(payload_b64))
    except Exception:  # noqa: BLE001 - fail closed on anything malformed
        return None
    if not isinstance(payload, dict) or payload.get("exp", 0) < int(time.time()):
        return None
    return payload


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return int(o) if o % 1 == 0 else float(o)
        return super().default(o)


CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
}


def respond(status: int, body=None):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", **CORS_HEADERS},
        "body": json.dumps(body, cls=DecimalEncoder) if body is not None else "",
    }


def bearer_token(event) -> str:
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    auth = headers.get("authorization", "")
    return auth[7:].strip() if auth.lower().startswith("bearer ") else auth.strip()


# ==========================================================================
# Reading normalisation
# ==========================================================================

def _to_float(value, default=0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError, InvalidOperation):
        return default


def normalize_reading(item: dict) -> dict:
    """Maps a raw DynamoDB item onto the shape the frontend expects."""
    date_time = str(item.get("DateTime", "") or "")
    date = str(item.get("Date", "") or "")
    tme = str(item.get("Time", "") or "")

    # Ingest always writes Date and Time, but derive them if an older row lacks them.
    if date_time and (not date or not tme):
        marker = "T" if "T" in date_time else " "
        head, _, tail = date_time.partition(marker)
        date = date or head
        tme = tme or tail[:8]

    return {
        "uid": str(item.get("UID", "") or ""),
        "dateTime": date_time,
        "date": date,
        "time": tme,
        "perDepositWeight": _to_float(item.get("PerDepositWeight")),
        "runningTotalWeight": _to_float(item.get("RunningTotalWeight")),
        "message1": str(item.get("Message1", "") or ""),
        "message2": str(item.get("Message2", "") or ""),
        "message3": str(item.get("Message3", "") or ""),
    }


def sort_key(r: dict):
    return r.get("dateTime") or f"{r.get('date','')}T{r.get('time','')}"


def category_of(reading: dict) -> str:
    """Message2 counts as a category only when it matches a known one."""
    msg = (reading.get("message2") or "").strip()
    for known in CATEGORY_COLORS:
        if msg.lower() == known.lower():
            return known
    return UNCATEGORISED


# ==========================================================================
# Data access
# ==========================================================================

def discover_uids():
    """
    Every UID present in the readings table, including unregistered devices.

    Uses a projected scan (UID only) and caches the result, because this is the
    one question that genuinely cannot be answered from iwm-scales.
    """
    now = time.time()
    if _uid_cache["uids"] is not None and now - _uid_cache["at"] < UID_CACHE_TTL:
        return _uid_cache["uids"]

    uids, kwargs = set(), {"ProjectionExpression": "#u", "ExpressionAttributeNames": {"#u": "UID"}}
    while True:
        page = _readings.scan(**kwargs)
        for item in page.get("Items", []):
            if item.get("UID"):
                uids.add(str(item["UID"]))
        key = page.get("LastEvaluatedKey")
        if not key:
            break
        kwargs["ExclusiveStartKey"] = key

    _uid_cache["uids"] = sorted(uids)
    _uid_cache["at"] = now
    return _uid_cache["uids"]


def org_uids(org: str):
    """UIDs whose scale record is assigned to this organization."""
    if not org:
        return []
    try:
        result = _scales.scan(
            FilterExpression="#o = :o",
            ExpressionAttributeNames={"#o": "organization"},
            ExpressionAttributeValues={":o": org},
            ProjectionExpression="scaleId",
        )
        return [i["scaleId"] for i in result.get("Items", []) if i.get("scaleId")]
    except ClientError as err:
        print(f"ERROR org_uids: {err}")
        return []


def query_window(uid, start_iso, end_iso, limit):
    """
    Readings for one device within a time window, newest first.

    DateTime is the sort key, so this reads only the rows in range.
    """
    items = []
    kwargs = {
        "KeyConditionExpression": Key("UID").eq(uid) & Key("DateTime").between(start_iso, end_iso),
        "ScanIndexForward": False,
    }
    while len(items) < limit:
        page = _readings.query(**kwargs)
        items.extend(page.get("Items", []))
        key = page.get("LastEvaluatedKey")
        if not key:
            break
        kwargs["ExclusiveStartKey"] = key
    return items[:limit]


def query_since(uid, since_iso, limit):
    """
    Only readings strictly newer than `since_iso`, oldest first.

    Backs the dashboard's incremental refresh: once the page has loaded a week
    of history, each poll asks only for what arrived after the newest row it
    already holds. On a quiet minute that's an empty response instead of
    re-sending a couple of thousand unchanged rows.

    `gt` rather than `between` so the boundary row isn't returned again.
    """
    items = []
    kwargs = {
        "KeyConditionExpression": Key("UID").eq(uid) & Key("DateTime").gt(since_iso),
        "ScanIndexForward": True,
    }
    while len(items) < limit:
        page = _readings.query(**kwargs)
        items.extend(page.get("Items", []))
        key = page.get("LastEvaluatedKey")
        if not key:
            break
        kwargs["ExclusiveStartKey"] = key
    return items[:limit]


def query_latest(uid, limit):
    """Most recent readings for a device, ignoring any window."""
    try:
        page = _readings.query(
            KeyConditionExpression=Key("UID").eq(uid),
            ScanIndexForward=False,
            Limit=limit,
        )
        return page.get("Items", [])
    except ClientError as err:
        print(f"ERROR query_latest {uid}: {err}")
        return []


def resolve_window(params):
    """Returns (start_iso, end_iso) from ?from/?to/?days, defaulting to last N days."""
    today = datetime.now(timezone.utc).date()

    date_from = (params.get("from") or "").strip()[:10]
    date_to = (params.get("to") or "").strip()[:10]

    if not date_from:
        try:
            days = min(MAX_DAYS, max(1, int(params.get("days") or DEFAULT_DAYS)))
        except ValueError:
            days = DEFAULT_DAYS
        date_from = (today - timedelta(days=days)).isoformat()
    if not date_to:
        date_to = today.isoformat()

    # Inclusive of the whole end day.
    return f"{date_from}T00:00:00", f"{date_to}T23:59:59"


def fetch_live(claims, params):
    """
    Readings inside a narrow band around *now* — the live ticker on the
    dashboard, as opposed to the week of history the table shows.

    Default is now ±60s. If nothing has landed in that band (ingestion paused,
    or device clocks drifting from server time) it falls back to each device's
    most recent rows, so the panel shows the last known activity rather than
    going blank.

    KNOWN ISSUE — this band is comparing two different things.

    It builds its window from `datetime.now(timezone.utc)` and compares that
    against the DateTime sort key. That would be correct if DateTime were UTC,
    but the deployed ingest Lambda stores the device's timestamp verbatim, so
    DateTime is a naive *device-local* wall clock. The two are offset by
    whatever the device's zone is — three or four hours for Atlantic Canada —
    so the ±60s band almost never matches and this function silently falls
    through to the per-device "latest rows" path on nearly every call.

    The fallback is why the panel still looks reasonable: it shows last-known
    activity rather than going blank, and marks those rows isLive=False.

    Fixing it properly means resolving each UID's zone from the iwm-scales
    table and comparing against local time per device, since one fleet spans
    several provinces and there is no single "now" to test against.
    """
    is_admin = claims["role"] == "admin"
    try:
        seconds = min(3600, max(5, int(params.get("seconds") or LIVE_WINDOW_SECONDS)))
    except ValueError:
        seconds = LIVE_WINDOW_SECONDS

    try:
        scoped = discover_uids() if is_admin else org_uids(claims.get("org", ""))
        if not scoped:
            return [], None

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        start = (now - timedelta(seconds=seconds)).isoformat(timespec="seconds")
        end = (now + timedelta(seconds=seconds)).isoformat(timespec="seconds")

        raw = []
        for uid in scoped:
            raw.extend(query_window(uid, start, end, 200))

        fell_back = False
        if not raw:
            fell_back = True
            for uid in scoped:
                raw.extend(query_latest(uid, 10))
    except ClientError as err:
        print(f"ERROR fetch_live: {err}")
        return None, respond(503, {"message": "Could not load live readings"})

    readings = [normalize_reading(i) for i in raw if i.get("UID")]
    readings.sort(key=sort_key, reverse=True)
    for r in readings:
        r["isLive"] = not fell_back
    return readings, None


def fetch_readings(claims, params):
    """
    Returns (readings, error_response).

    If the requested window holds nothing, falls back to each device's most
    recent readings — a dashboard showing the last known data is far more
    useful than one showing an empty state because ingestion paused.
    """
    is_admin = claims["role"] == "admin"
    wanted_uid = (params.get("uid") or "").strip().upper()

    try:
        if is_admin:
            scoped = discover_uids()
        else:
            scoped = org_uids(claims.get("org", ""))

        if wanted_uid:
            if wanted_uid not in scoped:
                return None, respond(
                    403, {"message": "That scale is not assigned to your organization"}
                )
            scoped = [wanted_uid]

        if not scoped:
            return [], None

        # Incremental mode: caller already holds history and only wants what
        # has landed since. Returns [] when nothing has, which is the common
        # case on a quiet poll.
        since = (params.get("since") or "").strip()
        if since:
            raw = []
            for uid in scoped:
                raw.extend(query_since(uid, since, MAX_ROWS))
            readings = [normalize_reading(i) for i in raw if i.get("UID")]
            readings.sort(key=sort_key, reverse=True)
            return readings, None

        start_iso, end_iso = resolve_window(params)
        per_uid = max(50, MAX_ROWS * 5 // max(1, len(scoped)))

        raw = []
        for uid in scoped:
            raw.extend(query_window(uid, start_iso, end_iso, per_uid))

        if not raw:
            for uid in scoped:
                raw.extend(query_latest(uid, min(200, per_uid)))
    except ClientError as err:
        print(f"ERROR fetch_readings: {err}")
        return None, respond(503, {"message": "Could not load readings"})

    readings = [normalize_reading(i) for i in raw]
    readings = [r for r in readings if r["uid"]]
    readings.sort(key=sort_key, reverse=True)
    return readings, None


# ==========================================================================
# Alert engine
# ==========================================================================

def fetch_alerts(claims, params):
    """
    Alerts are rare events, so a fixed 7-day window usually returns nothing —
    which reads as "no problems" when it really means "none this week".

    Instead, widen the search until something is found: last week, then month,
    quarter, year. Whatever surfaces carries its own `timestamp` and `since`,
    so an old alert is visibly old rather than looking like it just happened.

    Note that fetch_readings already falls back to each device's latest rows
    when a window is empty, so a long-idle device surfaces on the first pass.
    The escalation here covers the other case: a window that has plenty of
    data but nothing worth alerting on.
    """
    if params.get("from") or params.get("to") or params.get("days"):
        readings, err = fetch_readings(claims, params)
        if err:
            return None, err
        return compute_alerts(readings), None

    for days in ALERT_LOOKBACK_DAYS:
        readings, err = fetch_readings(claims, {**params, "days": str(days)})
        if err:
            return None, err
        alerts = compute_alerts(readings)
        if alerts:
            return alerts, None

    return [], None


def compute_alerts(readings):
    """
    Raises at most one alert per device, at the highest severity found.

    Every alert carries the timestamp of the sample that triggered it, so an
    old alert is visibly old rather than looking like it just happened.

    Samples whose Message1 explains the drop (bin emptied, scale tared) are
    skipped — those are normal operation, and alerting on them would fire
    nightly and teach everyone to ignore the alert panel.
    """
    by_uid = defaultdict(list)
    for r in readings:
        by_uid[r["uid"]].append(r)

    alerts = []
    for uid, rows in by_uid.items():
        rows = sorted(rows, key=sort_key)  # chronological

        worst = None          # (severity, reason, triggering_row, detail)
        warn_run = crit_run = drift_run = 0
        warn_from = crit_from = drift_from = None

        def escalate(sev, reason, row, detail, first_row):
            nonlocal worst
            if worst is None or (sev == "danger" and worst[0] != "danger"):
                worst = (sev, reason, row, detail, first_row)

        for row in rows:
            kg = row["perDepositWeight"]
            explained = (row.get("message1") or "").strip().lower() in EXPLAINED_EVENTS

            # 1. Single unexplained drop.
            if not explained:
                if kg <= CRIT_SINGLE_KG:
                    escalate("danger", "single-drop", row,
                             f"Unexplained drop of {kg:.2f} kg in one reading", row)
                elif kg <= WARN_SINGLE_KG:
                    escalate("warning", "single-drop", row,
                             f"Unexplained drop of {kg:.2f} kg in one reading", row)

            # 2. Sustained run inside a magnitude band.
            if kg <= CRIT_KG and not explained:
                crit_from = crit_from or row
                crit_run += 1
            else:
                crit_run, crit_from = 0, None

            if kg <= WARN_KG and not explained:
                warn_from = warn_from or row
                warn_run += 1
            else:
                warn_run, warn_from = 0, None

            # 3. Drift: many consecutive negatives, whatever their size.
            if kg < 0:
                drift_from = drift_from or row
                drift_run += 1
            else:
                drift_run, drift_from = 0, None

            if crit_run >= CRIT_RUN:
                escalate("danger", "sustained-run", row,
                         f"{crit_run} consecutive readings below {CRIT_KG:g} kg", crit_from)
            elif warn_run >= WARN_RUN:
                escalate("warning", "sustained-run", row,
                         f"{warn_run} consecutive readings below {WARN_KG:g} kg", warn_from)
            elif drift_run >= DRIFT_RUN:
                escalate("warning", "drift", row,
                         f"{drift_run} consecutive negative readings - possible calibration drift",
                         drift_from)

        if not worst:
            continue

        severity, reason, row, detail, first_row = worst
        alerts.append({
            "id": f"alert-{uid}-{reason}",
            "uid": uid,
            "scale": uid,
            "timestamp": f"{row['date']} {row['time']}".strip(),
            "since": f"{(first_row or row)['date']} {(first_row or row)['time']}".strip(),
            "type": detail,
            "reason": reason,
            "severity": severity,
            "status": "Open",
            "triggerKg": round(row["perDepositWeight"], 2),
            "lowestKg": round(min(r["perDepositWeight"] for r in rows), 2),
        })

    order = {"danger": 0, "warning": 1}
    alerts.sort(key=lambda a: (order.get(a["severity"], 9), a["timestamp"]), reverse=False)
    alerts.sort(key=lambda a: order.get(a["severity"], 9))
    return alerts


# ==========================================================================
# Derived analytics
# ==========================================================================

def positive_kg(r):
    """Only deposits count as waste; negatives are removals or corrections."""
    return max(0.0, r["perDepositWeight"])


def parse_date(value):
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def _totals_by_day(readings):
    by_day = defaultdict(float)
    for r in readings:
        d = parse_date(r["date"])
        if d:
            by_day[d] += positive_kg(r)
    return by_day


def dashboard_stats(readings, claims):
    if not readings:
        return {
            "totalWasteToday": 0, "totalWasteYesterday": 0, "weeklyChangePct": 0,
            "activeScales": 0, "totalScales": 0, "sparkline": [],
        }

    # "Today" is anchored to the newest reading present, so the numbers stay
    # meaningful when ingestion is running a day or two behind.
    latest = parse_date(readings[0]["date"]) or datetime.now(timezone.utc).date()
    by_day = _totals_by_day(readings)

    this_week = sum(by_day.get(latest - timedelta(days=i), 0.0) for i in range(7))
    last_week = sum(by_day.get(latest - timedelta(days=i), 0.0) for i in range(7, 14))
    change = round(((this_week - last_week) / last_week) * 100) if last_week else 0

    uids = {r["uid"] for r in readings}
    cutoff = latest - timedelta(days=1)
    active = {r["uid"] for r in readings if (parse_date(r["date"]) or latest) >= cutoff}

    total_scales = len(uids)
    if claims["role"] != "admin":
        total_scales = max(total_scales, len(org_uids(claims.get("org", ""))))

    return {
        "totalWasteToday": round(by_day.get(latest, 0.0), 1),
        "totalWasteYesterday": round(by_day.get(latest - timedelta(days=1), 0.0), 1),
        "weeklyChangePct": change,
        "activeScales": len(active),
        "totalScales": total_scales,
        "sparkline": [
            {"i": i, "v": round(by_day.get(latest - timedelta(days=6 - i), 0.0), 1)}
            for i in range(7)
        ],
    }


def category_breakdown(readings):
    totals = defaultdict(float)
    for r in readings:
        totals[category_of(r)] += positive_kg(r)
    out = [
        {"name": n, "value": round(v, 1),
         "color": CATEGORY_COLORS.get(n, UNCATEGORISED_COLOR)}
        for n, v in totals.items() if v > 0
    ]
    out.sort(key=lambda c: c["value"], reverse=True)
    return out


def hourly_waste(readings):
    buckets = defaultdict(float)
    for r in readings:
        try:
            hour = int((r["time"] or "")[:2])
        except (ValueError, TypeError):
            continue
        if 0 <= hour <= 23:
            buckets[hour] += positive_kg(r)
    return [{"hour": HOUR_LABELS[h], "value": round(buckets.get(h, 0.0), 1)} for h in range(24)]


def weekly_trend(readings):
    if not readings:
        return []
    latest = parse_date(readings[0]["date"]) or datetime.now(timezone.utc).date()
    by_day = _totals_by_day(readings)
    return [
        {
            "day": DAY_LABELS[(latest - timedelta(days=i)).weekday()],
            "thisWeek": round(by_day.get(latest - timedelta(days=i), 0.0), 1),
            "lastWeek": round(by_day.get(latest - timedelta(days=i + 7), 0.0), 1),
        }
        for i in range(6, -1, -1)
    ]


# ==========================================================================
# Routing
# ==========================================================================

def lambda_handler(event, context):
    if not JWT_SECRET:
        print("FATAL: JWT_SECRET environment variable is not set")
        return respond(500, {"message": "Server is not configured correctly"})

    ctx_http = (event.get("requestContext") or {}).get("http") or {}
    method = (ctx_http.get("method") or event.get("httpMethod") or "").upper()
    path = ctx_http.get("path") or event.get("rawPath") or event.get("path") or ""
    params = event.get("queryStringParameters") or {}

    if method == "OPTIONS":
        return respond(204)
    if method != "GET":
        return respond(405, {"message": "Only GET is supported"})

    claims = verify_token(bearer_token(event))
    if not claims:
        return respond(401, {"message": "Unauthorized"})
    claims["role"] = (claims.get("role") or "client").strip().lower()

    try:
        # Checked before the general /readings route, which would otherwise
        # swallow it, and served from its own narrow query.
        if re.search(r"/readings/live/?$", path):
            live, err = fetch_live(claims, params)
            return err or respond(200, live)

        readings, err = fetch_readings(claims, params)
        if err:
            return err

        if re.search(r"/readings/?$", path):
            try:
                limit = min(MAX_ROWS, max(1, int(params.get("limit") or MAX_ROWS)))
            except ValueError:
                limit = MAX_ROWS
            return respond(200, readings[:limit])
        if re.search(r"/dashboard/stats/?$", path):
            return respond(200, dashboard_stats(readings, claims))
        if re.search(r"/dashboard/alerts/?$", path):
            alerts, alert_err = fetch_alerts(claims, params)
            return alert_err or respond(200, alerts)
        if re.search(r"/analytics/category-breakdown/?$", path):
            return respond(200, category_breakdown(readings))
        if re.search(r"/analytics/hourly-waste/?$", path):
            return respond(200, hourly_waste(readings))
        if re.search(r"/analytics/weekly-trend/?$", path):
            return respond(200, weekly_trend(readings))

        return respond(404, {"message": f"No route for GET {path}"})
    except Exception as err:  # noqa: BLE001 - last line of defence
        print(f"ERROR handling {method} {path}: {type(err).__name__}: {err}")
        return respond(500, {"message": "Something went wrong. Please try again."})
