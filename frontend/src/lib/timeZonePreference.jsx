import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { browserTimeZone } from './time.js';

/**
 * How the app renders reading timestamps, chosen once and applied everywhere.
 *
 * Readings are stored as a UTC instant (`dateTime`), which is what makes this
 * possible at all: an absolute instant can be rendered in any zone, whereas a
 * bare local time like "14:22" carries no offset and cannot be moved to
 * another zone without guessing where it came from.
 *
 * Three modes:
 *   auto        the viewer's own device zone (default)
 *   per-scale   each reading in the zone of the scale that produced it —
 *               the honest view for a fleet spread across provinces, and what
 *               the app did before this preference existed
 *   <IANA>      one fixed zone for everything, e.g. "America/Toronto"
 */

export const ZONE_AUTO = 'auto';
export const ZONE_PER_SCALE = 'per-scale';

const STORAGE_KEY = 'ww_time_zone';

const TimeZoneContext = createContext(null);

export function TimeZoneProvider({ children }) {
  const [preference, setPreferenceState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || ZONE_AUTO;
    } catch {
      return ZONE_AUTO;
    }
  });

  const setPreference = useCallback((next) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode — the choice just won't survive a reload */
    }
  }, []);

  // Keep tabs in step: changing the zone in one should not leave another
  // rendering the same rows against a different clock.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && e.newValue) setPreferenceState(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const deviceZone = useMemo(() => browserTimeZone(), []);

  const value = useMemo(
    () => ({
      preference,
      setPreference,
      deviceZone,
      /** The single zone to render in, or null when following each scale. */
      fixedZone:
        preference === ZONE_PER_SCALE
          ? null
          : preference === ZONE_AUTO
            ? deviceZone
            : preference,
    }),
    [preference, setPreference, deviceZone]
  );

  return <TimeZoneContext.Provider value={value}>{children}</TimeZoneContext.Provider>;
}

export function useTimeZonePreference() {
  const ctx = useContext(TimeZoneContext);
  if (!ctx) {
    // A component rendered outside the provider should degrade to the device
    // zone rather than crash the page it sits on.
    const deviceZone = browserTimeZone();
    return {
      preference: ZONE_AUTO,
      setPreference: () => {},
      deviceZone,
      fixedZone: deviceZone,
    };
  }
  return ctx;
}

/**
 * Collapses a per-scale zone map down to the chosen preference.
 *
 * Returns the map untouched in per-scale mode; otherwise points every UID at
 * the one selected zone, so a caller can keep passing `zones` around without
 * knowing which mode is active.
 */
export function applyZonePreference(zoneMap, fixedZone) {
  if (!fixedZone) return zoneMap;
  const out = {};
  for (const uid of Object.keys(zoneMap || {})) out[uid] = fixedZone;
  return out;
}
