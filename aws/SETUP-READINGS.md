# IWM — AWS Setup (Phase 3: Live Readings + Alerts)

Third Lambda, `iwm-readings`, serving telemetry from your existing **`IWM`**
table plus everything derived from it. Same copy-paste deployment — no zip,
no layers.

Prerequisites: `iwm-auth` and `iwm-api` live, and the `IWM` table already
receiving data from your ingest Lambda.

---

## Step 0 — Update the ingest Lambda

Replace your existing sensor-ingest function with
`aws/lambdas/ingest/lambda_function.py`, then set one environment variable:

| Key | Value |
|---|---|
| `TABLE_NAME` | `IWM` |
| `SOURCE_TZ` | `America/Halifax` — the zone the scales report in |

Set `SOURCE_TZ=UTC` if the devices already send UTC; timestamps then pass
through untouched.

**What changed and why.** `DateTime` (the sort key) is now normalised to
**UTC**, so it can be compared against server time — that's what makes the
live "±60 seconds" window work at all. `Date` and `Time` stay **local**, so
"today's total" and "peak waste hours" still reflect the kitchen's own day
instead of rolling over at midnight UTC. The raw device string is preserved in
`SourceDateTime`, so a wrong `SOURCE_TZ` is always recoverable.

Daylight saving is handled properly (Halifax is UTC−4 in winter, UTC−3 in
summer), which a fixed offset would get wrong for half the year.

Also fixed: a null `Message3` used to raise `AttributeError` and drop the
reading; non-numeric weights now fall back to 0 rather than failing the write.

---

## Step 1 — Create the Lambda

Console → **Lambda** → **Create function**

| Field | Value |
|---|---|
| Function name | `iwm-readings` |
| Runtime | **Python 3.12** |
| Architecture | `arm64` |
| Execution role | **Create a new role with basic Lambda permissions** |

Paste `aws/lambdas/readings/lambda_function.py` → **Deploy**.

**Environment variables:**

| Key | Value |
|---|---|
| `READINGS_TABLE` | `IWM` |
| `SCALES_TABLE` | `iwm-scales` |
| `JWT_SECRET` | **byte-identical to the other two Lambdas** |
| `ALLOWED_ORIGIN` | `*` for now |

**General configuration:**

| Setting | Value |
|---|---|
| Memory | **512 MB** |
| Timeout | **30 sec** |

The timeout matters: the first cold call runs one projected scan of the table
to discover which UIDs exist (see *Why the UID scan* below). Subsequent warm
calls skip it.

---

## Step 2 — IAM permissions

*Configuration* → *Permissions* → execution role → **Add permissions** →
*Create inline policy* → **JSON**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:Query", "dynamodb:Scan"],
      "Resource": [
        "arn:aws:dynamodb:us-east-2:192771711136:table/IWM",
        "arn:aws:dynamodb:us-east-2:192771711136:table/iwm-scales"
      ]
    }
  ]
}
```

Read-only by design — this Lambda never writes. Name it `iwm-readings-access`.

---

## Step 3 — Function URL

*Configuration* → **Function URL** → **Create function URL**

| Setting | Value |
|---|---|
| Auth type | **NONE** |
| Configure CORS | **LEAVE UNCHECKED** |

Same reasoning as before: the Lambda rejects any request without a valid JWT as
its first action, and it emits its own CORS headers — letting AWS add a second
set produces duplicates that browsers reject.

**Send me the URL** and I'll drop it into `VITE_READINGS_API_URL` (already
stubbed in `frontend/.env`).

---

## Endpoints

All require `Authorization: Bearer <token>`.

| Path | Returns |
|---|---|
| `GET /readings` | raw rows, last 7 days by default |
| `GET /readings/live` | rows within **now ±60s** for the dashboard ticker |
| `GET /dashboard/stats` | today / yesterday totals, weekly change, sparkline |
| `GET /dashboard/alerts` | computed alerts (rules below) |
| `GET /analytics/category-breakdown` | kg grouped by Message2 category |
| `GET /analytics/hourly-waste` | kg per hour of day |
| `GET /analytics/weekly-trend` | this week vs last week, per day |

Params: `?uid=DAL00001&from=2025-11-01&to=2025-11-30&days=7&limit=2000`,
and `?seconds=` to widen the live band.

---

## Alert rules

A sustained **negative** `PerDepositWeight` means the load cell is losing
weight reading after reading — a bin removed, drifting calibration, or
tampering. One negative sample is routine (a bin lifted off the plate), so
*runs*, not individual samples, are what trigger:

| Severity | Condition |
|---|---|
| 🟠 **Warning** | ≥ **5** consecutive samples at or below **−10 kg** |
| 🔴 **Critical** | ≥ **10** consecutive samples at or below **−100 kg** |

Runs are evaluated per UID in chronological order and reset the moment a
sample climbs back above the band. A critical-band sample also counts toward
the warning run, so severity escalates rather than the two competing.

Tune without redeploying via `WARN_RUN`, `WARN_KG`, `CRIT_RUN`, `CRIT_KG`.

---

## Categories

`Message2` carries **both** waste categories and device events, so only these
three are treated as categories:

| Message2 | Colour |
|---|---|
| `Overproduction` | red |
| `Prep Waste` | amber |
| `Storage EXP` | violet |

Anything else — `Wifi Reconnected`, blanks — is counted as **Uncategorised**
rather than being charted as a food category. Matching is case-insensitive.

Only **positive** `PerDepositWeight` counts toward waste totals; negatives are
removals and corrections, and including them would understate real waste.

---

## Scoping

* **Admins see every UID in the table**, including devices never registered in
  `iwm-scales`. That's deliberate — a scale emitting data nobody provisioned is
  exactly what you need to notice, and filtering it out would hide it. This
  covers your `flwdal@dal.ca` requirement.
* **Clients** see only UIDs whose scale record is assigned to their
  organization, taken from their signed token — never from the request.

> All admins get the full view, not just `flwdal@dal.ca`. That's consistent
> with how `/scales` and `/users` already behave. Say the word if you'd rather
> it be locked to that one address.

---

## Why the UID scan

The table has ~250k items (~39 MB). Scanning it per request would take seconds
and read the whole thing every time. Instead:

* Every request works over a bounded window (default 7 days, max 365).
* `DateTime` is the sort key, so readings for a known UID come back via a key
  condition — DynamoDB reads only the rows in range.
* The **set of UIDs** is the one thing that can't be derived from `iwm-scales`
  (unregistered devices are the whole point), so it's discovered once with a
  projected scan and cached in module scope for 5 minutes. Warm invocations
  skip it entirely.

Net effect: a ~39 MB full scan becomes a handful of small indexed queries.

**If this ever gets slow**, add a GSI on `Date` and query it directly — but at
11 devices you're a long way from needing it.

---

## Empty-window fallback

If the requested window holds nothing — ingestion paused, or you're looking at
a quiet night — the API returns each device's **most recent** readings instead
of an empty array. A dashboard showing last-known data beats one that looks
broken.

`/readings/live` marks these rows `isLive: false`, and the dashboard badge
switches from **Live** to **Idle** accordingly, so it never claims to be live
when it isn't.

---

## Verifying

```bash
TOKEN=$(curl -s -X POST "https://<auth-id>.lambda-url.us-east-2.on.aws/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"flwdal@dal.ca","password":"...","secretAnswer":"..."}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['token'])")

API="https://<readings-id>.lambda-url.us-east-2.on.aws"

curl -i "$API/readings"                                    # 401 without a token
curl -s "$API/readings?limit=5"     -H "Authorization: Bearer $TOKEN"
curl -s "$API/readings/live"        -H "Authorization: Bearer $TOKEN"
curl -s "$API/dashboard/stats"      -H "Authorization: Bearer $TOKEN"
curl -s "$API/dashboard/alerts"     -H "Authorization: Bearer $TOKEN"
curl -s "$API/analytics/category-breakdown" -H "Authorization: Bearer $TOKEN"
```

| Symptom | Cause |
|---|---|
| Everything `401` | `JWT_SECRET` differs from the auth Lambda's |
| `503 Could not load readings` | IAM policy missing `Query`/`Scan`, or wrong ARN |
| `Task timed out` on first call | Timeout below 30s while the UID scan runs |
| Empty categories | `Message2` values don't match the three names exactly |
| `/readings/live` always shows **Idle** | Ingest Lambda not redeployed, or `SOURCE_TZ` wrong |

### Timestamps

`DateTime` (the sort key) is **UTC**; `Date` and `Time` are **local**. That
split is what makes both the live window and the daily/hourly analytics
correct at the same time — see `aws/lambdas/ingest/lambda_function.py`.

Rows written before the ingest update carry device-local time in `DateTime`,
so there's a three-to-four hour discontinuity at the changeover. In practice
this barely matters: the live window only looks at the last minute, and every
daily/hourly figure reads `Date`/`Time`, which were local before and stay
local now. Only wide historical range queries see a small boundary skew.

Backfilling the ~250k existing rows would mean a delete-and-recreate per item,
since a sort key can't be updated in place. Not worth it for a few hours of
skew on historical boundaries — but say the word if you want the script.

---

## Not wired yet

`monthly-trend`, `monthly-by-category`, `heatmap` and `scale-performance` have
no backend, so those Analytics cards render empty states rather than invented
numbers. They're straightforward to add on the same pattern once you want them.

Battery has been removed from the product entirely — the device export has no
battery channel, so there was no honest way to populate it.
