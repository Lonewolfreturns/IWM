// Raw scale telemetry from the IWM DynamoDB table, mirroring the device export:
// UID, DateTime, Date, Time, PerDepositWeight, RunningTotalWeight, Message1..3.
import { readingsApi } from './api';

/**
 * Historical readings. Defaults to the last 7 days server-side — enough for
 * the dashboard table without dragging the whole ~250k-row table across.
 */
export async function getReadings(params = {}) {
  const { data } = await readingsApi.get('/readings', { params });
  return data;
}

/**
 * Only readings newer than `sinceDateTime` (an ISO string from a row's
 * `dateTime`). Used by the dashboard's incremental refresh so a poll on a
 * quiet minute returns an empty list rather than re-sending the same
 * couple of thousand rows.
 */
export async function getReadingsSince(sinceDateTime) {
  const { data } = await readingsApi.get('/readings', {
    params: { since: sinceDateTime },
  });
  return data;
}

/**
 * The live ticker: readings within ±60 seconds of now.
 *
 * If nothing has landed in that band the API falls back to the most recent
 * rows and marks them `isLive: false`, so the panel shows last-known activity
 * instead of going blank.
 */
export async function getLiveReadings(seconds) {
  const { data } = await readingsApi.get('/readings/live', {
    params: seconds ? { seconds } : {},
  });
  return data;
}
