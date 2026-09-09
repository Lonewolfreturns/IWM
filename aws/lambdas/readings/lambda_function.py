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
* Clients see only UIDs whose scale record is assigned to them,
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
    PURGE_MAX_ROWS   safety cap on one purge call   default: 50000
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
from zoneinfo import ZoneInfo

READINGS_TABLE = os.environ.get("READINGS_TABLE", "IWM")

# Rows one invocation will delete before handing control back.
#
# NOT a limit on how much can be purged. Deleting is ~25 rows per write
# request, so a device with 200k readings cannot finish inside a Lambda
# timeout however long the timeout is. Rather than fail half-way with no
# record of where it got to, an invocation stops at this many, reports
# `complete: false`, and the caller immediately calls again — the client loops
# until it comes back complete. Every row deleted stays deleted, so resuming
# costs nothing.
PURGE_MAX_ROWS = int(os.environ.get("PURGE_MAX_ROWS", "5000"))
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

# ---------------------------------------------------------------------------
# Sensor noise floor.
#
# A load cell does not read a clean zero. It wanders with temperature, vibration
# and mains noise, and on this fleet that wander is tens of grams: measured over
# a real 5000-row export, 53.9% of ALL readings fall within +/-50 g of zero, and
# 24% sit between -20 g and 0. None of that is food.
#
# Any rule that counts readings without a floor is therefore counting sensor
# jitter. The old drift rule did exactly that - "5 consecutive negative
# readings" treated a -0.01 kg wobble as evidence of calibration loss.
#
# Everything below this magnitude is treated as "no measurable change".
# Set NOISE_FLOOR_KG per deployment; a scale record may override it per device
# via a `noiseFloorKg` (or `noiseFloorG`) attribute, since sensors differ.
# ---------------------------------------------------------------------------
NOISE_FLOOR_KG = float(os.environ.get("NOISE_FLOOR_KG", "0.05"))   # 50 g

# ---------------------------------------------------------------------------
# The clock the fleet's scales run on.
#
# DateTime is stored as the device's own naive wall clock, so every "now"
# this module compares against has to be expressed on that same clock or the
# comparison is meaningless.
#
# The devices keep a fixed UTC-4 and do not follow daylight saving. Measured
# against a live reading on 2026-08-24: the scale reported 12:01 while Halifax
# read 13:03 — an hour behind, Halifax being on ADT (UTC-3) that day.
#
# Hence a fixed offset rather than "America/Halifax": the named zone would apply
# whatever offset Halifax is on, making it right all winter and an hour out all
# summer. Note the sign — IANA "Etc/GMT+4" means UTC-4.
#
# Keep in step with FLEET_TIME_ZONE in frontend/src/lib/time.js.
# ---------------------------------------------------------------------------
FLEET_TIME_ZONE = os.environ.get("FLEET_TIME_ZONE", "Etc/GMT+4")

# Silence. A scale only reports when something is thrown away, so a quiet night
# is normal and a quiet week is not. Measured against real elapsed time, so a
# fleet-wide ingestion stop surfaces instead of hiding behind itself.
SILENT_WARN_HOURS = float(os.environ.get("SILENT_WARN_HOURS", "24"))
SILENT_CRIT_HOURS = float(os.environ.get("SILENT_CRIT_HOURS", "48"))
SILENT_OFFLINE_HOURS = float(os.environ.get("SILENT_OFFLINE_HOURS", "168"))  # 7 days

# Consecutive unexplained negatives *beyond the noise floor*. Tuned against the
# export: at 5 this fires 6 times across 4 scales, at 8 it never fires.
DRIFT_RUN = int(os.environ.get("DRIFT_RUN", "5"))

# Consecutive readings that all sit inside the noise band: the scale is alive
# and reporting but nothing is registering. Deliberately high - short runs are
# just a quiet kitchen. At 30 this flags 5 scales in the export, at 10 it would
# flag 9 and mean nothing.
FLATLINE_RUN = int(os.environ.get("FLATLINE_RUN", "30"))

# Device-health events, counted per scale within the window.
REBOOT_COUNT = int(os.environ.get("REBOOT_COUNT", "5"))
WIFI_FLAP_COUNT = int(os.environ.get("WIFI_FLAP_COUNT", "20"))

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
    # DELETE is here for the purge route only. A browser preflights any
    # non-simple method, and a method missing from this list is refused before
    # the request ever reaches the function — which surfaces to the client as a
    # network error with no response body, not as a 405.
    "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
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


def reading_datetime(r: dict):
    """
    A reading's timestamp as a naive datetime, or None if it cannot be read.

    Naive on purpose: DateTime is written as the device's own wall clock, so
    there is no zone to attach without resolving the scale's location. Callers
    that only need an elapsed duration (the silence rules) can live with the
    few hours of skew that implies; see the fetch_live docstring.
    """
    raw = sort_key(r)
    if not raw:
        return None
    text = str(raw).replace("T", " ").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[:len("2026-01-01 00:00:00")], fmt)
        except ValueError:
            continue
    return None


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


# ---------------------------------------------------------------------------
# ACCESS SCOPE: per assigned user, not per organization.
#
# A scale is visible to the one account it is assigned to. It used to be scoped
# by that person's ORGANIZATION, so every colleague sharing an `organization`
# string saw the whole site's scales — which made "assign to a person" and
# "share with a company" the same act, and meant a typo'd organization on a
# user record silently widened or narrowed what they could see.
#
# `organization` is still stored on both records and still shown in the UI. It
# is a label now, not a permission.
# ---------------------------------------------------------------------------

def assigned_uids(email: str):
    """UIDs of every scale this user is an assignee of."""
    email = (email or "").strip().lower()
    if not email:
        return []
    try:
        result = _scales.scan(
            FilterExpression="contains(#ae, :e) OR #a = :e",
            ExpressionAttributeNames={"#ae": "assignedEmails", "#a": "assignedEmail"},
            ExpressionAttributeValues={":e": email},
            ProjectionExpression="scaleId",
        )
        return [i["scaleId"] for i in result.get("Items", []) if i.get("scaleId")]
    except ClientError as err:
        print(f"ERROR assigned_uids: {err}")
        return []


def fleet_now():
    """
    The current time on the fleet's own clock, as a naive datetime.

    Naive on purpose: it is compared against DateTime values that are
    themselves naive device wall clocks, so both sides have to be stripped of
    zone information for the comparison to line up.

    Falls back to UTC if the zone database is unavailable in the runtime, which
    only costs the live window its accuracy rather than taking the endpoint out.
    """
    try:
        return datetime.now(ZoneInfo(FLEET_TIME_ZONE)).replace(tzinfo=None)
    except Exception as err:                      # noqa: BLE001 - never fatal
        print(f"WARN fleet_now: {FLEET_TIME_ZONE} unavailable ({err}); using UTC")
        return datetime.now(timezone.utc).replace(tzinfo=None)


def scale_noise_floors():
    """
    Per-device noise floor overrides, as {uid: kg}.

    Sensors differ, so one global figure is a default rather than a rule. A
    scale record may carry `noiseFloorKg` (or `noiseFloorG`, for whoever finds
    grams more natural). Missing or unparseable values simply fall back to
    NOISE_FLOOR_KG - a bad attribute must not take the alert engine down.
    """
    floors = {}
    try:
        result = _scales.scan(
            ProjectionExpression="scaleId, noiseFloorKg, noiseFloorG",
        )
        for item in result.get("Items", []):
            uid = item.get("scaleId")
            if not uid:
                continue
            if item.get("noiseFloorKg") is not None:
                value = _to_float(item.get("noiseFloorKg"))
            elif item.get("noiseFloorG") is not None:
                value = _to_float(item.get("noiseFloorG")) / 1000.0
            else:
                continue
            # A zero or negative floor would disable the guard entirely, which
            # is how the noisy behaviour comes back by accident.
            if value > 0:
                floors[uid] = value
    except ClientError as err:
        print(f"ERROR scale_noise_floors: {err}")
    return floors


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
    # The fleet's today, not UTC's. Between 20:00 and midnight Atlantic these
    # are different dates, and a "last 7 days" window anchored to the wrong one
    # either drops the current evening's readings or reaches a day too far.
    today = fleet_now().date()

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

    The band is built on the fleet clock (see FLEET_TIME_ZONE), not on UTC.

    This used to compare `datetime.now(timezone.utc)` against the DateTime sort
    key. That would be correct if DateTime were UTC, but the deployed ingest
    Lambda stores the device's stamp verbatim, so DateTime is a naive
    *device-local* wall clock. The two were offset by the device's whole zone
    offset — four hours here — so the ±60s band never matched and every call
    silently fell through to the "latest rows" path. That is why the panel was
    permanently marked Idle however recently a scale had reported.

    Both sides are now on the same clock, so the band matches when it should.
    The fallback is kept for the case it was meant for: nothing has genuinely
    landed in the window, in which case last-known rows are shown and marked
    isLive=False rather than leaving the panel blank.

    A scale that sets its own `timeZone` is still a real exception here — the
    band would be off by the difference. That matters only for a device
    provisioned outside the fleet's zone, and the fallback covers it.
    """
    is_admin = claims["role"] == "admin"
    try:
        seconds = min(3600, max(5, int(params.get("seconds") or LIVE_WINDOW_SECONDS)))
    except ValueError:
        seconds = LIVE_WINDOW_SECONDS

    try:
        scoped = discover_uids() if is_admin else assigned_uids(claims.get("email", ""))
        if not scoped:
            return [], None

        now = fleet_now()
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


def resolve_uid(wanted: str, allowed):
    """
    Matches a requested UID against the ones this caller may read, ignoring case.

    UIDs are whatever the device was provisioned with, and this fleet is not
    consistent about it: DAL00003 and GUELPH01 sit alongside Scotttest4,
    ScottTest, "Community Day" and Test. The request used to be upper-cased
    before the membership test, so "Scotttest4" became "SCOTTTEST4", matched
    nothing, and came back 403 "not assigned to you" — for eight of eighteen
    scales, to an admin who could see every one of them in the list.

    Returns the UID in its stored spelling, because DynamoDB partition keys are
    case-sensitive: matching loosely is only safe if the query then uses the
    exact stored form. None means no such UID is readable by this caller.
    """
    if not wanted:
        return None
    target = wanted.strip().lower()
    for uid in allowed:
        if str(uid).strip().lower() == target:
            return str(uid)
    return None


def fetch_readings(claims, params):
    """
    Returns (readings, error_response).

    If the requested window holds nothing, falls back to each device's most
    recent readings — a dashboard showing the last known data is far more
    useful than one showing an empty state because ingestion paused.
    """
    is_admin = claims["role"] == "admin"
    wanted_uid = (params.get("uid") or "").strip()

    try:
        if is_admin:
            scoped = discover_uids()
        else:
            scoped = assigned_uids(claims.get("email", ""))

        if wanted_uid:
            match = resolve_uid(wanted_uid, scoped)
            if not match:
                return None, respond(
                    403, {"message": "That scale is not assigned to you"}
                )
            scoped = [match]

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

def purge_readings(claims, uid: str):
    """
    Permanently deletes every reading for one UID.

    Admin only, and irreversible — DynamoDB has no undo, and these rows are the
    only copy. Guarded accordingly:

      * admin role is re-checked here, not merely in the UI
      * the UID must resolve against UIDs that actually exist, so a typo
        deletes nothing rather than silently "succeeding" on an empty set
      * a row count is returned so the caller can confirm what went, and the
        confirmation dialog can show the number before anyone commits

    Intended for clearing test devices out of a real table. The scale record in
    iwm-scales is left alone: this removes telemetry, not the provisioning, so
    a scale that is still deployed keeps its configuration and simply starts
    from an empty history.
    """
    if claims["role"] != "admin":
        return None, respond(403, {"message": "Admin access required"})

    wanted = (uid or "").strip()
    if not wanted:
        return None, respond(400, {"message": "A scale UID is required"})

    # Resolve against the UIDs actually present, case-insensitively, and use
    # the stored spelling — partition keys are case-sensitive, so deleting by a
    # differently-cased string would quietly match nothing.
    match = resolve_uid(wanted, discover_uids())
    if not match:
        return None, respond(404, {"message": f"No readings found for {wanted}"})

    deleted = 0
    try:
        kwargs = {
            "KeyConditionExpression": Key("UID").eq(match),
            "ProjectionExpression": "#u, #d",
            "ExpressionAttributeNames": {"#u": "UID", "#d": "DateTime"},
        }
        while True:
            page = _readings.query(**kwargs)
            items = page.get("Items", [])
            capped = False
            if items:
                # batch_writer batches, retries unprocessed items and dedupes
                # keys within a batch, which hand-rolled BatchWriteItem loops
                # routinely get wrong.
                with _readings.batch_writer() as batch:
                    for item in items:
                        # Checked per item, not per page. A page can hold a
                        # thousand rows, so testing the cap between pages let a
                        # limit of 100 delete 600 before noticing — which is
                        # not much of a brake.
                        if deleted >= PURGE_MAX_ROWS:
                            capped = True
                            break
                        batch.delete_item(
                            Key={"UID": item["UID"], "DateTime": item["DateTime"]}
                        )
                        deleted += 1

            if capped or deleted >= PURGE_MAX_ROWS:
                # Stop cleanly rather than risk timing out part-way. What has
                # gone is gone; the caller can run it again to continue.
                _uid_cache["uids"] = None
                _uid_cache["at"] = 0
                print(
                    f"AUDIT purge_readings uid={match} deleted={deleted} "
                    f"capped=True by={claims.get('email')}"
                )
                return {
                    "uid": match,
                    "deleted": deleted,
                    "complete": False,
                    "message": (
                        f"Deleted {deleted} rows so far; more remain. "
                        "Call again to continue."
                    ),
                }, None

            key = page.get("LastEvaluatedKey")
            if not key:
                break
            kwargs["ExclusiveStartKey"] = key
    except ClientError as err:
        print(f"ERROR purge_readings {match}: {err}")
        # Report what was already removed — a partial delete the caller does not
        # know about is worse than the failure itself.
        return None, respond(
            503,
            {
                "message": f"Deletion failed after removing {deleted} rows",
                "deleted": deleted,
            },
        )

    # The UID cache still lists a device that no longer has any rows, which
    # would keep it in every scoped query until the TTL lapses.
    _uid_cache["uids"] = None
    _uid_cache["at"] = 0

    print(f"AUDIT purge_readings uid={match} deleted={deleted} by={claims.get('email')}")
    return {"uid": match, "deleted": deleted, "complete": True}, None


def count_readings(claims, uid: str):
    """
    How many rows a purge would remove, without removing them.

    Lets the confirmation dialog state a real number instead of "all data",
    which is the difference between an informed confirmation and a shrug.
    """
    if claims["role"] != "admin":
        return None, respond(403, {"message": "Admin access required"})

    match = resolve_uid((uid or "").strip(), discover_uids())
    if not match:
        return {"uid": (uid or "").strip(), "rows": 0}, None

    total = 0
    try:
        kwargs = {"KeyConditionExpression": Key("UID").eq(match), "Select": "COUNT"}
        while True:
            page = _readings.query(**kwargs)
            total += page.get("Count", 0)
            key = page.get("LastEvaluatedKey")
            if not key:
                break
            kwargs["ExclusiveStartKey"] = key
    except ClientError as err:
        print(f"ERROR count_readings {match}: {err}")
        return None, respond(503, {"message": "Could not count readings"})

    return {"uid": match, "rows": total}, None


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
    # Read once and reuse: the per-device overrides are the same whichever
    # window the escalation below settles on.
    floors = scale_noise_floors()

    if params.get("from") or params.get("to") or params.get("days"):
        readings, err = fetch_readings(claims, params)
        if err:
            return None, err
        return compute_alerts(readings, noise_floors=floors), None

    for days in ALERT_LOOKBACK_DAYS:
        readings, err = fetch_readings(claims, {**params, "days": str(days)})
        if err:
            return None, err
        alerts = compute_alerts(readings, noise_floors=floors)
        if alerts:
            return alerts, None

    return [], None


# Message1 / Message2 values that describe the device's own state rather than
# anything that was thrown away. Counted for health, never treated as waste.
REBOOT_EVENT = "system reboot"
WIFI_EVENT = "wifi reconnected"

# Severity ordering, and the order rules are preferred in when one device trips
# several at the same severity. Silence first: a scale nobody has heard from
# cannot be assessed on anything else, so leading with its drift reading would
# be answering a question nobody asked.
SEVERITY_RANK = {"danger": 0, "warning": 1, "info": 2}
REASON_RANK = {
    "offline": 0, "silent": 1, "single-drop": 2, "drift": 3,
    "reboot-loop": 4, "wifi-flapping": 5, "flatline": 6,
}


def _hours_between(later, earlier):
    return (later - earlier).total_seconds() / 3600.0


def _describe_age(hours):
    """'46.6' -> '1 day 22 hours'. Alert text should not make people do sums."""
    hours = max(0.0, hours)
    if hours < 1:
        return f"{int(round(hours * 60))} minutes"
    if hours < 48:
        whole = int(hours)
        return f"{whole} hour{'' if whole == 1 else 's'}"
    days = int(hours // 24)
    rem = int(hours % 24)
    out = f"{days} day{'' if days == 1 else 's'}"
    if rem:
        out += f" {rem} hour{'' if rem == 1 else 's'}"
    return out


def _summarise_others(entries):
    """Secondary findings, one per reason, with a count when it recurred."""
    seen = {}
    for sev, reason, title, *_ in entries:
        if reason in seen:
            seen[reason]["occurrences"] += 1
        else:
            seen[reason] = {
                "reason": reason, "title": title,
                "severity": sev, "occurrences": 1,
            }
    return list(seen.values())


def compute_alerts(readings, now=None, noise_floors=None):
    """
    Raises at most one alert per device - the most serious thing wrong with it -
    and lists whatever else was found alongside, so nothing is silently dropped.

    Every alert carries four separate fields rather than one terse string:

        title    what happened, in five words
        detail   the measurement behind it
        meaning  what it usually indicates, in plain English
        action   what the person reading it should actually do

    That split exists because "5 consecutive readings below -10 kg" told a
    reader nothing they could act on: not whether it mattered, not what it
    implied, not what to do next.

    Rules, all measured against a configurable noise floor (see NOISE_FLOOR_KG):

        offline / silent   nothing heard from the device for N hours
        single-drop        one large unexplained negative reading
        drift              a run of unexplained negatives beyond the floor
        reboot-loop        the device keeps restarting
        wifi-flapping      the device keeps losing its connection
        flatline           reporting normally, but nothing registers

    Samples whose Message1 explains a drop (bin emptied, scale tared) are
    skipped by the weight rules - those are normal operation, and alerting on
    them would fire nightly and teach everyone to ignore the panel.
    """
    if now is None:
        # Compared against naive device wall clocks, so "now" has to be on the
        # same clock — otherwise every scale looks four hours staler than it is,
        # which is enough to push a healthy device over the 24h silence line.
        now = fleet_now()
    noise_floors = noise_floors or {}

    by_uid = defaultdict(list)
    for r in readings:
        by_uid[r["uid"]].append(r)

    alerts = []
    for uid, rows in by_uid.items():
        rows = sorted(rows, key=sort_key)          # chronological
        floor = noise_floors.get(uid, NOISE_FLOOR_KG)
        found = []   # (severity, reason, title, detail, meaning, action, row, first_row)

        def raise_(sev, reason, title, detail, meaning, action, row, first_row=None):
            found.append((sev, reason, title, detail, meaning, action, row, first_row or row))

        latest = rows[-1]
        newest_at = reading_datetime(latest)

        # --- 1. Silence -------------------------------------------------
        # The single most common real fault on this fleet, and the one the
        # engine had no rule for at all.
        if newest_at:
            age_h = max(0.0, _hours_between(now, newest_at))
            age_text = _describe_age(age_h)
            if age_h >= SILENT_OFFLINE_HOURS:
                raise_("danger", "offline", f"Scale offline - silent {age_text}",
                       f"No reading since {latest['date']} {latest['time']}, {age_text} ago.",
                       "The scale has stopped reporting entirely. Power, network or the "
                       "device itself, rather than anything to do with the kitchen.",
                       "Check the scale is powered on and on the network. If it is, the "
                       "unit likely needs a site visit.", latest)
            elif age_h >= SILENT_CRIT_HOURS:
                raise_("danger", "silent", f"No readings for {age_text}",
                       f"Last reading {latest['date']} {latest['time']}, {age_text} ago.",
                       "Longer than a normal closure. Either the kitchen is shut or the "
                       "scale has dropped off the network.",
                       "Confirm whether the site is open. If it is, check the scale's "
                       "power and Wi-Fi.", latest)
            elif age_h >= SILENT_WARN_HOURS:
                raise_("warning", "silent", f"Quiet for {age_text}",
                       f"Last reading {latest['date']} {latest['time']}, {age_text} ago.",
                       "A full day with nothing thrown away. Normal over a weekend or a "
                       "closure; worth a look on a trading day.",
                       "No action needed if the kitchen was closed. Otherwise check the "
                       "scale is switched on.", latest)

        # --- 2. Per-reading rules ---------------------------------------
        drift_run, drift_from, drift_kg = 0, None, 0.0
        flat_run, flat_from = 0, None
        reboots, wifi_flaps = 0, 0
        worst_drop = None

        for row in rows:
            kg = row["perDepositWeight"]
            msg1 = (row.get("message1") or "").strip().lower()
            msg2 = (row.get("message2") or "").strip().lower()
            explained = msg1 in EXPLAINED_EVENTS

            if msg1 == REBOOT_EVENT:
                reboots += 1
            if REBOOT_EVENT in msg2:
                reboots += 1
            if WIFI_EVENT in msg1 or WIFI_EVENT in msg2:
                wifi_flaps += 1

            # 2a. One big unexplained negative.
            if not explained and kg <= WARN_SINGLE_KG:
                if worst_drop is None or kg < worst_drop["perDepositWeight"]:
                    worst_drop = row

            # 2b. Drift: consecutive unexplained negatives past the floor.
            #     The floor is the whole point - without it this counted a
            #     10 g wobble as evidence of calibration loss.
            if kg < -floor and not explained:
                drift_from = drift_from or row
                drift_run += 1
                drift_kg += kg
            else:
                drift_run, drift_from, drift_kg = 0, None, 0.0

            # 2c. Flatline: alive, reporting, but nothing measurable lands.
            if abs(kg) <= floor:
                flat_from = flat_from or row
                flat_run += 1
            else:
                flat_run, flat_from = 0, None

            if drift_run >= DRIFT_RUN:
                raise_("warning", "drift",
                       "Weight drifting below zero",
                       f"{drift_run} readings in a row came in negative by more than "
                       f"{floor * 1000:.0f} g, totalling {drift_kg:.2f} kg, "
                       f"starting {drift_from['date']} {drift_from['time']}.",
                       "Readings this far below zero, repeatedly, usually mean the scale "
                       f"has lost its zero point. Anything within {floor * 1000:.0f} g is "
                       "normal sensor noise and is already ignored.",
                       "Clear the platform and re-tare the scale. If it drifts again "
                       "within a day, the load cell needs checking.",
                       row, drift_from)
                drift_run, drift_from, drift_kg = 0, None, 0.0

            if flat_run >= FLATLINE_RUN:
                raise_("info", "flatline",
                       "Reporting, but nothing registering",
                       f"{flat_run} consecutive readings within {floor * 1000:.0f} g of "
                       f"zero, from {flat_from['date']} {flat_from['time']}.",
                       "The scale is online and sending data, but no weight is landing on "
                       "it. Usually a genuinely quiet period; occasionally a sensor that "
                       "has stopped responding to load.",
                       "Compare against the kitchen's opening hours. If it was trading, "
                       "put a known weight on the scale and check it registers.",
                       row, flat_from)
                flat_run, flat_from = 0, None

        if worst_drop is not None:
            kg = worst_drop["perDepositWeight"]
            sev = "danger" if kg <= CRIT_SINGLE_KG else "warning"
            raise_(sev, "single-drop", f"Unexplained drop of {abs(kg):.2f} kg",
                   f"A single reading of {kg:.2f} kg on {worst_drop['date']} "
                   f"{worst_drop['time']}, with no bin-dump or tare recorded against it.",
                   "Weight left the scale without the device logging why. Either the bin "
                   "was emptied without the event being recorded, or the sensor glitched.",
                   "Check whether the bin was emptied at that time. If not, the reading is "
                   "suspect and should be excluded before reporting on this period.",
                   worst_drop)

        if reboots >= REBOOT_COUNT:
            raise_("warning", "reboot-loop", f"Scale restarted {reboots} times",
                   f"{reboots} 'System Reboot' events from this scale in the window.",
                   "Repeated restarts point at an unstable power supply or a failing "
                   "unit. Readings around each restart may be unreliable.",
                   "Check the power supply and cabling. Persistent restarts warrant "
                   "swapping the unit.", latest)

        if wifi_flaps >= WIFI_FLAP_COUNT:
            raise_("warning", "wifi-flapping", f"Connection dropped {wifi_flaps} times",
                   f"{wifi_flaps} 'Wifi Reconnected' events from this scale in the window.",
                   "The scale keeps losing its network connection. Readings still queue "
                   "locally, but they arrive late and may appear out of order.",
                   "Check Wi-Fi coverage where the scale sits. A repeater or moving the "
                   "unit usually fixes it.", latest)

        if not found:
            continue

        found.sort(key=lambda f: (SEVERITY_RANK.get(f[0], 9), REASON_RANK.get(f[1], 9)))
        sev, reason, title, detail, meaning, action, row, first_row = found[0]

        alerts.append({
            "id": f"alert-{uid}-{reason}",
            "uid": uid,
            "scale": uid,
            "timestamp": f"{row['date']} {row['time']}".strip(),
            "since": f"{first_row['date']} {first_row['time']}".strip(),
            # `type` stays the headline so any existing consumer keeps working;
            # the richer fields sit alongside it.
            "type": title,
            "title": title,
            "detail": detail,
            "meaning": meaning,
            "action": action,
            "reason": reason,
            "severity": sev,
            "status": "Open",
            "noiseFloorKg": round(floor, 4),
            "triggerKg": round(row["perDepositWeight"], 2),
            "lowestKg": round(min(r["perDepositWeight"] for r in rows), 2),
            "readingsInWindow": len(rows),
            # Everything else wrong with this device, so one-alert-per-scale
            # hides nothing. Collapsed to one entry per reason: a run rule trips
            # every time the run re-forms, and eight identical lines reading
            # "Reporting, but nothing registering" is noise, not detail.
            "alsoFlagged": _summarise_others(found[1:]),
        })

    alerts.sort(key=lambda a: (SEVERITY_RANK.get(a["severity"], 9),
                               REASON_RANK.get(a["reason"], 9),
                               a["scale"]))
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
    """
    Summary tiles for the dashboard.

    `thisWeekTotal` / `lastWeekTotal` are the honest pair. The older
    `weeklyChangePct` is kept for any client still reading it, but it should
    not be rendered: a percentage needs a trustworthy denominator, and last
    week's total is 0 whenever the caller's window is only seven days wide —
    or, worse, filled with whatever stray rows the "no data in window" fallback
    returned, which is how a 760% "increase" got on screen. `lastWeekTotal` is
    returned as None when the window did not actually reach back far enough to
    measure it, so the client can omit the comparison instead of inventing one.
    """
    if not readings:
        return {
            "totalWasteToday": 0, "totalWasteYesterday": 0, "weeklyChangePct": 0,
            "thisWeekTotal": 0, "lastWeekTotal": None,
            "activeScales": 0, "totalScales": 0, "sparkline": [],
        }

    # "Today" is anchored to the newest reading present, so the numbers stay
    # meaningful when ingestion is running a day or two behind.
    latest = parse_date(readings[0]["date"]) or datetime.now(timezone.utc).date()
    by_day = _totals_by_day(readings)

    this_week = sum(by_day.get(latest - timedelta(days=i), 0.0) for i in range(7))
    last_week = sum(by_day.get(latest - timedelta(days=i), 0.0) for i in range(7, 14))
    change = round(((this_week - last_week) / last_week) * 100) if last_week else 0

    # Distinguish "last week really was zero" from "the window never reached
    # last week". Both look like 0.0 in `by_day`, and only the first is a fact
    # worth putting on a tile.
    oldest = min((parse_date(r["date"]) for r in readings if parse_date(r["date"])),
                 default=latest)
    covers_last_week = oldest <= latest - timedelta(days=13)

    uids = {r["uid"] for r in readings}
    cutoff = latest - timedelta(days=1)
    active = {r["uid"] for r in readings if (parse_date(r["date"]) or latest) >= cutoff}

    total_scales = len(uids)
    if claims["role"] != "admin":
        total_scales = max(total_scales, len(assigned_uids(claims.get("email", ""))))

    return {
        "totalWasteToday": round(by_day.get(latest, 0.0), 1),
        "totalWasteYesterday": round(by_day.get(latest - timedelta(days=1), 0.0), 1),
        "weeklyChangePct": change,   # deprecated: see the docstring
        "thisWeekTotal": round(this_week, 1),
        "lastWeekTotal": round(last_week, 1) if covers_last_week else None,
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
    if method not in ("GET", "DELETE"):
        return respond(405, {"message": "Only GET and DELETE are supported"})

    claims = verify_token(bearer_token(event))
    if not claims:
        return respond(401, {"message": "Unauthorized"})
    claims["role"] = (claims.get("role") or "client").strip().lower()

    # DELETE /readings?uid=X — remove every reading for one device.
    # Routed before anything else so no read path can be reached with DELETE.
    if method == "DELETE":
        if not re.search(r"/readings/?$", path):
            return respond(404, {"message": f"No route for {method} {path}"})
        result, err = purge_readings(claims, params.get("uid"))
        return err or respond(200, result)

    try:
        # Checked before the general /readings route, which would otherwise
        # swallow it, and served from its own narrow query.
        if re.search(r"/readings/live/?$", path):
            live, err = fetch_live(claims, params)
            return err or respond(200, live)

        # The stats tile compares this week against last week, so it needs
        # fourteen days in hand — the shared default window is seven, which is
        # why the comparison had nothing to stand on. Only widened when the
        # caller did not ask for a window of their own.
        if re.search(r"/dashboard/stats/?$", path) and not any(
            params.get(k) for k in ("from", "to", "days")
        ):
            params = {**params, "days": 14}

        readings, err = fetch_readings(claims, params)
        if err:
            return err

        if re.search(r"/readings/?$", path):
            try:
                limit = min(MAX_ROWS, max(1, int(params.get("limit") or MAX_ROWS)))
            except ValueError:
                limit = MAX_ROWS
            return respond(200, readings[:limit])
        # Rows a purge would remove. Admin-only, checked in the handler.
        if re.search(r"/readings/count/?$", path):
            result, err = count_readings(claims, params.get("uid"))
            return err or respond(200, result)

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
