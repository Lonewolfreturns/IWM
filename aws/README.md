# IWM — AWS Setup (Phase 1: Auth)

Everything you need to stand up signup + login on DynamoDB and a single Lambda.

```
aws/
  lambdas/auth/lambda_function.py   <- paste this into the Lambda console
  scripts/create_admin.py           <- run locally to create admin accounts
```

**No dependencies to install or zip.** The Lambda uses only Python stdlib plus
`boto3`, which AWS preinstalls in the Python runtime. Copy-paste deployment.

---

## How credentials are stored

| Data | Protection | Reversible? |
|---|---|---|
| Password | PBKDF2-HMAC-SHA256, 210k iterations, random 16-byte salt per user | **No** — one-way hash |
| Secret answer | Same as password (it *is* a credential) | **No** — one-way hash |
| Name, org, phone, city, email | DynamoDB encryption at rest (AWS-managed KMS, automatic) | Yes, by AWS to serve reads |

> You asked for credentials to be stored "encrypted." The correct handling is
> **hashing**, which is what's implemented. Encryption is reversible — anyone
> with the database *and* the key gets every password back in plaintext.
> Hashing is one-way: even with full DB access, passwords can't be recovered.
> The tradeoff is that nobody (including you) can ever *read* a password —
> a forgotten password must be reset, not looked up. That's the correct and
> expected behaviour.

Each user gets a unique random salt, so two people with the same password
produce completely different hashes, and precomputed rainbow tables are useless.

---

## Step 1 — Create the DynamoDB table

Console → **DynamoDB** → *Tables* → **Create table**

| Field | Value |
|---|---|
| Table name | `iwm-users` |
| Partition key | `email` — type **String** |
| Sort key | *(leave empty)* |
| Table settings | **Customize settings** |
| Capacity mode | **On-demand** *(pay per request — pennies at your volume)* |

Leave everything else default and create it. Encryption at rest is on by
default with an AWS-owned key; nothing to configure.

> Pick a region and use it for everything (`ca-central-1` makes sense for a
> Canadian project). Write it down — you'll need it again.

---

## Step 2 — Create the Lambda

Console → **Lambda** → **Create function**

| Field | Value |
|---|---|
| Option | **Author from scratch** |
| Function name | `iwm-auth` |
| Runtime | **Python 3.12** |
| Architecture | `arm64` *(cheaper and faster)* |
| Execution role | **Create a new role with basic Lambda permissions** |

Create it, then:

**2a. Paste the code.** In the *Code* tab, replace everything in
`lambda_function.py` with the contents of `aws/lambdas/auth/lambda_function.py`,
then click **Deploy**.

**2b. Set environment variables.** *Configuration* → *Environment variables* → Edit:

| Key | Value |
|---|---|
| `USERS_TABLE` | `iwm-users` |
| `JWT_SECRET` | a long random string — generate one, see below |
| `JWT_TTL_SECONDS` | `86400` |
| `ALLOWED_ORIGIN` | `*` for now; your real domain before going live |

Generate a strong `JWT_SECRET`:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

> Anyone who knows `JWT_SECRET` can forge admin logins. Never commit it,
> never put it in the frontend. Changing it later logs everyone out.

**2c. Bump memory and timeout.** *Configuration* → *General configuration* → Edit:

| Setting | Value |
|---|---|
| Memory | **512 MB** |
| Timeout | **10 sec** |

Memory matters here: Lambda scales CPU with memory, and each login runs two
PBKDF2 hashes. At 128 MB a login takes ~1.5s; at 512 MB it's ~250ms.

---

## Step 3 — Give the Lambda access to the table

*Configuration* → *Permissions* → click the **execution role name** (opens IAM).

In IAM: **Add permissions** → *Create inline policy* → **JSON** tab → paste,
replacing `REGION` and `ACCOUNT_ID`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem"
      ],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/iwm-users"
    }
  ]
}
```

Name it `iwm-users-access` and create. Your account ID is in the top-right
account menu of the console.

---

## Step 4 — Expose it with a Function URL

*Configuration* → **Function URL** → **Create function URL**

| Setting | Value |
|---|---|
| Auth type | **NONE** |
| Invoke mode | BUFFERED |
| Configure CORS | **LEAVE THIS UNCHECKED** |

**Auth type must be NONE** — this *is* the login endpoint, so it has to be
reachable before anyone has a token. It's not unauthenticated in the meaningful
sense: it still demands email + password + secret code.

**Do not tick "Configure CORS."** The Lambda already returns CORS headers. If
AWS adds its own too, the browser sees duplicate `Access-Control-Allow-Origin`
headers and blocks every request — a confusing failure that looks like a code
bug. This trips up a lot of people.

Copy the generated URL. It looks like:

```
https://abc123xyz.lambda-url.ca-central-1.on.aws/
```

**That's the link to send me.**

---

## Step 5 — Create your admin account

Signup always forces `role: "client"`, so admins can't be self-registered —
that's deliberate. Provision yours with the script:

```bash
pip install boto3
aws configure          # once: access key, secret, default region
python aws/scripts/create_admin.py --table iwm-users --region ca-central-1
```

It prompts for name, email, password, and your security question + answer,
hashes them with the *same* parameters the Lambda uses, and writes the record.

> Don't try to create an admin by hand in the DynamoDB console — you'd have to
> produce a valid PBKDF2 salt+hash pair, and a plaintext password in the
> `passwordHash` field simply won't authenticate.

---

## Step 6 — Point the frontend at it

Create `frontend/.env` (already gitignored):

```
VITE_API_URL=https://abc123xyz.lambda-url.ca-central-1.on.aws
```

No trailing slash. Restart the dev server — Vite only reads `.env` at startup.

The frontend calls `POST {VITE_API_URL}/auth/login` and
`POST {VITE_API_URL}/auth/signup`, which is exactly what the Lambda routes.

---

## Verifying it works

Test the Lambda directly before involving the browser:

```bash
curl -i -X POST "https://YOUR-URL.lambda-url.REGION.on.aws/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.ca","password":"testpass123","secretQuestion":"What is your favorite food?","secretAnswer":"poutine","organization":"Test Kitchen","city":"Toronto"}'
```

Expect `201` and a JSON body with `token` and `user`. Then:

```bash
curl -i -X POST "https://YOUR-URL.lambda-url.REGION.on.aws/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.ca","password":"testpass123","secretAnswer":"Poutine"}'
```

Expect `200` (note: the answer is intentionally case-insensitive). Open the
`iwm-users` table in the console and confirm you see `passwordHash` /
`passwordSalt` and **no plaintext password anywhere**.

### If something breaks

| Symptom | Cause |
|---|---|
| `500 Server is not configured correctly` | `JWT_SECRET` env var missing |
| `500` + `AccessDeniedException` in CloudWatch | Step 3 IAM policy missing or wrong ARN |
| `500` + `ResourceNotFoundException` | Table name or region mismatch |
| CORS error in browser, curl works | You ticked "Configure CORS" in Step 4 — turn it off |
| `Task timed out` | Timeout still at the 3s default (Step 2c) |
| Login always fails for admin | Admin was hand-created, or iteration counts drifted between script and Lambda |

Logs: Lambda → *Monitor* → **View CloudWatch logs**.

---

## API reference

### `POST /auth/signup`
```jsonc
// request — role is ignored; always creates a client
{ "name": "...", "email": "...", "password": "...",       // min 8 chars
  "secretQuestion": "...", "secretAnswer": "...",
  "organization": "...", "city": "...", "phone": "..." }   // phone optional

// 201
{ "token": "<jwt>", "user": { "id", "name", "email", "role",
                              "organization", "city", "phone",
                              "status", "secretQuestion" } }
```
`400` validation failed · `409` email already registered

### `POST /auth/login`
```jsonc
// request — role optional; if sent, must match the account
{ "email": "...", "password": "...", "secretAnswer": "...", "role": "client" }

// 200
{ "token": "<jwt>", "user": { ... } }
```
`400` missing fields · `401` bad credentials (deliberately generic) ·
`403` deactivated account, or role mismatch

### Token format
HS256 JWT, 24h default lifetime:
```json
{ "sub": "u-abc123", "email": "...", "role": "client", "org": "...",
  "iat": 1234567890, "exp": 1234654290 }
```

---

## What's next

`lambda_function.py` exports **`verify_token(token)`** — reuse it in the
Lambdas we build next (readings, scales, users, analytics) to authorize
requests. It returns the decoded payload or `None`, and fails closed on
anything malformed. Typical use:

```python
auth_header = (event.get("headers") or {}).get("authorization", "")
claims = verify_token(auth_header.removeprefix("Bearer ").strip())
if not claims:
    return respond(401, {"message": "Unauthorized"})
if claims["role"] != "admin":
    return respond(403, {"message": "Admin access required"})
# scope client queries with claims["org"]
```

The frontend already attaches `Authorization: Bearer <token>` to every request
automatically (see `frontend/src/services/api.js`).
