"""
IWM — Bulk-provision scales
===========================

Reads the device UIDs out of a real scale-export CSV and creates one record per
unique UID in the iwm-scales table, so you don't have to type them into the UI
one at a time.

The CSV only tells us the UID — name, organization and location aren't in the
export. Those are left blank/placeholder for you to fill in from the admin UI
(Scale Management > Edit), or supply --organization to assign them all at once.

USAGE
-----
    pip install boto3
    aws configure

    # preview without writing anything
    python import_scales.py --csv "waste_data_....csv" --dry-run

    # create the records
    python import_scales.py --csv "waste_data_....csv" --region us-east-2

    # ...and assign every one to a single organization
    python import_scales.py --csv "..." --region us-east-2 \
        --organization "Dalhousie University"

Existing scales are never overwritten — re-running is safe.
"""

import argparse
import csv
import os
import sys
from datetime import datetime, timezone
from decimal import Decimal

# boto3 is imported lazily inside main() so that --dry-run works on a machine
# with nothing installed — you can inspect a CSV before touching AWS at all.


def read_uids(csv_path: str):
    """Pulls unique UIDs from the export, preserving first-seen order."""
    seen, counts = [], {}
    try:
        with open(csv_path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            if not reader.fieldnames or "UID" not in reader.fieldnames:
                sys.exit(
                    f"No 'UID' column found. Columns present: {reader.fieldnames}"
                )
            for row in reader:
                uid = (row.get("UID") or "").strip().upper()
                if not uid:
                    continue
                if uid not in counts:
                    seen.append(uid)
                    counts[uid] = 0
                counts[uid] += 1
    except FileNotFoundError:
        sys.exit(f"CSV not found: {csv_path}")
    return seen, counts


def main():
    parser = argparse.ArgumentParser(description="Bulk-provision IWM scales from a CSV export.")
    parser.add_argument("--csv", required=True, help="Path to the scale-export CSV")
    parser.add_argument("--table", default="iwm-scales", help="DynamoDB table name")
    parser.add_argument("--region", default=None, help="AWS region (else your CLI default)")
    parser.add_argument("--organization", default="", help="Assign every scale to this organization")
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen, write nothing")
    args = parser.parse_args()

    uids, counts = read_uids(args.csv)
    if not uids:
        sys.exit("No UIDs found in that CSV.")

    print(f"\nFound {len(uids)} unique device UID(s):\n")
    for uid in uids:
        print(f"  {uid:<12} {counts[uid]:>6,} readings in file")
    print(f"\nTarget table : {args.table}")
    print(f"Organization : {args.organization or '(unassigned - set later in the UI)'}")

    if args.dry_run:
        print("\n--dry-run: nothing written.\n")
        return

    if input("\nCreate these scale records? [y/N]: ").strip().lower() != "y":
        sys.exit("Aborted.")

    try:
        import boto3
        from botocore.exceptions import ClientError, NoCredentialsError
    except ImportError:
        sys.exit("boto3 is not installed. Run:  pip install boto3")

    session = boto3.Session(region_name=args.region) if args.region else boto3.Session()
    table = session.resource("dynamodb").Table(args.table)

    created, skipped = 0, 0
    for uid in uids:
        item = {
            "scaleId": uid,
            "name": uid,  # placeholder — rename in the admin UI
            "organization": args.organization.strip(),
            "location": "",
            "status": "offline",
            "serial": "",
            "notes": f"Imported from {os.path.basename(args.csv)}",
            "mealSchedule": {},
            "lastReading": Decimal("0"),
            "lastActive": "",
            "battery": Decimal("0"),
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        try:
            table.put_item(Item=item, ConditionExpression="attribute_not_exists(scaleId)")
            print(f"  + created {uid}")
            created += 1
        except NoCredentialsError:
            sys.exit("\nNo AWS credentials found. Run 'aws configure' first.")
        except ClientError as err:
            code = err.response["Error"]["Code"]
            if code == "ConditionalCheckFailedException":
                print(f"  = {uid} already exists, left untouched")
                skipped += 1
            elif code == "ResourceNotFoundException":
                sys.exit(f"\nTable '{args.table}' not found in this region.")
            else:
                sys.exit(f"\nFailed writing {uid}: {err}")

    print(f"\nDone: {created} created, {skipped} already existed")
    print("  Set each scale's name, location and organization in")
    print("  Scale Management > Edit.\n")


if __name__ == "__main__":
    main()
