"""
IWM — Create an admin account
=============================

Admin accounts are deliberately NOT self-registerable: the signup Lambda always
forces role="client". Use this script to provision admins out-of-band.

You cannot simply type a password into the DynamoDB console — credentials must
be hashed with the exact same PBKDF2 parameters the Lambda verifies against, or
the login will always fail. This script does that for you.

USAGE
-----
    pip install boto3
    aws configure                     # once, if you haven't already

    python create_admin.py                        # interactive
    python create_admin.py --table iwm-users --region ca-central-1

Requires an AWS profile with dynamodb:PutItem on the users table.
"""

import argparse
import base64
import getpass
import hashlib
import re
import secrets
import sys
import uuid
from datetime import datetime, timezone

try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError
except ImportError:
    sys.exit("boto3 is not installed. Run:  pip install boto3")

# MUST match PBKDF2_ITERATIONS in aws/lambdas/auth/lambda_function.py
PBKDF2_ITERATIONS = 210_000
MIN_PASSWORD_LENGTH = 8
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def hash_credential(plaintext: str):
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", plaintext.encode(), salt, PBKDF2_ITERATIONS)
    return base64.b64encode(salt).decode(), base64.b64encode(derived).decode()


def normalize_secret_answer(answer: str) -> str:
    """Must match normalize_secret_answer() in the Lambda."""
    return " ".join((answer or "").split()).lower()


def prompt(label: str, required: bool = True, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    while True:
        value = input(f"{label}{suffix}: ").strip() or default
        if value or not required:
            return value
        print("  ! This field is required.")


def prompt_secret(label: str) -> str:
    while True:
        first = getpass.getpass(f"{label}: ")
        if len(first) < MIN_PASSWORD_LENGTH:
            print(f"  ! Must be at least {MIN_PASSWORD_LENGTH} characters.")
            continue
        if first != getpass.getpass(f"Confirm {label.lower()}: "):
            print("  ! Values did not match, try again.")
            continue
        return first


def main():
    parser = argparse.ArgumentParser(description="Create an IWM admin account.")
    parser.add_argument("--table", default="iwm-users", help="DynamoDB table name")
    parser.add_argument("--region", default=None, help="AWS region (else uses your CLI default)")
    args = parser.parse_args()

    print("\n=== Create IWM admin account ===\n")

    name = prompt("Full name")

    while True:
        email = prompt("Email").lower()
        if EMAIL_RE.match(email):
            break
        print("  ! That doesn't look like a valid email address.")

    organization = prompt("Organization", default="IWM")
    city = prompt("City", required=False, default="Toronto")
    phone = prompt("Phone", required=False)

    password = prompt_secret("Password")

    print("\nThe secret code is the answer to a security question, entered at")
    print("every login alongside the password.\n")
    secret_question = prompt("Security question", default="What is your favorite food?")
    secret_answer = normalize_secret_answer(prompt_secret("Secret answer"))

    password_salt, password_hash = hash_credential(password)
    answer_salt, answer_hash = hash_credential(secret_answer)

    item = {
        "email": email,
        "userId": f"u-{uuid.uuid4().hex[:12]}",
        "name": name,
        "role": "admin",
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

    session = boto3.Session(region_name=args.region) if args.region else boto3.Session()
    table = session.resource("dynamodb").Table(args.table)

    try:
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(email)")
    except NoCredentialsError:
        sys.exit("\nNo AWS credentials found. Run 'aws configure' first.")
    except ClientError as err:
        code = err.response["Error"]["Code"]
        if code == "ConditionalCheckFailedException":
            sys.exit(f"\nAn account already exists for {email}.")
        if code == "ResourceNotFoundException":
            sys.exit(f"\nTable '{args.table}' not found in this region.")
        sys.exit(f"\nFailed to write to DynamoDB: {err}")

    print(f"\n✓ Admin account created for {email}")
    print("  Sign in with the ADMIN toggle on the login page, using the")
    print("  password and secret answer you just entered.")
    print("\n  Only the hashes were stored — the plaintext values are not")
    print("  recoverable from the database, so don't lose them.\n")


if __name__ == "__main__":
    main()
