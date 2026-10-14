"""
IWM — Analytics Lambda
======================

Every chart on the Analytics page, computed server-side from raw telemetry.

    GET /analytics/coverage           what the range actually holds
    GET /analytics/summary            totals, averages, per-scale rollup
    GET /analytics/daily-trend        kg per calendar day across the range
    GET /analytics/period-comparison  this range vs the equivalent one before
    GET /analytics/category-breakdown grouped by Message2 category
    GET /analytics/hourly-waste       24 hourly buckets
    GET /analytics/meal-periods       kg per service period  (see below)
    GET /analytics/scale-comparison   per-scale totals for the range

Query params, shared by every route:

    from=YYYY-MM-DD    inclusive     to=YYYY-MM-DD    inclusive
    uid=DAL00001       single scale, omit for the caller's whole fleet

--------------------------------------------------------------------------
WHY EVERY RESPONSE CARRIES `coverage`
--------------------------------------------------------------------------
Asking for June and getting a chart back tells you nothing about whether June
is actually in the database. A range that holds two days of data draws exactly
like a range that holds thirty — same axes, same shapes, a total that looks
authoritative and is quietly answering a different question.

So no route returns bare data. Every response is:

    { "coverage": { ... }, "data": ... }

where coverage states plainly which days were requested, which were found,
which are missing, and — when nothing at all was found — where the nearest
data actually lives, on either side of the range. The caller can then say
"showing 15–30 June, no data before the 15th" instead of implying it had the
whole month.

--------------------------------------------------------------------------
TIME HANDLING
--------------------------------------------------------------------------
The deployed ingest Lambda stores the device's timestamp verbatim, so `Date`
and `Time` are the kitchen's own wall clock, with no offset. Everything here
buckets on those local fields and never converts, because every question this
file answers is a local one: "how much at lunch" means lunch where the scale
is, not lunch in UTC.

`DateTime` is used only as the DynamoDB sort key for range queries. It is the
same naive local string, so comparisons stay self-consistent — but it must not
be compared against server time.

--------------------------------------------------------------------------
ENVIRONMENT
--------------------------------------------------------------------------
    READINGS_TABLE   default: IWM
    SCALES_TABLE     default: iwm-scales
    JWT_SECRET       must match the auth Lambda
    ALLOWED_ORIGIN   default: *
    MAX_DAYS         longest range accepted            default: 366
    MAX_ROWS         hard cap on rows scanned          default: 20000
    NEAREST_LOOKUP   search for nearest data when empty  default: 1 (on)
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
DEFAULT_DAYS = int(os.environ.get("DEFAULT_DAYS", "7"))
NEAREST_LOOKUP = os.environ.get("NEAREST_LOOKUP", "1") not in ("0", "false", "False")

UID_CACHE_TTL = int(os.environ.get("UID_CACHE_TTL", "300"))
_uid_cache = {"uids": None, "at": 0.0}

# Message2 doubles as a category tag and a device event log. Only these three
# are categories; anything else ("Wifi Reconnected", blanks) is an event and
# must not be counted as waste.
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

TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

# --------------------------------------------------------------------------
# Service periods
# --------------------------------------------------------------------------
# The fleet-wide default tiles the whole 24 hours with no gaps, so every
# reading lands in exactly one period and the bars always sum to the range
# total. A set of narrow windows around each meal would leave mid-afternoon
# and overnight deposits unattributed, and a "meal comparison" that silently
# drops a slice of the day is worse than none.
#
# Order matters: periods are matched top to bottom, so the first window
# containing a reading wins.
DEFAULT_MEAL_PERIODS = [
    {"key": "breakfast", "label": "Breakfast", "from": "04:00", "to": "07:59"},
    {"key": "lunch", "label": "Lunch", "from": "08:00", "to": "11:59"},
    {"key": "snacks", "label": "Snacks", "from": "12:00", "to": "15:59"},
    {"key": "dinner", "label": "Dinner", "from": "16:00", "to": "19:59"},
    {"key": "night", "label": "Night", "from": "20:00", "to": "03:59"},
]

MEAL_ORDER = ["breakfast", "lunch", "snacks", "dinner", "night"]
MEAL_LABELS = {
    "breakfast": "Breakfast",
    "lunch": "Lunch",
    "snacks": "Snacks",
    "dinner": "Dinner",
    "night": "Night",
}
MEAL_COLORS = {
    "breakfast": "#F59E0B",
    "lunch": "#22C55E",
    "snacks": "#38BDF8",
    "dinner": "#A78BFA",
    "night": "#64748B",
}
# Where readings fall when a scale's own schedule leaves parts of the day
# uncovered. Named rather than dropped, so the bars still reconcile to the
# total and a kitchen can see how much it is throwing away off-shift.
OUTSIDE_KEY = "outside"
OUTSIDE_LABEL = "Outside service hours"
OUTSIDE_COLOR = "#475569"

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

    # Derive Date/Time for any row that lacks them.
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
    """Only deposits count as waste; negatives are removals or corrections."""
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
    """Every UID present in the readings table. Cached across warm invocations."""
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
        result = _scales.get_item(Key={"scaleId": uid})
        return result.get("Item")
    except ClientError as err:
        print(f"ERROR get_scale {uid}: {err}")
        return None


def query_window(uid, start_iso, end_iso, limit):
    """Readings for one device within a window, newest first."""
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
    """
    The single nearest reading outside a range.

    `direction` is "before" (latest row earlier than the range) or "after"
    (earliest row later than it). This is what lets an empty result say where
    the data actually is, instead of only that the range is empty.
    """
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
    """
    UIDs this caller may read, narrowed to one if requested.

    Returns (uids, error_response).
    """
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
        # Matched case-insensitively, then queried with the stored spelling —
        # see resolve_uid. The readings and reports Lambdas were changed to do
        # this and analytics was left on an exact match, so a scale like
        # "Scotttest4" still failed here while working everywhere else.
        match = resolve_uid(wanted_uid, allowed)
        if not match:
            return None, respond(
                403, {"message": "That scale is not assigned to you"}
            )
        return [match], None
    return allowed, None


# ==========================================================================
# Range resolution and coverage
# ==========================================================================

def resolve_range(params):
    """
    Returns (date_from, date_to, error_response) as dates.

    Unlike the readings Lambda this does not silently widen a bad range: a
    caller asking for a specific month is making a claim about what it wants,
    and quietly answering a different question is how a chart ends up
    mislabelled.
    """
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
        return None, None, respond(
            400, {"message": "'from' must fall on or before 'to'"}
        )

    span = (date_to - date_from).days + 1
    if span > MAX_DAYS:
        return None, None, respond(
            400,
            {"message": f"Range spans {span} days; the maximum is {MAX_DAYS}."},
        )

    return date_from, date_to, None


def fetch_range(uids, date_from, date_to):
    """All readings for the given devices across the range, newest first."""
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
    """Collapses a sorted list of dates into [(start, end), ...] runs."""
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
    """
    Closest data on each side of an empty range.

    Answers "there is nothing in June, but there is data up to 14 May and
    again from 3 July" — which is the difference between a dead end and a
    usable next step.
    """
    if not NEAREST_LOOKUP:
        return {"before": None, "after": None}

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
    """
    What the requested range actually contains.

    `missing` lists every stretch of days inside the range that holds no
    readings at all — leading, trailing and interior alike, since a fortnight
    missing from the middle misleads exactly as much as one missing from the
    front.
    """
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
        message = (
            f"Showing {actual['from']} to {actual['to']}. "
            f"No data for {gaps}{more}."
        )

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


def envelope(coverage, data, **extra):
    body = {"coverage": coverage, "data": data}
    body.update(extra)
    return body


# ==========================================================================
# Service periods
# ==========================================================================

def _minutes(hhmm):
    m = TIME_RE.match(str(hhmm or ""))
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


def _reading_minutes(r):
    t = str(r.get("time") or "")
    if len(t) < 5:
        return None
    try:
        return int(t[0:2]) * 60 + int(t[3:5])
    except ValueError:
        return None


def _in_window(minute, start, end):
    """
    Inclusive window test that understands midnight crossing.

    A night service running 20:00 -> 03:59 has start > end; treating that
    literally would match nothing, which is precisely the shift where a
    kitchen is least likely to be watching.
    """
    if start <= end:
        return start <= minute <= end
    return minute >= start or minute <= end


def resolve_periods(scale_item):
    """
    The service periods to bucket by.

    A scale's own `mealSchedule` wins when it has one, because the whole point
    of configuring service times is that this kitchen's lunch is not the
    default's. Falls back to the fleet-wide tiling otherwise.

    Returns (periods, source) where source is "scale" or "default".
    """
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


def meal_periods(readings, periods, source):
    """
    kg per service period, plus deposit counts.

    Every reading lands somewhere: anything outside all configured windows is
    reported under "Outside service hours" rather than dropped, so the bars
    always reconcile to the range total. With the default tiling that bucket
    is always zero; with a scale's own narrow windows it is often the most
    interesting bar on the chart.
    """
    bounds = []
    for p in periods:
        start, end = _minutes(p["from"]), _minutes(p["to"])
        if start is None or end is None:
            continue
        bounds.append((p, start, end))

    totals = {p["key"]: 0.0 for p, _, _ in bounds}
    counts = {p["key"]: 0 for p, _, _ in bounds}
    totals[OUTSIDE_KEY] = 0.0
    counts[OUTSIDE_KEY] = 0
    unattributed = 0

    for r in readings:
        kg = positive_kg(r)
        minute = _reading_minutes(r)
        if minute is None:
            unattributed += 1
            continue

        # "deposits" means the same thing across every route here: a row that
        # actually added waste. Removals and tare corrections are rows, not
        # deposits, and counting them would disagree with the kg beside them.
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
            "color": MEAL_COLORS.get(p["key"], UNCATEGORISED_COLOR),
        }
        for p, _, _ in bounds
    ]

    # Only surface the overflow bucket when it actually caught something,
    # so a fully-tiled default schedule doesn't grow a permanent empty bar.
    if counts[OUTSIDE_KEY]:
        rows.append(
            {
                "key": OUTSIDE_KEY,
                "label": OUTSIDE_LABEL,
                "window": "—",
                "value": round(totals[OUTSIDE_KEY], 1),
                "deposits": counts[OUTSIDE_KEY],
                "color": OUTSIDE_COLOR,
            }
        )

    return rows, unattributed


# ==========================================================================
# Aggregates
# ==========================================================================

def _totals_by_day(readings):
    by_day = defaultdict(float)
    for r in readings:
        d = parse_date(r["date"])
        if d:
            by_day[d] += positive_kg(r)
    return by_day


def summary(readings, date_from, date_to):
    total = sum(positive_kg(r) for r in readings)
    by_day = _totals_by_day(readings)
    days_with_data = len(by_day)
    uids = {r["uid"] for r in readings}
    peak_day = max(by_day.items(), key=lambda kv: kv[1]) if by_day else None

    return {
        "totalKg": round(total, 1),
        "deposits": sum(1 for r in readings if r["perDepositWeight"] > 0),
        "rows": len(readings),
        "scalesReporting": len(uids),
        # Averaged over days that actually hold data, not over the requested
        # span: dividing by thirty when only two days reported understates the
        # daily rate by fifteen times.
        "avgPerActiveDayKg": round(total / days_with_data, 1) if days_with_data else 0,
        "avgPerRequestedDayKg": round(total / ((date_to - date_from).days + 1), 1),
        "peakDay": (
            {"date": peak_day[0].isoformat(), "value": round(peak_day[1], 1)} if peak_day else None
        ),
    }


def daily_trend(readings, date_from, date_to):
    """
    kg per calendar day, including days with none.

    Zero-filling is deliberate: a line that skips empty days draws a straight
    segment between the points either side, which reads as steady activity
    across a gap where there was none.
    """
    by_day = _totals_by_day(readings)
    span = (date_to - date_from).days + 1
    out = []
    for i in range(span):
        d = date_from + timedelta(days=i)
        out.append(
            {
                "date": d.isoformat(),
                "day": DAY_LABELS[d.weekday()],
                "value": round(by_day.get(d, 0.0), 1),
                "hasData": d in by_day,
            }
        )
    return out


def period_comparison(readings, previous, date_from, date_to):
    """This range against the equally-long one immediately before it."""
    this_total = sum(positive_kg(r) for r in readings)
    prev_total = sum(positive_kg(r) for r in previous)
    change = round(((this_total - prev_total) / prev_total) * 100, 1) if prev_total else None
    span = (date_to - date_from).days + 1
    prev_to = date_from - timedelta(days=1)
    prev_from = prev_to - timedelta(days=span - 1)
    return {
        "current": {
            "from": date_from.isoformat(),
            "to": date_to.isoformat(),
            "value": round(this_total, 1),
        },
        "previous": {
            "from": prev_from.isoformat(),
            "to": prev_to.isoformat(),
            "value": round(prev_total, 1),
            "hadData": bool(previous),
        },
        # None rather than 0 when there is nothing to compare against: "no
        # change" and "no baseline" are different answers.
        "changePct": change,
    }


def category_breakdown(readings):
    totals = defaultdict(float)
    for r in readings:
        totals[category_of(r)] += positive_kg(r)
    return [
        {
            "name": name,
            "value": round(value, 1),
            "color": CATEGORY_COLORS.get(name, UNCATEGORISED_COLOR),
        }
        for name, value in sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
        if value > 0
    ]


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


def scale_comparison(readings, names):
    totals = defaultdict(float)
    counts = defaultdict(int)
    last_seen = {}
    for r in readings:
        totals[r["uid"]] += positive_kg(r)
        if r["perDepositWeight"] > 0:
            counts[r["uid"]] += 1
        if r["uid"] not in last_seen or r["dateTime"] > last_seen[r["uid"]]:
            last_seen[r["uid"]] = r["dateTime"]

    return [
        {
            "uid": uid,
            "name": names.get(uid, uid),
            "value": round(total, 1),
            "deposits": counts[uid],
            "lastReading": last_seen.get(uid, ""),
        }
        for uid, total in sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    ]


# ==========================================================================
# Router
# ==========================================================================

ROUTES = (
    "coverage", "summary", "daily-trend", "period-comparison",
    "category-breakdown", "hourly-waste", "meal-periods", "scale-comparison",
)


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
            empty = {
                "requested": {"from": date_from.isoformat(), "to": date_to.isoformat()},
                "actual": None,
                "status": "empty",
                "complete": False,
                "daysRequested": (date_to - date_from).days + 1,
                "daysWithData": 0,
                "missing": [{"from": date_from.isoformat(), "to": date_to.isoformat()}],
                "nearest": {"before": None, "after": None},
                "message": "No scales are assigned to you yet.",
            }
            return respond(200, envelope(empty, []))

        readings = fetch_range(uids, date_from, date_to)
        coverage = build_coverage(readings, uids, date_from, date_to)

        if re.search(r"/analytics/coverage/?$", path):
            return respond(200, envelope(coverage, None))

        if re.search(r"/analytics/summary/?$", path):
            return respond(200, envelope(coverage, summary(readings, date_from, date_to)))

        if re.search(r"/analytics/daily-trend/?$", path):
            return respond(200, envelope(coverage, daily_trend(readings, date_from, date_to)))

        if re.search(r"/analytics/period-comparison/?$", path):
            span = (date_to - date_from).days + 1
            prev_to = date_from - timedelta(days=1)
            prev_from = prev_to - timedelta(days=span - 1)
            previous = fetch_range(uids, prev_from, prev_to)
            return respond(
                200,
                envelope(coverage, period_comparison(readings, previous, date_from, date_to)),
            )

        if re.search(r"/analytics/category-breakdown/?$", path):
            return respond(200, envelope(coverage, category_breakdown(readings)))

        if re.search(r"/analytics/hourly-waste/?$", path):
            return respond(200, envelope(coverage, hourly_waste(readings)))

        if re.search(r"/analytics/meal-periods/?$", path):
            # A single scale gets its own configured service times; a mixed
            # fleet has no single correct schedule, so the default tiling is
            # the only honest basis for comparing them.
            scale_item = get_scale(wanted_uid) if wanted_uid else None
            periods, source = resolve_periods(scale_item)
            rows, unattributed = meal_periods(readings, periods, source)
            return respond(
                200,
                envelope(
                    coverage,
                    rows,
                    scheduleSource=source,
                    scheduleScale=wanted_uid or None,
                    unattributedRows=unattributed,
                ),
            )

        if re.search(r"/analytics/scale-comparison/?$", path):
            if claims["role"] == "admin":
                records = []
                for uid in uids:
                    item = get_scale(uid)
                    if item:
                        records.append(item)
            else:
                records = assigned_scales(claims.get("email", ""))
            names = {
                str(s.get("scaleId")): str(s.get("name") or s.get("scaleId"))
                for s in records
                if s.get("scaleId")
            }
            return respond(200, envelope(coverage, scale_comparison(readings, names)))

        return respond(
            404,
            {"message": f"No route for GET {path}", "available": list(ROUTES)},
        )

    except Exception as err:  # noqa: BLE001 - last line of defence
        print(f"ERROR handling {method} {path}: {type(err).__name__}: {err}")
        return respond(500, {"message": "Something went wrong. Please try again."})
