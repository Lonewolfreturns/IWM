# IWM — AWS Setup (Phase 2: Scales + Users API)

Second Lambda, `iwm-api`, handling scale allocation and user management.
Same copy-paste deployment as the auth Lambda — no zip, no layers.

Prerequisite: Phase 1 (`iwm-auth` + `iwm-users` table) is already live.

---

## Step 1 — Create the scales table

Console → **DynamoDB** → *Tables* → **Create table**

| Field | Value |
|---|---|
| Table name | `iwm-scales` |
| Partition key | `scaleId` — type **String** |
| Sort key | *(leave empty)* |
| Capacity mode | **On-demand** |

Use the **same region** as `iwm-users` (`us-east-2`).

### Why `scaleId` is the partition key

It stores the **physical device UID** — `DAL00001`, `GUELPH01`, exactly as it
appears in your CSV export. When telemetry arrives it's keyed by that UID, so
making it the partition key turns "which scale sent this?" into a single-item
O(1) lookup instead of a table scan. That decision is why sensors live in
their own table rather than as a list inside each user record.

---

## Step 2 — Create the Lambda

Console → **Lambda** → **Create function**

| Field | Value |
|---|---|
| Function name | `iwm-api` |
| Runtime | **Python 3.12** |
| Architecture | `arm64` |
| Execution role | **Create a new role with basic Lambda permissions** |

**2a.** Paste `aws/lambdas/api/lambda_function.py` into the editor → **Deploy**.

**2b.** *Configuration* → *Environment variables*:

| Key | Value |
|---|---|
| `USERS_TABLE` | `iwm-users` |
| `SCALES_TABLE` | `iwm-scales` |
| `READINGS_TABLE` | `IWM` |
| `JWT_SECRET` | **exactly the same value as `iwm-auth`** |
| `ALLOWED_ORIGIN` | `*` for now |

`READINGS_TABLE` is read-only here, used solely to spot devices that are
reporting telemetry but were never provisioned — see *Unregistered devices*.

> `JWT_SECRET` must match byte-for-byte. If it differs, tokens issued by the
> auth Lambda won't verify here and every request returns `401 Unauthorized` —
> which looks like a login bug but isn't.

**2c.** *Configuration* → *General configuration*:

| Setting | Value |
|---|---|
| Memory | **256 MB** |
| Timeout | **10 sec** |

(No PBKDF2 here, so this one doesn't need the auth Lambda's 512 MB.)

---

## Step 3 — IAM permissions

*Configuration* → *Permissions* → click the **execution role name** →
**Add permissions** → *Create inline policy* → **JSON**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/iwm-users",
        "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/iwm-scales",
        "arn:aws:dynamodb:us-east-2:ACCOUNT_ID:table/IWM"
      ]
    }
  ]
}
```

Replace `ACCOUNT_ID`, name it `iwm-api-access`, create.

---

## Step 4 — Function URL

*Configuration* → **Function URL** → **Create function URL**

| Setting | Value |
|---|---|
| Auth type | **NONE** |
| Configure CORS | **LEAVE UNCHECKED** |

`AuthType: NONE` only means AWS doesn't gate it — the Lambda itself rejects
every request without a valid JWT as its first action. Authorization is in the
code, where it can be role- and organization-aware.

Same CORS warning as before: the Lambda emits its own headers, and letting AWS
add a second set produces duplicates that browsers reject outright.

**Send me this URL** — the frontend needs both.

---

## Step 5 — Frontend

Once you send the URL I'll add it to `frontend/.env`:

```
VITE_API_URL=https://<auth-id>.lambda-url.us-east-2.on.aws
VITE_CORE_API_URL=https://<api-id>.lambda-url.us-east-2.on.aws
```

---

## Endpoints

Every route requires `Authorization: Bearer <token>`.

| Method | Path | Who | Notes |
|---|---|---|---|
| `GET` | `/scales` | any | admin → whole fleet · client → own org only |
| `POST` | `/scales` | admin | requires `scaleId` (device UID); `assignedEmail` optional |
| `PATCH` | `/scales/{id}` | admin → any field · client → `location`, `mealSchedule` only |
| `DELETE` | `/scales/{id}` | admin | |
| `GET` | `/users` | admin | never returns password hashes |
| `PATCH` | `/users/{id}` | admin | role · organization · status |
| `DELETE` | `/users/{id}` | admin | |
| `GET` | `/me` | any | own profile |
| `PATCH` | `/me` | any | own `name`, `phone`, `city` |

### Assigning a scale to a user

Scales are allocated to a **person, chosen by email** — an unambiguous
identifier, unlike an org name that's easy to mistype. The API then looks that
user up and derives `organization` from their account:

```jsonc
// request
{ "scaleId": "DAL00001", "name": "Prep Station",
  "assignedEmail": "avery@maple.ca" }

// stored + returned
{ "assignedEmail": "avery@maple.ca",
  "organization": "Maple Grove Bistro" }   // derived, not taken from the request
```

Deriving it server-side means the two fields can never drift apart, and a
caller can't spoof an organization by sending one alongside the email — an
explicit `assignedEmail` always wins.

`"assignedEmail": ""` unassigns the scale and clears its organization.
An unknown email is rejected `400` rather than silently creating an orphan.

> **Visibility is org-level, not per-person.** Assigning a scale to
> `avery@maple.ca` makes it visible to *everyone* at Maple Grove Bistro. That's
> usually what a kitchen wants — the data belongs to the site, not one login.
> Say the word if you'd rather it be strictly per-user.

### Meal schedule shape

```jsonc
{
  "mealSchedule": {
    "breakfast": { "from": "07:00", "to": "09:00" },
    "lunch":     { "from": "12:00", "to": "14:00" },
    "dinner":    { "from": "18:00", "to": "20:00" },
    "snacks":    { "from": "15:00", "to": "16:00" },
    "night":     { "from": "22:00", "to": "02:00" }   // may cross midnight
  }
}
```
24-hour `HH:MM` only. Unknown meal keys and malformed times are rejected `400`.

---

## Unregistered devices

`GET /scales` as an **admin** also returns devices that are sending telemetry
but have no record in `iwm-scales`. They come back with:

```jsonc
{ "scaleId": "DAL77777", "registered": false, "status": "unregistered",
  "organization": "", "name": "DAL77777" }
```

and sort to the top of the list, with a **Provision** button in the UI that
opens the add dialog with the UID pre-filled.

This exists because a scale that's emitting data nobody set up is precisely
what an operator needs to notice — and it can't be found by looking at
`iwm-scales`, since by definition it isn't there. The UID list is discovered
with a projected scan and cached for 5 minutes, so it costs one scan per warm
container rather than one per request.

**Clients never see these**, only admins.

If the IAM grant on `IWM` is missing, discovery fails quietly and the scales
list still renders — just without the unregistered extras. A missing
permission shouldn't take down the whole page.

---

## Authorization model

Two rules carry the multi-tenancy guarantee:

1. **Scoping comes from the token, never the request.** A client's scale list
   is filtered by the `org` claim inside their signed JWT. There is no
   client-supplied parameter that can widen it.
2. **Clients get a field allow-list.** They may set `location` and
   `mealSchedule`, and only on scales their own organization owns. They cannot
   set `organization` (which would let them reassign another org's scale to
   themselves) or `status`.

Also enforced: an admin can't demote, deactivate, or delete their own account —
that's the one mistake that locks everyone out of the admin surface permanently.

---

## Verifying

Grab a token first:

```bash
TOKEN=$(curl -s -X POST "https://<auth-id>.lambda-url.us-east-2.on.aws/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@iwm.ca","password":"...","secretAnswer":"...","role":"admin"}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['token'])")
```

```bash
API="https://<api-id>.lambda-url.us-east-2.on.aws"

# no token -> 401
curl -i "$API/scales"

# provision a real scale from your CSV
curl -s -X POST "$API/scales" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scaleId":"DAL00001","name":"Prep Station","organization":"Maple Grove Bistro","location":"Halifax, NS"}'

curl -s "$API/scales" -H "Authorization: Bearer $TOKEN"
curl -s "$API/users"  -H "Authorization: Bearer $TOKEN"
```

| Symptom | Cause |
|---|---|
| Everything returns `401` | `JWT_SECRET` differs between the two Lambdas |
| `503 Could not load scales` | Step 3 IAM missing `Scan`, or wrong table ARN |
| `500` + `ResourceNotFoundException` | Table name / region mismatch |
| CORS error but curl works | "Configure CORS" got ticked in Step 4 |
| Client sees no scales | No scale has `organization` matching their exact org string |

That last one is the most likely real-world snag: the match is an exact string
compare between `user.organization` and `scale.organization`. "North Café Co."
and "North Cafe Co." are different organizations as far as the API is concerned.

---

## Not built yet

Readings ingestion. `lastReading`, `lastActive` and `battery` stay at their
defaults until that exists — scales will show `0 kg` / `0%`, which is honest
rather than fabricated. That's the next Lambda: accept telemetry keyed by UID,
write it to an `iwm-readings` table, and roll the summary fields onto the
scale record.
