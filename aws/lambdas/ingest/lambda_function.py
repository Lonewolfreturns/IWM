"""
IWM — Sensor Ingest Lambda
==========================

╔════════════════════════════════════════════════════════════════════════╗
║  NOT DEPLOYED — DO NOT PUSH THIS WITHOUT A MIGRATION PLAN              ║
║                                                                        ║
║  The live ingest function does NOT do any of the timestamp handling    ║
║  described below. It stores the device's string verbatim:              ║
║                                                                        ║
║      'DateTime': date_time          # exactly as sent, naive local     ║
║      'Date':     clean_date         # the part before the "T"          ║
║      'Time':     time_str                                              ║
║                                                                        ║
║  It writes no LocalDateTime, no SourceDateTime, no SourceTimeZone.     ║
║                                                                        ║
║  So every row currently in DynamoDB holds a naive, device-local        ║
║  wall clock. The frontend is built on that fact: it anchors each       ║
║  reading using the producing scale's configured `timeZone` (see        ║
║  frontend/src/lib/time.js).                                            ║
║                                                                        ║
║  Deploying this file would start writing UTC into `DateTime` while     ║
║  every existing row stays local, leaving the table holding two         ║
║  incompatible meanings in one column with nothing to tell them apart.  ║
║  Any rollout needs a backfill and a matching frontend change.          ║
╚════════════════════════════════════════════════════════════════════════╝

Writes one reading from a scale into the `IWM` DynamoDB table.

This replaces the original ingest function. The behaviour is the same, with
one significant change: **timestamps are normalised**.

--------------------------------------------------------------------------
WHY TIMESTAMPS ARE SPLIT ACROSS TWO REPRESENTATIONS
--------------------------------------------------------------------------
Two consumers want two different things from the same instant:

* The **sort key** (`DateTime`) is compared against server time — for the live
  "±60 seconds" window, for range queries, and for ordering. That has to be
  **UTC**, or a device reporting Halifax local time appears to be three or four
  hours in the past and the live window never matches.

* The **human-facing fields** (`Date`, `Time`) drive "today's total" and "peak
  waste hours". Those must stay **local**, or a 9pm deposit in Halifax lands on
  the next day at midnight UTC and the kitchen's own numbers look wrong.

So both are stored:

    DateTime        UTC     sort key, machine ordering / live window
    Date, Time      local   daily + hourly analytics, shown to users
    LocalDateTime   local   full local instant, kept for traceability
    SourceDateTime  raw     exactly what the device sent, never reinterpreted

Keeping the untouched original means a timezone misconfiguration is always
recoverable — nothing is destroyed on write.

--------------------------------------------------------------------------
ACCEPTED INPUT
--------------------------------------------------------------------------
`DateTime` may arrive as any of:

    2025-06-12T14:22:00          naive  -> interpreted as SOURCE_TZ
    2025-06-12 14:22:00          naive  -> interpreted as SOURCE_TZ
    2025-06-12T14:22:00Z         UTC
    2025-06-12T14:22:00-03:00    explicit offset

Offset-aware input is trusted as-is; only naive input is interpreted using
SOURCE_TZ. If a device is ever upgraded to send offsets, this keeps working
with no change.

--------------------------------------------------------------------------
ENVIRONMENT VARIABLES
--------------------------------------------------------------------------
    TABLE_NAME    default: IWM
    SOURCE_TZ     IANA zone the devices report in   default: America/Halifax
    SOURCE_UTC_OFFSET_HOURS  fallback if the runtime has no tz database,
                             e.g. "-3"              default: unset

Set SOURCE_TZ to "UTC" if the scales already report UTC — everything then
passes through unchanged.
"""

import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

import boto3

TABLE_NAME = os.environ.get("TABLE_NAME", "IWM")
SOURCE_TZ = os.environ.get("SOURCE_TZ", "America/Halifax")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


def _resolve_source_zone():
    """
    Resolves SOURCE_TZ to a tzinfo.

    Prefers the IANA zone so daylight saving is handled correctly — Halifax is
    UTC-4 in winter and UTC-3 in summer, so a hard-coded offset would be wrong
    for half the year. Falls back to a fixed offset only if the runtime has no
    tz database, which is rare but not impossible on slim images.
    """
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(SOURCE_TZ)
    except Exception as err:  # noqa: BLE001 - missing module or missing tzdata
        fallback = os.environ.get("SOURCE_UTC_OFFSET_HOURS")
        if fallback:
            print(
                f"WARN: could not load zone '{SOURCE_TZ}' ({err}); "
                f"using fixed offset {fallback}h — daylight saving will NOT be applied"
            )
            return timezone(timedelta(hours=float(fallback)))
        print(
            f"WARN: could not load zone '{SOURCE_TZ}' ({err}) and no "
            "SOURCE_UTC_OFFSET_HOURS set; treating device time as UTC"
        )
        return timezone.utc


SOURCE_ZONE = _resolve_source_zone()

_FORMATS = (
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M",
    "%Y-%m-%d %H:%M",
)


def parse_instant(raw: str):
    """
    Parses a device timestamp into (utc_dt, local_dt), or (None, None).

    Naive input is interpreted as SOURCE_TZ; offset-aware input is trusted.
    """
    if not raw:
        return None, None

    text = str(raw).strip()
    parsed = None

    # Offset-aware first: "...Z" or "...+05:00".
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        for fmt in _FORMATS:
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue

    if parsed is None:
        return None, None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=SOURCE_ZONE)

    return parsed.astimezone(timezone.utc), parsed.astimezone(SOURCE_ZONE)


def to_decimal(value, default="0"):
    """DynamoDB rejects floats, and a malformed weight shouldn't drop the row."""
    try:
        return Decimal(str(value if value not in (None, "") else default))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal(default)


def clean_text(value) -> str:
    """`.get(k, '')` still yields None when the key exists with a null value."""
    return str(value).strip() if value is not None else ""


def lambda_handler(event, context):
    try:
        uid = clean_text(event.get("UID")).upper()
        raw_datetime = clean_text(event.get("DateTime"))

        if not uid or not raw_datetime:
            return {"statusCode": 400, "body": "Missing required fields: UID and DateTime."}

        utc_dt, local_dt = parse_instant(raw_datetime)
        if utc_dt is None:
            return {
                "statusCode": 400,
                "body": (
                    f"Unrecognised DateTime '{raw_datetime}'. "
                    "Expected e.g. 2025-06-12T14:22:00 or 2025-06-12T14:22:00-03:00."
                ),
            }

        item = {
            # Sort key — UTC, so ordering and the live window are comparable
            # against server time regardless of where the device sits.
            "UID": uid,
            "DateTime": utc_dt.strftime("%Y-%m-%dT%H:%M:%S"),

            # Local — what the kitchen actually experienced. Daily totals and
            # peak-hour analytics read these.
            "Date": local_dt.strftime("%Y-%m-%d"),
            "Time": local_dt.strftime("%H:%M:%S"),
            "LocalDateTime": local_dt.strftime("%Y-%m-%dT%H:%M:%S"),

            # Untouched original, so a bad SOURCE_TZ is always recoverable.
            "SourceDateTime": raw_datetime,
            "SourceTimeZone": str(SOURCE_TZ),

            "RunningTotalWeight": to_decimal(event.get("RunningTotalWeight")),
            "PerDepositWeight": to_decimal(event.get("PerDepositWeight")),
            "Message1": clean_text(event.get("Message1")),
            "Message2": clean_text(event.get("Message2")),
            "Message3": clean_text(event.get("Message3")).lower(),
        }

        table.put_item(Item=item)

        return {
            "statusCode": 200,
            "body": f"Data inserted for UID {uid} at {item['DateTime']}Z "
                    f"(local {item['LocalDateTime']})",
        }

    except Exception as err:  # noqa: BLE001 - never lose a reading silently
        print(f"ERROR ingesting reading: {type(err).__name__}: {err}")
        return {"statusCode": 500, "body": str(err)}
