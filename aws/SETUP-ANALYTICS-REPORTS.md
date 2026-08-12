# Analytics & Reports Lambdas — setup

Two new functions, deployed separately from `iwm-readings`:

| Function | Source | Purpose |
|---|---|---|
| `iwm-analytics` | `aws/lambdas/analytics/lambda_function.py` | Every Analytics chart |
| `iwm-reports` | `aws/lambdas/reports/lambda_function.py` | Report payloads + raw export |

Both are read-only, token-gated, and share one response contract.

---

## 1. Create each function

Runtime **Python 3.12**, handler `lambda_function.lambda_handler`.
Timeout **30s** (a year-long range across a large fleet does a lot of queries).
Memory **512 MB**.

Enable a **Function URL**, auth type **NONE** — the JWT check inside the
function is the gate, exactly as `iwm-readings` works today.

## 2. Environment variables

Both functions:

| Variable | Default | Notes |
|---|---|---|
| `READINGS_TABLE` | `IWM` | |
| `SCALES_TABLE` | `iwm-scales` | needed for meal schedules and scale names |
| `JWT_SECRET` | — | **must match the auth Lambda exactly** |
| `ALLOWED_ORIGIN` | `*` | set to your site origin in production |
| `MAX_DAYS` | `366` | longest range accepted |
| `MAX_ROWS` | `20000` | rows scanned per request |
| `DEFAULT_DAYS` | `7` | window when `from` is omitted |

Analytics only:

| Variable | Default | Notes |
|---|---|---|
| `NEAREST_LOOKUP` | `1` | set `0` to skip the "nearest data" search on empty ranges |

Reports only:

| Variable | Default | Notes |
|---|---|---|
| `MAX_RAW_ROWS` | `5000` | cap on rows returned in the `raw` section |

## 3. IAM

Attach to each function's execution role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:Query", "dynamodb:Scan"],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT:table/IWM"
    },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:Scan", "dynamodb:GetItem"],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT:table/iwm-scales"
    }
  ]
}
```

`Scan` on `IWM` is only used by the admin UID discovery path, and its result is
cached for `UID_CACHE_TTL` (300s) per warm container.

---

## 4. Routes

### `iwm-analytics`

```
GET /analytics/coverage            what the range holds, no data
GET /analytics/summary             totals, averages, peak day
GET /analytics/daily-trend         kg per calendar day (zero-filled)
GET /analytics/period-comparison   this range vs the equal one before it
GET /analytics/category-breakdown  by Message2 category
GET /analytics/hourly-waste        24 hourly buckets
GET /analytics/meal-periods        kg per service period
GET /analytics/scale-comparison    per-scale totals
```

### `iwm-reports`

```
GET /reports/build      one payload, sections chosen by query param
GET /reports/raw        raw rows only
GET /reports/coverage   coverage only
```

### Shared query params

| Param | Example | Meaning |
|---|---|---|
| `from` | `2026-06-01` | inclusive start |
| `to` | `2026-06-30` | inclusive end |
| `uid` | `DAL00001` | one scale; omit for the caller's whole fleet |

`/reports/build` also takes `sections` — any of
`total,category,scale,meals,daily,raw` (default `total,category,scale`) — and
`limit` for the raw row cap.

---

## 5. Response contract

**Every** response carries `coverage`. This is the point of the rewrite: a
range that holds two days of data draws exactly like one holding thirty, so
the payload has to say which it is.

```jsonc
{
  "coverage": {
    "requested":    { "from": "2026-06-01", "to": "2026-06-30" },
    "actual":       { "from": "2026-06-15", "to": "2026-06-30" },
    "status":       "partial",        // "full" | "partial" | "empty"
    "complete":     false,
    "daysRequested": 30,
    "daysWithData":  16,
    "missing":      [ { "from": "2026-06-01", "to": "2026-06-14" } ],
    "nearest":      null,
    "message":      "Showing 2026-06-15 to 2026-06-30. No data for 2026-06-01 to 2026-06-14."
  },
  "data": [ /* route-specific */ ]
}
```

`missing` covers leading, trailing **and** interior gaps uniformly — a
fortnight missing from the middle of a month misleads exactly as much as one
missing from the front.

When nothing is found at all, `status` is `"empty"` and `nearest` points at
the closest data on each side, so the UI can offer a next step rather than a
dead end:

```jsonc
{
  "status":  "empty",
  "actual":  null,
  "nearest": {
    "before": { "date": "2026-05-14", "uid": "DAL00001" },
    "after":  { "date": "2026-07-03", "uid": "DAL00002" }
  },
  "message": "No data available between 2026-06-01 and 2026-06-30. The latest earlier data is 2026-05-14 and the earliest later data is 2026-07-03."
}
```

---

## 6. Service periods

`/analytics/meal-periods` buckets by the kitchen's own wall clock — the `Time`
column, which the ingest Lambda writes verbatim. No timezone conversion is
involved, and none should be: "lunch" means lunch where the scale is.

**Fleet default** tiles the whole 24 hours, so every reading lands in exactly
one bar and they always sum to the range total:

| Period | Window |
|---|---|
| Breakfast | 04:00–07:59 |
| Lunch | 08:00–11:59 |
| Snacks | 12:00–15:59 |
| Dinner | 16:00–19:59 |
| Night | 20:00–03:59 |

**When `uid` names a single scale** that has a `mealSchedule`, its own windows
are used instead. Those are usually narrow (breakfast 07:00–09:00), so they
leave parts of the day uncovered — anything falling outside every window is
reported under **Outside service hours** rather than dropped. The bars still
reconcile to the total, and that bucket is often the most interesting bar on
the chart.

Windows that cross midnight (`night 22:00 → 02:00`) are handled correctly.

A mixed fleet has no single correct schedule, so `uid`-less requests always use
the default tiling. `scheduleSource` in the response says which was applied.

---

## 7. After deploying

Send me both Function URLs. The frontend needs:

- `VITE_ANALYTICS_API_URL`
- `VITE_REPORTS_API_URL`

added to `frontend/.env`, and the pages rewired — the response shape is now
`{ coverage, data }` rather than a bare array, which is what lets the UI show
"showing 15–30 June, nothing before that" instead of implying full coverage.
