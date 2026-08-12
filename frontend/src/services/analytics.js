// Analytics data — served by the iwm-analytics Lambda.
//
// Every route accepts the same window params and returns the same envelope:
//
//     { coverage: {...}, data: [...] }
//
// `coverage` is not optional metadata. A range holding two days of data draws
// exactly like one holding thirty — same axes, same shapes, a total that reads
// as authoritative while answering a narrower question. Callers are expected
// to surface it, which is why these helpers return the whole envelope rather
// than unwrapping to `data` for convenience.
import { analyticsApi as api } from './api';

/** Strips blanks and `all` so we never send `?uid=all` to the API. */
function windowParams({ from, to, uid } = {}) {
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  if (uid && uid !== 'all') params.uid = uid;
  return params;
}

/**
 * Shape returned when a request fails outright.
 *
 * A network error is not the same as an empty range, and rendering it as one
 * would tell someone their kitchen produced no waste when in fact nothing was
 * asked. `status: 'error'` keeps the two distinguishable all the way to the UI.
 */
function errorEnvelope(err, fallback) {
  const message =
    err?.response?.data?.message ||
    (err?.response ? `Request failed (${err.response.status})` : 'Could not reach the server');
  return {
    coverage: { status: 'error', complete: false, message, missing: [], nearest: null },
    data: fallback,
  };
}

async function get(path, opts, fallback = []) {
  try {
    const { data } = await api.get(path, { params: windowParams(opts) });
    return {
      coverage: data?.coverage ?? null,
      data: data?.data ?? fallback,
      ...data,
    };
  } catch (err) {
    return errorEnvelope(err, fallback);
  }
}

/** Coverage alone — cheap enough to call before deciding what else to load. */
export function getCoverage(opts) {
  return get('/analytics/coverage', opts, null);
}

/** { totalKg, deposits, scalesReporting, avgPerActiveDayKg, peakDay, ... } */
export function getSummary(opts) {
  return get('/analytics/summary', opts, null);
}

/** [{ date, day, value, hasData }] — zero-filled across the whole range. */
export function getDailyTrend(opts) {
  return get('/analytics/daily-trend', opts);
}

/** { current, previous, changePct } — changePct is null when there's no baseline. */
export function getPeriodComparison(opts) {
  return get('/analytics/period-comparison', opts, null);
}

/** [{ name, value, color }] keyed to the three real Message2 categories. */
export function getCategoryBreakdown(opts) {
  return get('/analytics/category-breakdown', opts);
}

/** [{ hour, value }] — 24 buckets, local wall clock. */
export function getHourlyWaste(opts) {
  return get('/analytics/hourly-waste', opts);
}

/**
 * [{ key, label, window, value, deposits, color }]
 *
 * Also carries `scheduleSource`: "scale" when a single scale's own
 * mealSchedule was applied, "default" for the fleet-wide tiling.
 */
export function getMealPeriods(opts) {
  return get('/analytics/meal-periods', opts);
}

/** [{ uid, name, value, deposits, lastReading }] */
export function getScaleComparison(opts) {
  return get('/analytics/scale-comparison', opts);
}
