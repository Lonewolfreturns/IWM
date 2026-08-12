// Date-range helpers shared by Analytics and Reports.
//
// The readings Lambda accepts `?from=` and `?to=` (see `resolve_window` in
// aws/lambdas/readings/lambda_function.py) and applies them before any
// aggregate is computed, so every analytics endpoint honours the same range.
// When neither is sent it falls back to DEFAULT_DAYS = 7 ending today, which
// is what the dashboard shows — so that is what these pages open on.
//
// Dates are handled in UTC throughout, because the Lambda anchors its default
// to `datetime.now(timezone.utc).date()`. Using local dates here would put the
// two a day apart for anyone west of Greenwich.

/** Days of history the API returns when no explicit range is given. */
export const WINDOW_DAYS = 7;

/**
 * Adds `days` to a YYYY-MM-DD string, in UTC.
 *
 * Built via Date.UTC rather than `new Date(str)` because the latter parses a
 * bare date as UTC midnight but reads it back through local getters — west of
 * Greenwich that lands on the previous day, shifting the whole range by one.
 */
export function shiftDays(isoDate, days) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Today in UTC, as YYYY-MM-DD — the same "today" the Lambda uses. */
export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The range a page opens on: the trailing week ending today, matching the
 * API's own default and therefore the main dashboard.
 */
export function defaultWindow(days = WINDOW_DAYS) {
  const to = todayUTC();
  return { from: shiftDays(to, -days), to };
}

/** Whole days covered by a range, inclusive of both ends. */
export function daysInWindow(from, to) {
  if (!from || !to) return WINDOW_DAYS;
  const ms = new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`);
  const days = Math.round(ms / 86400000) + 1;
  return days > 0 ? days : WINDOW_DAYS;
}

/** "2026-08-04 → 2026-08-11". */
export function formatWindowLabel(from, to) {
  return from && to ? `${from} → ${to}` : '—';
}

/**
 * Validates a user-entered range. Returns an error string, or null when usable.
 * Guards the API from a reversed range, which would return nothing at all and
 * look like a data outage rather than a typo.
 */
export function validateWindow(from, to) {
  if (!from || !to) return 'Pick both a start and an end date.';
  if (from > to) return 'The start date must fall on or before the end date.';
  if (from > todayUTC()) return 'The start date is in the future.';
  return null;
}
