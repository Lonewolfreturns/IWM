"""
IWM — Core API Lambda (scales + users)
======================================

Second Lambda, behind its own Function URL. Every route here requires a valid
JWT issued by the auth Lambda.

    GET    /scales           list scales   (admin: all · client: own org only)
    POST   /scales           provision a scale                        [admin]
    PATCH  /scales/{id}      update a scale       [admin: any field ·
                                                   client: location + hours]
    DELETE /scales/{id}      decommission a scale                     [admin]

    GET    /users            list all users                           [admin]
    PATCH  /users/{id}       update role / org / status               [admin]
    DELETE /users/{id}       delete a user                            [admin]

    GET    /me               current user's profile
    PATCH  /me               update own name / phone / city

Zero external dependencies — stdlib + boto3 (preinstalled in Lambda).

AUTHORIZATION MODEL
-------------------
Two rules do the heavy lifting:

1. Clients only ever see their own organization's scales. Scoping happens
   server-side from the JWT's `org` claim — never from anything the client
   sends, so a crafted request can't widen the scope.
2. Clients can only edit `location` and `mealSchedule`, and only on scales
   their organization owns. They cannot change `organization` (which would let
   them steal another org's scale) or `status`. See CLIENT_EDITABLE_FIELDS.

ENVIRONMENT VARIABLES
---------------------
    USERS_TABLE     default: iwm-users
    SCALES_TABLE    default: iwm-scales
    JWT_SECRET      REQUIRED — must be byte-identical to the auth Lambda's
    ALLOWED_ORIGIN  default: *
"""

import base64
import hashlib
import hmac
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

USERS_TABLE = os.environ.get("USERS_TABLE", "iwm-users")
SCALES_TABLE = os.environ.get("SCALES_TABLE", "iwm-scales")
# Read-only, and only to discover devices that are reporting but unprovisioned.
READINGS_TABLE = os.environ.get("READINGS_TABLE", "IWM")
JWT_SECRET = os.environ.get("JWT_SECRET", "")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

_dynamodb = boto3.resource("dynamodb")
_users = _dynamodb.Table(USERS_TABLE)
_scales = _dynamodb.Table(SCALES_TABLE)
_readings = _dynamodb.Table(READINGS_TABLE)

# Cached UID discovery — see discover_reading_uids().
_uid_cache = {"uids": None, "at": 0.0}
UID_CACHE_TTL = float(os.environ.get("UID_CACHE_TTL", "300"))

VALID_STATUSES = {"online", "offline", "maintenance"}
VALID_ROLES = {"client", "admin"}
MEAL_KEYS = {"breakfast", "lunch", "dinner", "snacks", "night"}
TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")  # 24h HH:MM

# Fields a CLIENT may change on a scale they own. Everything else is admin-only.
# A client sets where their scale physically is, so the zone belongs with it —
# they are the ones who know whether a site is Atlantic or Eastern.
CLIENT_EDITABLE_FIELDS = {"location", "mealSchedule", "timeZone"}
ADMIN_EDITABLE_FIELDS = {
    "name", "assignedEmail", "organization", "location", "status", "serial",
    "notes", "mealSchedule", "timeZone",
}


# ==========================================================================
# Shared helpers
#
# Intentionally duplicated from the auth Lambda rather than shared via a
# Lambda Layer, so both functions stay copy-pasteable into the console with
# no build step. If you ever change JWT logic, change it in BOTH files.
# ==========================================================================

def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def verify_token(token: str):
    """Returns the JWT payload, or None if invalid/expired. Fails closed."""
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
    except Exception:  # noqa: BLE001 — bad base64 / utf-8 / json all fail closed
        return None

    if not isinstance(payload, dict) or payload.get("exp", 0) < int(time.time()):
        return None
    return payload


class DecimalEncoder(json.JSONEncoder):
    """DynamoDB returns numbers as Decimal, which json.dumps can't serialize."""

    def default(self, o):
        if isinstance(o, Decimal):
            return int(o) if o % 1 == 0 else float(o)
        return super().default(o)


CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
}


def respond(status: int, body=None):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", **CORS_HEADERS},
        "body": json.dumps(body, cls=DecimalEncoder) if body is not None else "",
    }


def parse_request(event):
    ctx_http = (event.get("requestContext") or {}).get("http") or {}
    method = (ctx_http.get("method") or event.get("httpMethod") or "").upper()
    path = ctx_http.get("path") or event.get("rawPath") or event.get("path") or ""

    raw_body = event.get("body") or ""
    if event.get("isBase64Encoded") and raw_body:
        raw_body = base64.b64decode(raw_body).decode()
    try:
        body = json.loads(raw_body) if raw_body.strip() else {}
    except json.JSONDecodeError:
        body = None
    return method, path, body


def bearer_token(event) -> str:
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    auth = headers.get("authorization", "")
    return auth[7:].strip() if auth.lower().startswith("bearer ") else auth.strip()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ==========================================================================
# Validation
# ==========================================================================

def validate_meal_schedule(schedule):
    """
    Expects: { "breakfast": {"from": "07:00", "to": "09:00"}, ... }
    Returns (cleaned, error_message).
    """
    if not isinstance(schedule, dict):
        return None, "mealSchedule must be an object"

    cleaned = {}
    for key, window in schedule.items():
        if key not in MEAL_KEYS:
            return None, f"Unknown meal period '{key}'"
        if not isinstance(window, dict):
            return None, f"'{key}' must be an object with 'from' and 'to'"
        start, end = window.get("from"), window.get("to")
        for label, value in (("from", start), ("to", end)):
            if not isinstance(value, str) or not TIME_RE.match(value):
                return None, f"'{key}.{label}' must be a 24-hour HH:MM time"
        # Windows may legitimately cross midnight (e.g. night 22:00 -> 02:00),
        # so from > to is allowed and deliberately not rejected here.
        cleaned[key] = {"from": start, "to": end}
    return cleaned, None


def validate_time_zone(value):
    """
    Accepts an IANA zone name, or "" to mean "fall back to the viewer's".

    Validated by shape rather than against a zone database: the frontend picks
    from a fixed list, and rejecting an unknown-but-well-formed zone would only
    break the day a new one is added.
    """
    tz = (value or "").strip()
    if not tz:
        return "", None
    if tz == "UTC" or re.match(r"^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){1,2}$", tz):
        return tz, None
    return None, f"'{tz}' is not a valid IANA time zone (e.g. America/Halifax)"


def resolve_assignment(email: str):
    """
    Turns an assigned user's email into (assignedEmail, organization, error).

    A scale is assigned to a *person* the admin picks by email, but visibility
    is scoped by that person's ORGANIZATION so their colleagues at the same
    kitchen also see it. Deriving the org here — rather than trusting one sent
    by the caller — keeps the two fields from drifting apart.

    An empty email means "unassigned", which is valid: scales are provisioned
    and shipped before anyone owns them.
    """
    email = (email or "").strip().lower()
    if not email:
        return "", "", None
    try:
        user = _users.get_item(Key={"email": email}).get("Item")
    except ClientError as err:
        print(f"ERROR resolve_assignment: {err}")
        return None, None, "Could not look up that user"
    if not user:
        return None, None, f"No user account found for {email}"
    return email, user.get("organization", ""), None


def build_update(fields: dict):
    """Builds a DynamoDB UpdateExpression from a dict of attribute updates."""
    sets, names, values = [], {}, {}
    for i, (key, value) in enumerate(fields.items()):
        sets.append(f"#f{i} = :v{i}")
        names[f"#f{i}"] = key
        values[f":v{i}"] = value
    return "SET " + ", ".join(sets), names, values


# ==========================================================================
# Scales
# ==========================================================================

def list_scales(claims):
    """
    Admins see the whole fleet — including devices that are emitting telemetry
    but were never provisioned here. Clients see only their organization's.

    Merging in unregistered UIDs is the point: a scale sending data that nobody
    has set up is exactly what an operator needs to see, and it can't be
    discovered from this table because by definition it isn't in it. Those rows
    come back with `registered: false` so the UI can offer to provision them.
    """
    is_admin = claims["role"] == "admin"
    try:
        if is_admin:
            result = _scales.scan()
        else:
            result = _scales.scan(
                FilterExpression="#org = :org",
                ExpressionAttributeNames={"#org": "organization"},
                ExpressionAttributeValues={":org": claims.get("org", "")},
            )
    except ClientError as err:
        print(f"ERROR list_scales: {err}")
        return respond(503, {"message": "Could not load scales"})

    items = [public_scale(s) for s in result.get("Items", [])]

    if is_admin:
        known = {s["scaleId"] for s in items}
        for uid in discover_reading_uids():
            if uid not in known:
                items.append(unregistered_scale(uid))

    items.sort(key=lambda s: (s.get("registered") is not False, s.get("scaleId") or ""))
    return respond(200, items)


def discover_reading_uids():
    """
    Every UID that has actually reported telemetry.

    Cached across warm invocations because it needs a projected scan of a large
    table. Returns [] on any failure — if the readings table isn't reachable
    (no IAM grant, wrong name) the scales list still works, just without the
    unregistered extras. Degrading quietly beats a broken page.
    """
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
        print(f"WARN discover_reading_uids (unregistered devices hidden): {err}")
        return []

    _uid_cache["uids"] = sorted(uids)
    _uid_cache["at"] = now
    return _uid_cache["uids"]


def unregistered_scale(uid: str) -> dict:
    """A device seen in telemetry but absent from iwm-scales."""
    return {
        "id": uid,
        "scaleId": uid,
        "name": uid,
        "assignedEmail": "",
        "organization": "",
        "location": "",
        "timeZone": "",
        "status": "unregistered",
        "serial": "",
        "notes": "",
        "mealSchedule": {},
        "lastReading": 0,
        "lastActive": "",
        "createdAt": "",
        "registered": False,
    }


def public_scale(item: dict) -> dict:
    return {
        "id": item.get("scaleId"),
        "scaleId": item.get("scaleId"),
        "name": item.get("name", ""),
        "assignedEmail": item.get("assignedEmail", ""),
        "organization": item.get("organization", ""),
        "location": item.get("location", ""),
        "timeZone": item.get("timeZone", ""),
        "status": item.get("status", "offline"),
        "serial": item.get("serial", ""),
        "notes": item.get("notes", ""),
        "mealSchedule": item.get("mealSchedule", {}),
        "lastReading": item.get("lastReading", 0),
        "lastActive": item.get("lastActive", ""),
        "createdAt": item.get("createdAt", ""),
        "registered": True,
    }


def create_scale(claims, body):
    if claims["role"] != "admin":
        return respond(403, {"message": "Admin access required"})

    # The scale ID must be the physical device UID (e.g. DAL00001) because
    # incoming telemetry is keyed by it. Never auto-generate this.
    scale_id = (body.get("scaleId") or body.get("id") or "").strip().upper()
    if not scale_id:
        return respond(400, {"message": "scaleId (the device UID, e.g. DAL00001) is required"})
    if not re.match(r"^[A-Z0-9_-]{3,32}$", scale_id):
        return respond(400, {"message": "scaleId must be 3-32 chars: letters, digits, - or _"})

    name = (body.get("name") or "").strip()
    if not name:
        return respond(400, {"message": "Scale name is required"})

    status = (body.get("status") or "offline").strip().lower()
    if status not in VALID_STATUSES:
        return respond(400, {"message": f"status must be one of {sorted(VALID_STATUSES)}"})

    schedule = {}
    if body.get("mealSchedule"):
        schedule, err = validate_meal_schedule(body["mealSchedule"])
        if err:
            return respond(400, {"message": err})

    time_zone, err = validate_time_zone(body.get("timeZone"))
    if err:
        return respond(400, {"message": err})

    # The org is derived from the assigned user, never taken from the request.
    assigned_email, organization, err = resolve_assignment(body.get("assignedEmail"))
    if err:
        return respond(400, {"message": err})
    # Allow provisioning against a bare org name when no user is picked yet.
    if not assigned_email and body.get("organization"):
        organization = (body.get("organization") or "").strip()

    item = {
        "scaleId": scale_id,
        "name": name,
        "assignedEmail": assigned_email,
        "organization": organization,
        "location": (body.get("location") or "").strip(),
        "timeZone": time_zone,
        "status": status,
        "serial": (body.get("serial") or "").strip(),
        "notes": (body.get("notes") or "").strip(),
        "mealSchedule": schedule,
        "lastReading": Decimal("0"),
        "lastActive": "",
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }

    try:
        _scales.put_item(Item=item, ConditionExpression="attribute_not_exists(scaleId)")
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return respond(409, {"message": f"Scale {scale_id} already exists"})
        print(f"ERROR create_scale: {err}")
        return respond(503, {"message": "Could not create scale"})

    return respond(201, public_scale(item))


def update_scale(claims, scale_id, body):
    scale_id = scale_id.strip().upper()
    try:
        existing = _scales.get_item(Key={"scaleId": scale_id}).get("Item")
    except ClientError as err:
        print(f"ERROR update_scale get: {err}")
        return respond(503, {"message": "Could not load scale"})

    if not existing:
        return respond(404, {"message": f"Scale {scale_id} not found"})

    is_admin = claims["role"] == "admin"

    # Clients may only touch scales their own organization owns.
    if not is_admin and existing.get("organization") != claims.get("org"):
        return respond(403, {"message": "This scale is not assigned to your organization"})

    allowed = ADMIN_EDITABLE_FIELDS if is_admin else CLIENT_EDITABLE_FIELDS
    rejected = [k for k in body if k not in allowed and k not in ("id", "scaleId")]
    if rejected:
        return respond(
            403,
            {"message": f"You are not allowed to change: {', '.join(sorted(rejected))}"},
        )

    updates = {}

    # Reassignment: setting assignedEmail also rewrites organization, so the
    # two can never drift. Handled before the generic loop because it writes
    # two fields from one input.
    if is_admin and "assignedEmail" in body:
        assigned_email, organization, err = resolve_assignment(body["assignedEmail"])
        if err:
            return respond(400, {"message": err})
        updates["assignedEmail"] = assigned_email
        updates["organization"] = organization

    for field in allowed:
        if field not in body or field == "assignedEmail":
            continue
        # An explicit assignedEmail wins over any organization sent alongside it.
        if field == "organization" and "assignedEmail" in updates:
            continue
        value = body[field]

        if field == "mealSchedule":
            cleaned, err = validate_meal_schedule(value)
            if err:
                return respond(400, {"message": err})
            updates["mealSchedule"] = cleaned
        elif field == "timeZone":
            tz, err = validate_time_zone(value)
            if err:
                return respond(400, {"message": err})
            updates["timeZone"] = tz
        elif field == "status":
            status = (value or "").strip().lower()
            if status not in VALID_STATUSES:
                return respond(400, {"message": f"status must be one of {sorted(VALID_STATUSES)}"})
            updates["status"] = status
        elif field == "name":
            name = (value or "").strip()
            if not name:
                return respond(400, {"message": "Scale name cannot be empty"})
            updates["name"] = name
        else:
            updates[field] = (value or "").strip() if isinstance(value, str) else value

    if not updates:
        return respond(400, {"message": "No valid fields to update"})

    updates["updatedAt"] = now_iso()
    expr, names, values = build_update(updates)

    try:
        result = _scales.update_item(
            Key={"scaleId": scale_id},
            UpdateExpression=expr,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        print(f"ERROR update_scale: {err}")
        return respond(503, {"message": "Could not update scale"})

    return respond(200, public_scale(result["Attributes"]))


def delete_scale(claims, scale_id):
    if claims["role"] != "admin":
        return respond(403, {"message": "Admin access required"})
    try:
        _scales.delete_item(Key={"scaleId": scale_id.strip().upper()})
    except ClientError as err:
        print(f"ERROR delete_scale: {err}")
        return respond(503, {"message": "Could not delete scale"})
    return respond(200, {"id": scale_id.strip().upper()})


# ==========================================================================
# Users
# ==========================================================================

def public_user(item: dict) -> dict:
    """Never returns passwordHash / passwordSalt / secretAnswer* fields."""
    return {
        "id": item.get("userId"),
        "name": item.get("name", ""),
        "email": item.get("email", ""),
        "role": (item.get("role") or "client").strip().lower(),
        "organization": item.get("organization", ""),
        "city": item.get("city", ""),
        "phone": item.get("phone", ""),
        "status": item.get("status", "active"),
        "lastLogin": item.get("lastLogin", ""),
        "createdAt": item.get("createdAt", ""),
    }


def list_users(claims):
    if claims["role"] != "admin":
        return respond(403, {"message": "Admin access required"})
    try:
        result = _users.scan()
    except ClientError as err:
        print(f"ERROR list_users: {err}")
        return respond(503, {"message": "Could not load users"})
    items = sorted(result.get("Items", []), key=lambda u: u.get("name", ""))
    return respond(200, [public_user(u) for u in items])


def _find_user_by_id(user_id: str):
    """Users are keyed by email, so a lookup by userId needs a scan."""
    result = _users.scan(
        FilterExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    )
    items = result.get("Items", [])
    return items[0] if items else None


def update_user(claims, user_id, body):
    if claims["role"] != "admin":
        return respond(403, {"message": "Admin access required"})

    try:
        target = _find_user_by_id(user_id)
    except ClientError as err:
        print(f"ERROR update_user lookup: {err}")
        return respond(503, {"message": "Could not load user"})
    if not target:
        return respond(404, {"message": "User not found"})

    updates = {}
    if "name" in body:
        name = (body["name"] or "").strip()
        if not name:
            return respond(400, {"message": "Name cannot be empty"})
        updates["name"] = name
    if "organization" in body:
        updates["organization"] = (body["organization"] or "").strip()
    if "city" in body:
        updates["city"] = (body["city"] or "").strip()
    if "phone" in body:
        updates["phone"] = (body["phone"] or "").strip()
    if "role" in body:
        role = (body["role"] or "").strip().lower()
        if role not in VALID_ROLES:
            return respond(400, {"message": f"role must be one of {sorted(VALID_ROLES)}"})
        # Guard against an admin removing their own admin rights and locking
        # everyone out of the admin surface.
        if target.get("email") == claims.get("email") and role != "admin":
            return respond(400, {"message": "You cannot remove your own admin role"})
        updates["role"] = role
    if "status" in body:
        status = (body["status"] or "").strip().lower()
        if status not in {"active", "inactive"}:
            return respond(400, {"message": "status must be 'active' or 'inactive'"})
        if target.get("email") == claims.get("email") and status != "active":
            return respond(400, {"message": "You cannot deactivate your own account"})
        updates["status"] = status

    # Email is the table's partition key — changing it would mean delete+recreate
    # and would orphan the credential hashes. Deliberately not supported.
    if "email" in body and body["email"].strip().lower() != target.get("email"):
        return respond(400, {"message": "Email cannot be changed"})

    if not updates:
        return respond(400, {"message": "No valid fields to update"})

    expr, names, values = build_update(updates)
    try:
        result = _users.update_item(
            Key={"email": target["email"]},
            UpdateExpression=expr,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        print(f"ERROR update_user: {err}")
        return respond(503, {"message": "Could not update user"})

    return respond(200, public_user(result["Attributes"]))


def delete_user(claims, user_id):
    if claims["role"] != "admin":
        return respond(403, {"message": "Admin access required"})
    try:
        target = _find_user_by_id(user_id)
        if not target:
            return respond(404, {"message": "User not found"})
        if target.get("email") == claims.get("email"):
            return respond(400, {"message": "You cannot delete your own account"})
        _users.delete_item(Key={"email": target["email"]})
    except ClientError as err:
        print(f"ERROR delete_user: {err}")
        return respond(503, {"message": "Could not delete user"})
    return respond(200, {"id": user_id})


# ==========================================================================
# Self-service profile
# ==========================================================================

def get_me(claims):
    try:
        item = _users.get_item(Key={"email": claims["email"]}).get("Item")
    except ClientError as err:
        print(f"ERROR get_me: {err}")
        return respond(503, {"message": "Could not load profile"})
    if not item:
        return respond(404, {"message": "User not found"})
    return respond(200, public_user(item))


def update_me(claims, body):
    """A user may edit their own name, phone and city — never role or status."""
    updates = {}
    for field in ("name", "phone", "city"):
        if field in body:
            value = (body[field] or "").strip()
            if field == "name" and not value:
                return respond(400, {"message": "Name cannot be empty"})
            updates[field] = value

    if not updates:
        return respond(400, {"message": "No valid fields to update"})

    expr, names, values = build_update(updates)
    try:
        result = _users.update_item(
            Key={"email": claims["email"]},
            UpdateExpression=expr,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )
    except ClientError as err:
        print(f"ERROR update_me: {err}")
        return respond(503, {"message": "Could not update profile"})
    return respond(200, public_user(result["Attributes"]))


# ==========================================================================
# Routing
# ==========================================================================

RE_SCALES = re.compile(r"/scales/?$")
RE_SCALE_ID = re.compile(r"/scales/([^/]+)/?$")
RE_USERS = re.compile(r"/users/?$")
RE_USER_ID = re.compile(r"/users/([^/]+)/?$")
RE_ME = re.compile(r"/me/?$")


def dispatch(method, path, claims, body):
    if RE_ME.search(path):
        if method == "GET":
            return get_me(claims)
        if method == "PATCH":
            return update_me(claims, body)

    if RE_SCALES.search(path):
        if method == "GET":
            return list_scales(claims)
        if method == "POST":
            return create_scale(claims, body)

    match = RE_SCALE_ID.search(path)
    if match:
        scale_id = match.group(1)
        if method == "PATCH":
            return update_scale(claims, scale_id, body)
        if method == "DELETE":
            return delete_scale(claims, scale_id)

    if RE_USERS.search(path):
        if method == "GET":
            return list_users(claims)

    match = RE_USER_ID.search(path)
    if match:
        user_id = match.group(1)
        if method == "PATCH":
            return update_user(claims, user_id, body)
        if method == "DELETE":
            return delete_user(claims, user_id)

    return respond(404, {"message": f"No route for {method} {path}"})


def lambda_handler(event, context):
    if not JWT_SECRET:
        print("FATAL: JWT_SECRET environment variable is not set")
        return respond(500, {"message": "Server is not configured correctly"})

    method, path, body = parse_request(event)

    if method == "OPTIONS":
        return respond(204)
    if body is None:
        return respond(400, {"message": "Request body must be valid JSON"})

    claims = verify_token(bearer_token(event))
    if not claims:
        return respond(401, {"message": "Unauthorized"})
    # Normalise once so every handler can trust claims["role"].
    claims["role"] = (claims.get("role") or "client").strip().lower()

    try:
        return dispatch(method, path, claims, body)
    except Exception as err:  # noqa: BLE001 — last line of defence
        print(f"ERROR handling {method} {path}: {type(err).__name__}: {err}")
        return respond(500, {"message": "Something went wrong. Please try again."})
