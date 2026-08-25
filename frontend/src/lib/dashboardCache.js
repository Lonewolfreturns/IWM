// =============================================================================
// IWM — Dashboard data cache
// =============================================================================
//
// React unmounts the Dashboard the moment you navigate to Analytics or Reports,
// which throws away every reading it had loaded. Coming back mounted it fresh:
// empty tables, "Loading…" panels, 0 kg tiles, and a wait on four separate
// per-device DynamoDB queries before anything appeared — every single time.
//
// Holding the last successful response here, outside the component tree, means
// a return to the Dashboard paints immediately with what was on screen before
// while the refresh happens behind it. The data is a few seconds stale at worst
// and the page already refreshes itself on a timer.
//
// A plain module singleton rather than context or a store: nothing needs to
// re-render when it changes — the component seeds its state from it once on
// mount and writes back as responses land.
// =============================================================================

const EMPTY = {
  scales: [],
  readings: [],
  live: [],
  stats: null,
  alerts: [],
  // Newest DateTime already loaded — the cursor for incremental refreshes.
  // Cached alongside the rows so a remount resumes the incremental fetch
  // instead of re-pulling the whole week.
  newestSeen: null,
  lastUpdated: null,
  // False until a first response has landed, so the component can tell
  // "nothing loaded yet" from "loaded, and genuinely empty".
  hydrated: false,
};

let cache = { ...EMPTY };

export function readDashboardCache() {
  return cache;
}

export function writeDashboardCache(patch) {
  cache = { ...cache, ...patch };
}

/**
 * Called on sign-out.
 *
 * Without this the next person to sign in on the same browser would see the
 * previous account's scales and readings painted on screen for the second or
 * two before their own data arrives.
 */
export function clearDashboardCache() {
  cache = { ...EMPTY };
}
