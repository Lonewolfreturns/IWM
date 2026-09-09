"""
IWM — Auth Lambda (signup + login)
==================================

Single Lambda behind a Lambda Function URL, handling:

    POST /auth/signup      -> create a CLIENT account (self-service)
    POST /auth/login       -> authenticate any account (client or admin)
    POST /auth/credentials -> change own password and/or security question
                              [requires a bearer token AND the current
                               password + secret answer]

Zero external dependencies: everything below is Python stdlib plus boto3,
which is preinstalled in the Lambda Python runtime. Paste straight into the
console — no zip, no layers, no build step.

SECURITY NOTES
--------------
* Passwords and secret answers are HASHED (PBKDF2-HMAC-SHA256, per-user random
  salt, 210k iterations), never encrypted. Hashing is one-way: even with full
  database access, the original values cannot be recovered. This is the correct
  handling for credentials — "encrypted passwords" would be reversible and is
  an anti-pattern.
* Personal data (name, organization, phone, city) is stored as plaintext
  attributes and protected by DynamoDB encryption at rest, which AWS applies
  automatically to every table.
* `role` is ALWAYS forced to "client" on signup. The value from the request
  body is deliberately ignored so nobody can self-provision an admin account.
  Admin accounts are created out-of-band (see aws/scripts/create_admin.py).
* Credential comparisons use hmac.compare_digest (constant time).
* Failed logins return one generic message so the endpoint can't be used to
  discover which email addresses have accounts.

ENVIRONMENT VARIABLES
---------------------
    USERS_TABLE       DynamoDB table name          (default: iwm-users)
    JWT_SECRET        REQUIRED. Long random string used to sign tokens.
    JWT_TTL_SECONDS   Token lifetime               (default: 86400 = 24h)
    ALLOWED_ORIGIN    CORS origin                  (default: *)
"""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

TABLE_NAME = os.environ.get("USERS_TABLE", "iwm-users")
JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_TTL_SECONDS = int(os.environ.get("JWT_TTL_SECONDS", "86400"))
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

# OWASP-recommended minimum for PBKDF2-HMAC-SHA256.
# Must match aws/scripts/create_admin.py or admin logins will fail.
PBKDF2_ITERATIONS = 210_000

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LENGTH = 8

_dynamodb = boto3.resource("dynamodb")
_table = _dynamodb.Table(TABLE_NAME)


# --------------------------------------------------------------------------
# Base64url / JWT helpers (HS256, hand-rolled to avoid a PyJWT dependency)
# --------------------------------------------------------------------------

def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def make_token(user: dict) -> str:
    """Signs a compact HS256 JWT for an authenticated user."""
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": user["userId"],
        "email": user["email"],
        "role": stored_role(user),
        "org": user.get("organization", ""),
        "iat": now,
        "exp": now + JWT_TTL_SECONDS,
    }
    segments = [
        _b64url_encode(json.dumps(header, separators=(",", ":")).encode()),
        _b64url_encode(json.dumps(payload, separators=(",", ":")).encode()),
    ]
    signature = hmac.new(
        JWT_SECRET.encode(), ".".join(segments).encode(), hashlib.sha256
    ).digest()
    segments.append(_b64url_encode(signature))
    return ".".join(segments)


def verify_token(token: str):
    """
    Validates a token produced by make_token().

    Returns the decoded payload dict, or None if the token is malformed,
    tampered with, or expired. Reuse this in your other Lambdas (readings,
    scales, users, ...) to authorize requests.
    """
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except (ValueError, AttributeError):
        return None

    expected = hmac.new(
        JWT_SECRET.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256
    ).digest()

    # Any malformed segment must fail closed, never raise — this runs against
    # attacker-controlled Authorization headers.
    try:
        if not hmac.compare_digest(expected, _b64url_decode(signature_b64)):
            return None
        payload = json.loads(_b64url_decode(payload_b64))
    except Exception:  # noqa: BLE001 - bad base64, bad utf-8, bad json
        return None

    if not isinstance(payload, dict):
        return None
    if payload.get("exp", 0) < int(time.time()):
        return None
    return payload


# --------------------------------------------------------------------------
# Credential hashing
# --------------------------------------------------------------------------

def hash_credential(plaintext: str):
    """Returns (salt_b64, hash_b64) for a fresh random salt."""
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256", plaintext.encode(), salt, PBKDF2_ITERATIONS
    )
    return base64.b64encode(salt).decode(), base64.b64encode(derived).decode()


def verify_credential(plaintext: str, salt_b64: str, hash_b64: str) -> bool:
    """Constant-time verification of a plaintext against a stored salt+hash."""
    if not plaintext or not salt_b64 or not hash_b64:
        return False
    try:
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
    except (ValueError, TypeError):
        return False
    derived = hashlib.pbkdf2_hmac(
        "sha256", plaintext.encode(), salt, PBKDF2_ITERATIONS
    )
    return hmac.compare_digest(derived, expected)


def normalize_secret_answer(answer: str) -> str:
    """
    Secret answers are compared case- and whitespace-insensitively so
    "Poutine", "poutine" and " poutine " all authenticate the same way.
    """
    return " ".join((answer or "").split()).lower()


# --------------------------------------------------------------------------
# HTTP plumbing
# --------------------------------------------------------------------------

CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
}


def respond(status: int, body=None):
    headers = {"Content-Type": "application/json", **CORS_HEADERS}
    return {
        "statusCode": status,
        "headers": headers,
        "body": json.dumps(body) if body is not None else "",
    }


def parse_request(event):
    """Extracts (method, path, body) from a Function URL or API Gateway event."""
    ctx_http = (event.get("requestContext") or {}).get("http") or {}
    method = ctx_http.get("method") or event.get("httpMethod") or ""
    path = ctx_http.get("path") or event.get("path") or event.get("rawPath") or ""

    raw_body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw_body = base64.b64decode(raw_body).decode()
    try:
        body = json.loads(raw_body) if raw_body.strip() else {}
    except json.JSONDecodeError:
        body = None  # signals a malformed payload to the caller

    return method.upper(), path, body


def stored_role(item: dict) -> str:
    """
    Normalizes the role as stored in DynamoDB.

    Roles are written lowercase ("client" / "admin"), but a record edited by
    hand in the console could easily end up as "Admin". Lowercasing on read
    means such a record still authenticates and is still recognised as an
    admin by the frontend, instead of failing in confusing ways.
    """
    return (item.get("role") or "client").strip().lower()


def public_user(item: dict) -> dict:
    """Strips every credential field before a user object crosses the wire."""
    return {
        "id": item.get("userId"),
        "name": item.get("name"),
        "email": item.get("email"),
        "role": stored_role(item),
        "organization": item.get("organization"),
        "city": item.get("city"),
        "phone": item.get("phone"),
        "status": item.get("status"),
        "secretQuestion": item.get("secretQuestion"),
    }


# --------------------------------------------------------------------------
# Handlers
# --------------------------------------------------------------------------

def handle_signup(body: dict):
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    secret_question = (body.get("secretQuestion") or "").strip()
    secret_answer = normalize_secret_answer(body.get("secretAnswer"))
    organization = (body.get("organization") or "").strip()
    city = (body.get("city") or "").strip()
    phone = (body.get("phone") or "").strip()

    if not name:
        return respond(400, {"message": "Name is required"})
    if not EMAIL_RE.match(email):
        return respond(400, {"message": "A valid email address is required"})
    if len(password) < MIN_PASSWORD_LENGTH:
        return respond(
            400,
            {"message": f"Password must be at least {MIN_PASSWORD_LENGTH} characters"},
        )
    if not secret_question:
        return respond(400, {"message": "A security question is required"})
    if not secret_answer:
        return respond(400, {"message": "A secret answer is required"})
    if not organization:
        return respond(400, {"message": "Organization is required"})

    password_salt, password_hash = hash_credential(password)
    answer_salt, answer_hash = hash_credential(secret_answer)

    item = {
        "email": email,
        "userId": f"u-{uuid.uuid4().hex[:12]}",
        "name": name,
        # Hard-coded: never trust a client-supplied role. Admins are created
        # out-of-band via aws/scripts/create_admin.py.
        "role": "client",
        "organization": organization,
        "city": city,
        "phone": phone,
        "passwordSalt": password_salt,
        "passwordHash": password_hash,
        "secretQuestion": secret_question,
        "secretAnswerSalt": answer_salt,
        "secretAnswerHash": answer_hash,
        "status": "active",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "lastLogin": "",
    }

    try:
        _table.put_item(Item=item, ConditionExpression="attribute_not_exists(email)")
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return respond(409, {"message": "An account with that email already exists"})
        raise

    return respond(201, {"token": make_token(item), "user": public_user(item)})


def bearer_token(event) -> str:
    """Pulls the bearer token out of the Authorization header, if present."""
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    raw = headers.get("authorization") or ""
    return raw[7:].strip() if raw.lower().startswith("bearer ") else ""


def handle_change_credentials(claims: dict, body: dict):
    """
    Changes the caller's own password and/or security question.

    Re-authenticates with the CURRENT password and secret answer even though a
    valid token was already presented. A token can be a borrowed laptop or a
    tab left open; the thing being changed here is the credential that would
    let someone back in afterwards, so possession of the session is not enough
    on its own.

    Both changes go through one endpoint because both are re-authenticated the
    same way, and because someone rotating credentials usually wants to do both
    at once — which should cost one re-auth, not two.

    Nothing is written unless every check passes, so a rejected request can
    never leave the account with a new password but the old secret answer.
    """
    email = (claims.get("email") or "").strip().lower()
    if not email:
        return respond(401, {"message": "Unauthorized"})

    current_password = body.get("currentPassword") or ""
    current_answer = normalize_secret_answer(body.get("currentSecretAnswer"))

    new_password = body.get("newPassword") or ""
    new_question = (body.get("newSecretQuestion") or "").strip()
    new_answer_raw = body.get("newSecretAnswer")
    new_answer = normalize_secret_answer(new_answer_raw)

    wants_password = bool(new_password)
    # A new question without a new answer would leave the stored answer
    # attached to a question it no longer answers.
    wants_secret = bool(new_question or new_answer_raw)

    if not wants_password and not wants_secret:
        return respond(400, {"message": "Nothing to change"})
    if not current_password or not current_answer:
        return respond(
            400,
            {"message": "Your current password and secret code are required"},
        )

    try:
        item = _table.get_item(Key={"email": email}).get("Item")
    except ClientError:
        return respond(503, {"message": "Authentication service unavailable"})

    if not item:
        return respond(401, {"message": "Unauthorized"})
    if item.get("status") != "active":
        return respond(403, {"message": "This account has been deactivated"})

    # One message for both, so a wrong answer cannot be used to confirm that
    # the password was right.
    if not verify_credential(
        current_password, item.get("passwordSalt"), item.get("passwordHash")
    ) or not verify_credential(
        current_answer, item.get("secretAnswerSalt"), item.get("secretAnswerHash")
    ):
        return respond(401, {"message": "Your current password or secret code is incorrect"})

    sets = {}

    if wants_password:
        if len(new_password) < MIN_PASSWORD_LENGTH:
            return respond(
                400,
                {"message": f"New password must be at least {MIN_PASSWORD_LENGTH} characters"},
            )
        if new_password == current_password:
            return respond(400, {"message": "The new password matches your current one"})
        salt, digest = hash_credential(new_password)
        sets["passwordSalt"] = salt
        sets["passwordHash"] = digest

    if wants_secret:
        question = new_question or (item.get("secretQuestion") or "").strip()
        if not question:
            return respond(400, {"message": "A security question is required"})
        if not new_answer:
            return respond(400, {"message": "A secret answer is required"})
        salt, digest = hash_credential(new_answer)
        sets["secretQuestion"] = question
        sets["secretAnswerSalt"] = salt
        sets["secretAnswerHash"] = digest

    sets["credentialsUpdatedAt"] = datetime.now(timezone.utc).isoformat()

    try:
        _table.update_item(
            Key={"email": email},
            UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in sets),
            ExpressionAttributeNames={f"#{k}": k for k in sets},
            ExpressionAttributeValues={f":{k}": v for k, v in sets.items()},
        )
    except ClientError as err:
        print(f"ERROR change_credentials: {err}")
        return respond(503, {"message": "Could not save the change"})

    item.update(sets)

    # A fresh token, so the session that just rotated its own credentials is
    # not left holding one minted against the old ones.
    return respond(
        200,
        {
            "token": make_token(item),
            "user": public_user(item),
            "changed": sorted(
                set(["password"] if wants_password else [])
                | set(["secretQuestion"] if wants_secret else [])
            ),
        },
    )


def handle_login(body: dict):
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    secret_answer = normalize_secret_answer(body.get("secretAnswer"))
    requested_role = (body.get("role") or "").strip().lower()

    if not email or not password or not secret_answer:
        return respond(400, {"message": "Email, password and secret code are required"})

    try:
        result = _table.get_item(Key={"email": email})
    except ClientError:
        return respond(503, {"message": "Authentication service unavailable"})

    item = result.get("Item")

    # One generic message for every credential failure, so this endpoint
    # can't be used to enumerate which emails have accounts.
    invalid = respond(401, {"message": "Invalid email, password or secret code"})

    if not item:
        # Burn comparable CPU on a dummy hash so response time doesn't reveal
        # whether the account exists.
        hash_credential(password)
        return invalid
    if not verify_credential(password, item.get("passwordSalt"), item.get("passwordHash")):
        return invalid
    if not verify_credential(
        secret_answer, item.get("secretAnswerSalt"), item.get("secretAnswerHash")
    ):
        return invalid

    if item.get("status") != "active":
        return respond(403, {"message": "This account has been deactivated"})

    # Only checked after identity is proven, so a specific message here
    # leaks nothing to an attacker.
    if requested_role and stored_role(item) != requested_role:
        return respond(403, {"message": f"This account is not registered as {requested_role}"})

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        _table.update_item(
            Key={"email": email},
            UpdateExpression="SET lastLogin = :ts",
            ExpressionAttributeValues={":ts": now_iso},
        )
        item["lastLogin"] = now_iso
    except ClientError:
        pass  # a failed timestamp write must never block a valid login

    return respond(200, {"token": make_token(item), "user": public_user(item)})


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def lambda_handler(event, context):
    if not JWT_SECRET:
        print("FATAL: JWT_SECRET environment variable is not set")
        return respond(500, {"message": "Server is not configured correctly"})

    method, path, body = parse_request(event)

    if method == "OPTIONS":
        return respond(204)

    if body is None:
        return respond(400, {"message": "Request body must be valid JSON"})

    try:
        if method == "POST" and path.endswith("/auth/signup"):
            return handle_signup(body)
        if method == "POST" and path.endswith("/auth/login"):
            return handle_login(body)
        if method == "POST" and path.endswith("/auth/credentials"):
            claims = verify_token(bearer_token(event))
            if not claims:
                return respond(401, {"message": "Unauthorized"})
            return handle_change_credentials(claims, body)
    except Exception as err:  # noqa: BLE001 - last line of defence
        # Log the detail for CloudWatch, return something opaque to the client.
        print(f"ERROR handling {method} {path}: {type(err).__name__}: {err}")
        return respond(500, {"message": "Something went wrong. Please try again."})

    return respond(404, {"message": f"No route for {method} {path}"})
