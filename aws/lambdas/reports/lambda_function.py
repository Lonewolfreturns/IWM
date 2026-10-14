"""
IWM — Reports Lambda
====================

Builds report payloads for a requested range, including the raw rows behind
every figure.

    GET /reports/build      one payload with every section the caller asked for
    GET /reports/raw        raw telemetry rows only, for a CSV export
    GET /reports/coverage   what the range actually holds, without the data

Query params:

    from=YYYY-MM-DD    inclusive     to=YYYY-MM-DD   inclusive
    uid=DAL00001       single scale, omit for the caller's whole fleet
    sections=total,category,scale,meals,raw    default: total,category,scale
    limit=5000         cap on raw rows returned  (default MAX_RAW_ROWS)

--------------------------------------------------------------------------
WHY RAW ROWS SHIP WITH THE AGGREGATES
--------------------------------------------------------------------------
A report that carries only totals cannot be checked. When a number looks
wrong — and in waste data it often does, because one mis-tared scale can
swing a week — the only useful next question is "which deposits made that
up", and an aggregate cannot answer it. Shipping the rows alongside the
summary means the CSV is auditable at the point it is read, rather than
sending someone back to the dashboard to reconstruct it.

`sections=raw` is opt-in for that reason: it is by far the largest part of the
payload, and a monthly fleet export runs to thousands of rows.

--------------------------------------------------------------------------
COVERAGE
--------------------------------------------------------------------------
Identical contract to the analytics Lambda: every response carries a
`coverage` block stating which days were requested, which hold data, which
are missing, and — when the range is empty — where the nearest data is. A
report is a document someone forwards to a stakeholder; it has to be able to
say "this covers 15–30 June, not the whole month" on its own face.

--------------------------------------------------------------------------
ENVIRONMENT
--------------------------------------------------------------------------
    READINGS_TABLE   default: IWM
    SCALES_TABLE     default: iwm-scales
    JWT_SECRET       must match the auth Lambda
    ALLOWED_ORIGIN   default: *
    MAX_DAYS         longest range accepted       default: 366
    MAX_ROWS         rows scanned per request     default: 20000
    MAX_RAW_ROWS     rows returned in `raw`       default: 5000
"""

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

MAX_DAYS = int(os.environ.get("MAX_DAYS", "366"))
MAX_ROWS = int(os.environ.get("MAX_ROWS", "20000"))
MAX_RAW_ROWS = int(os.environ.get("MAX_RAW_ROWS", "5000"))
DEFAULT_DAYS = int(os.environ.get("DEFAULT_DAYS", "7"))

UID_CACHE_TTL = int(os.environ.get("UID_CACHE_TTL", "300"))
_uid_cache = {"uids": None, "at": 0.0}

CATEGORY_COLORS = {
    "Overproduction": "#EF4444",
    "Prep Waste": "#F59E0B",
    "Storage EXP": "#A78BFA",
}
UNCATEGORISED = "Uncategorised"
UNCATEGORISED_COLOR = "#64748B"

DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

MEAL_ORDER = ["breakfast", "lunch", "snacks", "dinner", "night"]
MEAL_LABELS = {
    "breakfast": "Breakfast", "lunch": "Lunch", "snacks": "Snacks",
    "dinner": "Dinner", "night": "Night",
}
DEFAULT_MEAL_PERIODS = [
    {"key": "breakfast", "label": "Breakfast", "from": "04:00", "to": "07:59"},
    {"key": "lunch", "label": "Lunch", "from": "08:00", "to": "11:59"},
    {"key": "snacks", "label": "Snacks", "from": "12:00", "to": "15:59"},
    {"key": "dinner", "label": "Dinner", "from": "16:00", "to": "19:59"},
    {"key": "night", "label": "Night", "from": "20:00", "to": "03:59"},
]
OUTSIDE_KEY = "outside"
OUTSIDE_LABEL = "Outside service hours"

ALL_SECTIONS = ("total", "category", "scale", "meals", "daily", "raw")
DEFAULT_SECTIONS = ("total", "category", "scale")

# Column order for the raw CSV — mirrors the device export so an operator can
# line an IWM export up against the scale's own file without re-mapping it.
RAW_COLUMNS = [
    "UID", "Date", "Time", "PerDepositWeight", "RunningTotalWeight",
    "Message1", "Message2", "Message3",
]

_dynamodb = boto3.resource("dynamodb")
_readings = _dynamodb.Table(READINGS_TABLE)
_scales = _dynamodb.Table(SCALES_TABLE)


# ==========================================================================
# Auth / transport
# ==========================================================================

def _b64url_decode(segment: str) -> bytes:
    import base64
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


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
    date_time = str(item.get("DateTime", "") or "")
    date = str(item.get("Date", "") or "")
    tme = str(item.get("Time", "") or "")

    if date_time and (not date or not tme):
        marker = "T" if "T" in date_time else " "
        head, _, tail = date_time.partition(marker)
        date = date or head
        tme = tme or tail[:8]

    return {
        "uid": str(item.get("UID", "") or ""),
        "dateTime": date_time,
        "date": date[:10],
        "time": tme,
        "perDepositWeight": _to_float(item.get("PerDepositWeight")),
        "runningTotalWeight": _to_float(item.get("RunningTotalWeight")),
        "message1": str(item.get("Message1", "") or ""),
        "message2": str(item.get("Message2", "") or ""),
        "message3": str(item.get("Message3", "") or ""),
    }


def positive_kg(r):
    return max(0.0, r["perDepositWeight"])


def parse_date(value):
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def category_of(reading: dict) -> str:
    msg = (reading.get("message2") or "").strip()
    for known in CATEGORY_COLORS:
        if msg.lower() == known.lower():
            return known
    return UNCATEGORISED


# ==========================================================================
# Data access
# ==========================================================================

def discover_uids():
    now = time.time()
    if _uid_cache["uids"] is not None and now - _uid_cache["at"] < UID_CACHE_TTL:
        return _uid_cache["uids"]

    uids, kwargs = set(), {
        "ProjectionExpression": "#u",
        "ExpressionAttributeNames": {"#u": "UID"},
    }
    try:
        while True:
            page = _readings.scan(**kwargs)
            for item in page.get("Items", []):
                if item.get("UID"):
                    uids.add(str(item["UID"]))
            key = page.get("LastEvaluatedKey")
            if not key:
                break
            kwargs["ExclusiveStartKey"] = key
    except ClientError as err:
        print(f"ERROR discover_uids: {err}")
        return []

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

def assigned_scales(email: str):
    """Full records of every scale this user is an assignee of."""
    email = (email or "").strip().lower()
    if not email:
        return []
    try:
        result = _scales.scan(
            FilterExpression="contains(#ae, :e) OR #a = :e",
            ExpressionAttributeNames={"#ae": "assignedEmails", "#a": "assignedEmail"},
            ExpressionAttributeValues={":e": email},
        )
        return result.get("Items", [])
    except ClientError as err:
        print(f"ERROR assigned_scales: {err}")
        return []


def get_scale(uid: str):
    try:
        return _scales.get_item(Key={"scaleId": uid}).get("Item")
    except ClientError as err:
        print(f"ERROR get_scale {uid}: {err}")
        return None


def query_window(uid, start_iso, end_iso, limit):
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


def query_edge(uid, boundary_iso, direction):
    condition = (
        Key("UID").eq(uid) & Key("DateTime").lt(boundary_iso)
        if direction == "before"
        else Key("UID").eq(uid) & Key("DateTime").gt(boundary_iso)
    )
    try:
        page = _readings.query(
            KeyConditionExpression=condition,
            ScanIndexForward=(direction == "after"),
            Limit=1,
        )
        items = page.get("Items", [])
        return normalize_reading(items[0]) if items else None
    except ClientError as err:
        print(f"ERROR query_edge {uid} {direction}: {err}")
        return None


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


def scoped_uids(claims, wanted_uid):
    is_admin = claims["role"] == "admin"
    if is_admin:
        allowed = discover_uids()
    else:
        # Assigned scale IDs come from iwm-scales; the readings are keyed by
        # whatever the DEVICE sends. Nothing keeps the two spellings in step —
        # a record saved as "GUELPH04" against telemetry arriving as "Guelph04"
        # is one scale — and the partition key is case-sensitive, so handing
        # the stored spelling straight to a query returns nothing at all. No
        # error, just an empty page.
        #
        # resolve_uid was already used for an explicitly requested ?uid=, but
        # not for the caller's own scope, which is what every unfiltered
        # request uses. Admins never hit this because discover_uids() reads the
        # readings table directly, which is why it showed only on the client
        # side.
        #
        # The scan behind discover_uids is cached in module scope
        # (UID_CACHE_TTL), so this costs one scan per warm container rather
        # than one per request.
        assigned = [
            str(s.get("scaleId")) for s in assigned_scales(claims.get("email", "")) if s.get("scaleId")
        ]
        known = discover_uids()
        allowed, seen = [], set()
        for scale_id in assigned:
            # An assigned scale that has never reported keeps its own spelling
            # and simply returns nothing: registered but silent, not misspelled.
            uid = resolve_uid(scale_id, known) or scale_id
            # Two records differing only by case are one device; querying it
            # twice would double every row.
            if uid not in seen:
                seen.add(uid)
                allowed.append(uid)

    if wanted_uid:
        match = resolve_uid(wanted_uid, allowed)
        if not match:
            return None, respond(
                403, {"message": "That scale is not assigned to you"}
            )
        return [match], None
    return allowed, None


# ==========================================================================
# Range and coverage  (contract shared with the analytics Lambda)
# ==========================================================================

def resolve_range(params):
    today = datetime.now(timezone.utc).date()

    raw_from = (params.get("from") or "").strip()[:10]
    raw_to = (params.get("to") or "").strip()[:10]

    date_to = parse_date(raw_to) if raw_to else today
    if raw_to and date_to is None:
        return None, None, respond(400, {"message": f"Invalid 'to' date: {raw_to}"})

    if raw_from:
        date_from = parse_date(raw_from)
        if date_from is None:
            return None, None, respond(400, {"message": f"Invalid 'from' date: {raw_from}"})
    else:
        date_from = date_to - timedelta(days=DEFAULT_DAYS)

    if date_from > date_to:
        return None, None, respond(400, {"message": "'from' must fall on or before 'to'"})

    span = (date_to - date_from).days + 1
    if span > MAX_DAYS:
        return None, None, respond(
            400, {"message": f"Range spans {span} days; the maximum is {MAX_DAYS}."}
        )

    return date_from, date_to, None


def fetch_range(uids, date_from, date_to):
    start_iso = f"{date_from.isoformat()}T00:00:00"
    end_iso = f"{date_to.isoformat()}T23:59:59"

    per_uid = max(100, MAX_ROWS // max(1, len(uids)))
    raw = []
    for uid in uids:
        raw.extend(query_window(uid, start_iso, end_iso, per_uid))

    readings = [normalize_reading(i) for i in raw]
    readings = [r for r in readings if r["uid"] and r["date"]]
    readings.sort(key=lambda r: r["dateTime"] or f"{r['date']}T{r['time']}", reverse=True)
    return readings[:MAX_ROWS]


def _contiguous_ranges(days):
    if not days:
        return []
    runs, start, prev = [], days[0], days[0]
    for d in days[1:]:
        if (d - prev).days == 1:
            prev = d
            continue
        runs.append((start, prev))
        start = prev = d
    runs.append((start, prev))
    return runs


def find_nearest(uids, date_from, date_to):
    before_iso = f"{date_from.isoformat()}T00:00:00"
    after_iso = f"{date_to.isoformat()}T23:59:59"

    best_before, best_after = None, None
    for uid in uids:
        b = query_edge(uid, before_iso, "before")
        if b and (best_before is None or b["dateTime"] > best_before["dateTime"]):
            best_before = b
        a = query_edge(uid, after_iso, "after")
        if a and (best_after is None or a["dateTime"] < best_after["dateTime"]):
            best_after = a

    return {
        "before": {"date": best_before["date"], "uid": best_before["uid"]} if best_before else None,
        "after": {"date": best_after["date"], "uid": best_after["uid"]} if best_after else None,
    }


def build_coverage(readings, uids, date_from, date_to):
    requested = {"from": date_from.isoformat(), "to": date_to.isoformat()}
    span_days = (date_to - date_from).days + 1

    present = sorted({d for d in (parse_date(r["date"]) for r in readings) if d})

    if not present:
        nearest = find_nearest(uids, date_from, date_to)
        parts = []
        if nearest["before"]:
            parts.append(f"latest earlier data is {nearest['before']['date']}")
        if nearest["after"]:
            parts.append(f"earliest later data is {nearest['after']['date']}")
        tail = f" The {' and the '.join(parts)}." if parts else ""
        return {
            "requested": requested,
            "actual": None,
            "status": "empty",
            "complete": False,
            "daysRequested": span_days,
            "daysWithData": 0,
            "missing": [requested],
            "nearest": nearest,
            "message": (
                f"No data available between {requested['from']} and {requested['to']}.{tail}"
            ),
        }

    all_days = {date_from + timedelta(days=i) for i in range(span_days)}
    missing_days = sorted(all_days - set(present))
    missing = [
        {"from": a.isoformat(), "to": b.isoformat()} for a, b in _contiguous_ranges(missing_days)
    ]

    actual = {"from": present[0].isoformat(), "to": present[-1].isoformat()}
    complete = not missing

    if complete:
        message = f"Showing {actual['from']} to {actual['to']} — full coverage."
    else:
        gaps = ", ".join(
            m["from"] if m["from"] == m["to"] else f"{m['from']} to {m['to']}" for m in missing[:3]
        )
        more = f" (+{len(missing) - 3} more)" if len(missing) > 3 else ""
        message = f"Showing {actual['from']} to {actual['to']}. No data for {gaps}{more}."

    return {
        "requested": requested,
        "actual": actual,
        "status": "full" if complete else "partial",
        "complete": complete,
        "daysRequested": span_days,
        "daysWithData": len(present),
        "missing": missing,
        "nearest": None,
        "message": message,
    }


# ==========================================================================
# Service periods
# ==========================================================================

def _minutes(hhmm):
    m = TIME_RE.match(str(hhmm or ""))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def _reading_minutes(r):
    t = str(r.get("time") or "")
    if len(t) < 5:
        return None
    try:
        return int(t[0:2]) * 60 + int(t[3:5])
    except ValueError:
        return None


def _in_window(minute, start, end):
    """Inclusive, and correct for windows that cross midnight (20:00 -> 03:59)."""
    if start <= end:
        return start <= minute <= end
    return minute >= start or minute <= end


def resolve_periods(scale_item):
    schedule = (scale_item or {}).get("mealSchedule") or {}
    windows = []
    for key in MEAL_ORDER:
        window = schedule.get(key)
        if not isinstance(window, dict):
            continue
        start, end = _minutes(window.get("from")), _minutes(window.get("to"))
        if start is None or end is None:
            continue
        windows.append(
            {"key": key, "label": MEAL_LABELS[key], "from": window["from"], "to": window["to"]}
        )
    if windows:
        return windows, "scale"
    return list(DEFAULT_MEAL_PERIODS), "default"


def meal_periods(readings, periods):
    bounds = []
    for p in periods:
        start, end = _minutes(p["from"]), _minutes(p["to"])
        if start is not None and end is not None:
            bounds.append((p, start, end))

    totals = {p["key"]: 0.0 for p, _, _ in bounds}
    counts = {p["key"]: 0 for p, _, _ in bounds}
    totals[OUTSIDE_KEY] = 0.0
    counts[OUTSIDE_KEY] = 0

    for r in readings:
        minute = _reading_minutes(r)
        if minute is None:
            continue
        kg = positive_kg(r)
        deposited = 1 if r["perDepositWeight"] > 0 else 0
        for p, start, end in bounds:
            if _in_window(minute, start, end):
                totals[p["key"]] += kg
                counts[p["key"]] += deposited
                break
        else:
            totals[OUTSIDE_KEY] += kg
            counts[OUTSIDE_KEY] += deposited

    rows = [
        {
            "key": p["key"],
            "label": p["label"],
            "window": f"{p['from']}–{p['to']}",
            "value": round(totals[p["key"]], 1),
            "deposits": counts[p["key"]],
        }
        for p, _, _ in bounds
    ]
    if counts[OUTSIDE_KEY]:
        rows.append(
            {
                "key": OUTSIDE_KEY,
                "label": OUTSIDE_LABEL,
                "window": "—",
                "value": round(totals[OUTSIDE_KEY], 1),
                "deposits": counts[OUTSIDE_KEY],
            }
        )
    return rows


# ==========================================================================
# Report sections
# ==========================================================================

def section_total(readings, date_from, date_to):
    total = sum(positive_kg(r) for r in readings)
    by_day = defaultdict(float)
    for r in readings:
        d = parse_date(r["date"])
        if d:
            by_day[d] += positive_kg(r)

    days_with_data = len(by_day)
    peak = max(by_day.items(), key=lambda kv: kv[1]) if by_day else None

    return {
        "totalKg": round(total, 1),
        "deposits": sum(1 for r in readings if r["perDepositWeight"] > 0),
        "scalesReporting": len({r["uid"] for r in readings}),
        "daysWithData": days_with_data,
        "daysRequested": (date_to - date_from).days + 1,
        # Divided by days that actually reported. Dividing by the requested
        # span would understate the rate whenever coverage is partial, and
        # every partial range would quietly read as an improvement.
        "avgPerActiveDayKg": round(total / days_with_data, 1) if days_with_data else 0,
        "peakDay": {"date": peak[0].isoformat(), "value": round(peak[1], 1)} if peak else None,
    }


def section_category(readings):
    totals = defaultdict(float)
    counts = defaultdict(int)
    for r in readings:
        c = category_of(r)
        totals[c] += positive_kg(r)
        counts[c] += 1
    grand = sum(totals.values())
    return [
        {
            "name": name,
            "value": round(value, 1),
            "deposits": counts[name],
            "pctOfTotal": round((value / grand) * 100, 1) if grand else 0,
            "color": CATEGORY_COLORS.get(name, UNCATEGORISED_COLOR),
        }
        for name, value in sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
        if value > 0
    ]


def section_scale(readings, records):
    """
    Per-scale activity, derived from telemetry.

    Deliberately not read from the scale record's `lastReading` / `status`
    fields: nothing writes them, so a report built on those prints 0 kg and
    "offline" against every device however much it actually weighed.
    """
    totals = defaultdict(float)
    counts = defaultdict(int)      # deposits: rows that actually added waste
    rows_seen = defaultdict(int)   # every row, including removals and events
    minimums = {}
    maximums = {}
    last_seen = {}

    for r in readings:
        uid = r["uid"]
        kg = r["perDepositWeight"]
        totals[uid] += positive_kg(r)
        rows_seen[uid] += 1
        # "deposits" means the same thing everywhere in this file: a row that
        # actually added waste. Removals and tare corrections are rows, not
        # deposits, and counting them here would disagree with the total.
        if kg > 0:
            counts[uid] += 1
        if uid not in minimums or kg < minimums[uid]:
            minimums[uid] = kg
        if uid not in maximums or kg > maximums[uid]:
            maximums[uid] = kg
        if uid not in last_seen or r["dateTime"] > last_seen[uid]:
            last_seen[uid] = r["dateTime"]

    def stats(uid):
        # A negative minimum is a bin removal or a tare correction, not a
        # deposit. Reported as a lightest-deposit figure it reads as nonsense
        # ("smallest deposit: -18 kg"), so it is floored at zero — and
        # `hadNegative` preserves the fact that one occurred, since a scale
        # producing large negatives is worth looking at separately.
        raw_min = minimums.get(uid, 0.0)
        return {
            "readings": rows_seen.get(uid, 0),
            "deposits": counts.get(uid, 0),
            "totalKg": round(totals.get(uid, 0.0), 1),
            "minKg": round(max(0.0, raw_min), 2),
            "maxKg": round(max(0.0, maximums.get(uid, 0.0)), 2),
            "hadNegative": raw_min < 0,
            "avgKg": round(totals.get(uid, 0.0) / counts[uid], 2) if counts.get(uid) else 0,
        }

    by_id = {str(s.get("scaleId")): s for s in records if s.get("scaleId")}
    rows = []
    for uid, item in sorted(by_id.items()):
        rows.append(
            {
                "uid": uid,
                "name": str(item.get("name") or uid),
                "location": str(item.get("location") or "—"),
                "lastReading": last_seen.get(uid, ""),
                "reportedInRange": uid in totals,
                **stats(uid),
            }
        )
    # Devices sending telemetry that were never provisioned still belong in
    # the report — an unregistered scale producing waste is exactly what an
    # operator needs to see.
    for uid in sorted(set(totals) - set(by_id)):
        rows.append(
            {
                "uid": uid,
                "name": uid,
                "location": "—",
                "lastReading": last_seen.get(uid, ""),
                "reportedInRange": True,
                "registered": False,
                **stats(uid),
            }
        )
    return rows


def section_daily(readings, date_from, date_to):
    by_day = defaultdict(float)
    counts = defaultdict(int)
    for r in readings:
        d = parse_date(r["date"])
        if d:
            by_day[d] += positive_kg(r)
            counts[d] += 1

    span = (date_to - date_from).days + 1
    return [
        {
            "date": (date_from + timedelta(days=i)).isoformat(),
            "day": DAY_LABELS[(date_from + timedelta(days=i)).weekday()],
            "value": round(by_day.get(date_from + timedelta(days=i), 0.0), 1),
            "deposits": counts.get(date_from + timedelta(days=i), 0),
            "hasData": (date_from + timedelta(days=i)) in by_day,
        }
        for i in range(span)
    ]


def section_raw(readings, limit):
    """
    Raw rows in device-export order, newest first.

    `truncated` is reported explicitly rather than silently cutting the list:
    a CSV that stops early without saying so is indistinguishable from one
    where the data simply ended.
    """
    capped = readings[:limit]
    return {
        "columns": RAW_COLUMNS,
        "rows": [
            [
                r["uid"], r["date"], r["time"],
                r["perDepositWeight"], r["runningTotalWeight"],
                r["message1"], r["message2"], r["message3"],
            ]
            for r in capped
        ],
        "count": len(capped),
        "totalAvailable": len(readings),
        "truncated": len(readings) > len(capped),
    }


# ==========================================================================
# Router
# ==========================================================================

def parse_sections(params):
    raw = (params.get("sections") or "").strip()
    if not raw:
        return list(DEFAULT_SECTIONS), None
    wanted = [s.strip().lower() for s in raw.split(",") if s.strip()]
    unknown = [s for s in wanted if s not in ALL_SECTIONS]
    if unknown:
        return None, respond(
            400,
            {
                "message": f"Unknown section(s): {', '.join(unknown)}",
                "available": list(ALL_SECTIONS),
            },
        )
    return wanted, None


def lambda_handler(event, context):
    method = (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "GET"
    ).upper()
    if method == "OPTIONS":
        return respond(204)
    if method != "GET":
        return respond(405, {"message": f"{method} not allowed"})

    path = (
        event.get("rawPath")
        or event.get("path")
        or event.get("requestContext", {}).get("http", {}).get("path")
        or ""
    )
    params = event.get("queryStringParameters") or {}

    if not JWT_SECRET:
        print("ERROR: JWT_SECRET is not set")
        return respond(500, {"message": "Server is misconfigured"})

    claims = verify_token(bearer_token(event))
    if not claims:
        return respond(401, {"message": "Unauthorized"})
    claims["role"] = (claims.get("role") or "client").strip().lower()

    try:
        date_from, date_to, err = resolve_range(params)
        if err:
            return err

        wanted_uid = (params.get("uid") or "").strip()
        uids, err = scoped_uids(claims, wanted_uid)
        if err:
            return err
        # Adopt the stored spelling, so the per-scale lookups and labels below
        # use the same string the table is keyed on.
        if wanted_uid:
            wanted_uid = uids[0]

        if not uids:
            return respond(
                200,
                {
                    "coverage": {
                        "requested": {"from": date_from.isoformat(), "to": date_to.isoformat()},
                        "actual": None,
                        "status": "empty",
                        "complete": False,
                        "daysRequested": (date_to - date_from).days + 1,
                        "daysWithData": 0,
                        "missing": [
                            {"from": date_from.isoformat(), "to": date_to.isoformat()}
                        ],
                        "nearest": {"before": None, "after": None},
                        "message": "No scales are assigned to your organization yet.",
                    },
                    "sections": {},
                },
            )

        readings = fetch_range(uids, date_from, date_to)
        coverage = build_coverage(readings, uids, date_from, date_to)

        if re.search(r"/reports/coverage/?$", path):
            return respond(200, {"coverage": coverage})

        if re.search(r"/reports/raw/?$", path):
            try:
                limit = min(MAX_RAW_ROWS, max(1, int(params.get("limit") or MAX_RAW_ROWS)))
            except ValueError:
                limit = MAX_RAW_ROWS
            return respond(200, {"coverage": coverage, "raw": section_raw(readings, limit)})

        if re.search(r"/reports/build/?$", path):
            wanted, err = parse_sections(params)
            if err:
                return err

            if claims["role"] == "admin":
                records = [s for s in (get_scale(u) for u in uids) if s]
            else:
                records = assigned_scales(claims.get("email", ""))

            sections = {}
            if "total" in wanted:
                sections["total"] = section_total(readings, date_from, date_to)
            if "category" in wanted:
                sections["category"] = section_category(readings)
            if "scale" in wanted:
                sections["scale"] = section_scale(readings, records)
            if "daily" in wanted:
                sections["daily"] = section_daily(readings, date_from, date_to)
            if "meals" in wanted:
                scale_item = get_scale(wanted_uid) if wanted_uid else None
                periods, source = resolve_periods(scale_item)
                sections["meals"] = {
                    "scheduleSource": source,
                    "scheduleScale": wanted_uid or None,
                    "rows": meal_periods(readings, periods),
                }
            if "raw" in wanted:
                try:
                    limit = min(MAX_RAW_ROWS, max(1, int(params.get("limit") or MAX_RAW_ROWS)))
                except ValueError:
                    limit = MAX_RAW_ROWS
                sections["raw"] = section_raw(readings, limit)

            return respond(
                200,
                {
                    "coverage": coverage,
                    "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "scope": {
                        "uid": wanted_uid or None,
                        "scales": len(uids),
                        "role": claims["role"],
                    },
                    "sections": sections,
                },
            )

        return respond(
            404,
            {
                "message": f"No route for GET {path}",
                "available": ["/reports/build", "/reports/raw", "/reports/coverage"],
            },
        )

    except Exception as err:  # noqa: BLE001 - last line of defence
        print(f"ERROR handling {method} {path}: {type(err).__name__}: {err}")
        return respond(500, {"message": "Something went wrong. Please try again."})
