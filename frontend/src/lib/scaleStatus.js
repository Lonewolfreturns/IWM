// =============================================================================
// IWM — Is a scale actually reporting?
// =============================================================================
//
// There are two possible answers to that, and the app used to give both.
//
// The `status` field on a scale record is an ADMIN FLAG. Nothing in the ingest
// or readings pipeline ever writes it — grep the Lambdas for the string
// "online" and there are no hits outside the validator. It defaults to
// "offline" at creation and only changes when a person edits the form. So a
// page that reads it reports "0 online" for a fleet that is happily sending
// data, forever.
//
// Scale Management did exactly that while the Dashboard derived state from
// telemetry, so the two pages disagreed about the same fleet at the same
// moment. This module is the single derivation both now use.
//
// The flag is still honoured for one thing: `maintenance` is a statement of
// intent that no amount of telemetry can contradict.
// =============================================================================

import { FLEET_TIME_ZONE, readingInstant, relativeTime } from './time.js';

const HOUR_MS = 60 * 60 * 1000;

// Readings are event-driven — a scale only reports when something is thrown
// away — so silence is not automatically a fault. A kitchen can legitimately
// go overnight without a deposit. These tiers separate "quiet" from "worrying"
// instead of calling anything past an hour dead.
export const ONLINE_WINDOW_MS = 24 * HOUR_MS;   // reported today
export const IDLE_WINDOW_MS = 7 * 24 * HOUR_MS; // quiet, but plausibly unused

const STATE_LABELS = {
  online: 'active',
  maintenance: 'maintenance',
  idle: 'quiet',
  silent: 'silent',
  unknown: 'no data',
};

// `maintenance` is an admin flag rather than an observation, so it keeps its
// own slot and is placed by tier before the age ordering applies.
const RANK = { online: 0, maintenance: 1, idle: 2, silent: 3, unknown: 4 };

/**
 * Latest reading per UID, from any number of newest-first feeds.
 *
 * The live feed and the history window are passed together because either
 * alone is incomplete: the live endpoint returns only its narrow band when
 * that band matches, and the history window lags the last minute.
 */
export function latestByUid(...feeds) {
  const latest = new Map();
  feeds.forEach((rows) => {
    (rows || []).forEach((r) => {
      // Keyed case-insensitively. A scale record and its readings hold the
      // same device UID in two different tables, and nothing guarantees they
      // agree on capitalisation — aws/scripts/import_scales.py upper-cases the
      // UID when it creates a scale record, while the readings keep whatever
      // the device sent. So `Scotttest4` in one table and `SCOTTTEST4` in the
      // other are the same physical scale, and an exact-match join silently
      // reports it as never having reported.
      const key = String(r?.uid || '').trim().toLowerCase();
      if (key && !latest.has(key)) latest.set(key, r);
    });
  });
  return latest;
}

/**
 * Derives each scale's state from when it last reported.
 *
 * `scales` are records as the API returns them; `latest` is the map from
 * latestByUid(). Returns rows ordered most-recently-heard-from first.
 */
export function deriveScaleStatuses(scales, latest, now = Date.now()) {
  return (scales || [])
    .map((sc) => {
      const id = sc.scaleId || sc.id;
      const last = latest.get(String(id || '').trim().toLowerCase());
      const lastAt = last?.dateTime || null;

      // Age is an elapsed duration, so it needs a real instant. A scale with
      // no `timeZone` of its own is read on the fleet clock rather than the
      // viewer's — the difference between one assumption stated once and a
      // different guess for every person who opens the page.
      const ownZone = Boolean(sc.timeZone);
      const sourceZone = sc.timeZone || FLEET_TIME_ZONE;
      const lastInstant = lastAt ? readingInstant(lastAt, sourceZone) : null;
      const ageMs = lastInstant ? now - lastInstant.getTime() : null;

      let state;
      if (sc.status === 'maintenance') state = 'maintenance';   // admin override
      else if (ageMs == null) state = 'unknown';
      else if (ageMs <= ONLINE_WINDOW_MS) state = 'online';
      else if (ageMs <= IDLE_WINDOW_MS) state = 'idle';
      else state = 'silent';

      return {
        id,
        name: sc.name || id,
        location: sc.location || '',
        // Devices emitting telemetry that were never provisioned here. Carried
        // through so callers can count them separately from silent ones.
        registered: sc.registered !== false,
        state,
        stateLabel: STATE_LABELS[state],
        lastKg: last?.perDepositWeight ?? null,
        ageMs,
        // Whether this row's clock came from the scale's own record or from
        // the fleet default. Surfaced in tooltips rather than as body text:
        // with the default applied it is true of most rows, and a marker on
        // every row is noise rather than information.
        ownZone,
        sourceZone,
        lastSeenLabel: lastAt
          ? relativeTime(lastAt, sourceZone, now)
          : 'never reported',
      };
    })
    // Ordered by how recently each scale reported, newest first — the question
    // this answers is "who have I heard from lately", and a tie-break on name
    // meant five scales that all reported today came back alphabetically,
    // burying the one that just checked in.
    //
    // Sorting on age also reproduces the active -> quiet -> silent grouping for
    // free, since those tiers are cut from the same number. Scales that have
    // never reported have no age and sort last.
    .sort((a, b) => {
      const tier =
        RANK[a.state] === 1 || RANK[b.state] === 1
          ? RANK[a.state] - RANK[b.state]
          : 0;
      if (tier) return tier;
      if (a.ageMs == null) return b.ageMs == null ? a.name.localeCompare(b.name) : 1;
      if (b.ageMs == null) return -1;
      return a.ageMs - b.ageMs;
    });
}

/**
 * Fleet counts, for the summary tiles.
 *
 * Two independent axes, which is worth being explicit about because they look
 * like one list of four numbers.
 *
 *   online + offline == total      is this device sending data?
 *   unregistered                   has anybody provisioned it?
 *
 * A device can be unregistered AND reporting — that is precisely how an
 * unprovisioned scale gets noticed. So `unregistered` deliberately OVERLAPS
 * the first two rather than partitioning with them; counting it as a third
 * exclusive bucket would have excluded live devices from "online" purely
 * because no record exists for them yet.
 *
 * `online` counts every reporting device, provisioned or not, which is the
 * same figure the Dashboard's Active Scales tile shows.
 */
export function summariseScaleStatuses(statuses) {
  const rows = statuses || [];
  const online = rows.filter((s) => s.state === 'online').length;
  return {
    total: rows.length,
    online,
    // Everything not heard from inside the online window — quiet, silent,
    // never-reported and under maintenance alike.
    offline: rows.length - online,
    unregistered: rows.filter((s) => !s.registered).length,
  };
}
