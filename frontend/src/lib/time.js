// Rendering reading timestamps.
//
// WHAT THE DATABASE ACTUALLY HOLDS
//
// The deployed ingest Lambda stores the device's timestamp verbatim:
//
//     'DateTime': date_time      # exactly as sent, e.g. "2025-06-12T14:22:00"
//     'Date':     clean_date     # the part before the "T"
//     'Time':     time_str
//
// So `dateTime` is a *naive wall clock* — no offset, no zone, no instant. It is
// whatever the clock on that kitchen's wall said. Nothing in the pipeline
// converts it, and nothing should: 14:22 in Halifax is what that kitchen
// experienced, and it is what their daily totals and peak-hour figures are
// built from.
//
// (aws/lambdas/ingest/lambda_function.py in this repo is a *different*,
// UTC-normalising implementation that is NOT deployed. Do not assume its
// behaviour — it writes LocalDateTime/SourceTimeZone columns that no live row
// actually has.)
//
// WHY THIS FILE USED TO BE WRONG
//
// It appended "Z" to `dateTime` before parsing, declaring the value to be UTC.
// It never was. Every rendered time was then converted *out of* a zone the
// reading had never been in, shifting the whole UI by the local offset — three
// or four hours for Atlantic Canada.
//
// THE MODEL NOW
//
//   sourceZone   the zone the reading was recorded in — the producing scale's
//                configured `timeZone`. Without it a naive stamp cannot be
//                placed on a timeline at all.
//   displayZone  the zone the viewer wants to read it in.
//
// When the two match, or when sourceZone is unknown, the stored string is shown
// verbatim: no conversion, no drift, no invented precision. Conversion happens
// only when the viewer has genuinely asked for a different zone.

export const COMMON_TIME_ZONES = [
  { value: 'America/St_Johns', label: 'Newfoundland (St. John’s)' },
  { value: 'America/Halifax', label: 'Atlantic (Halifax)' },
  { value: 'America/Toronto', label: 'Eastern (Toronto / Guelph)' },
  { value: 'America/Winnipeg', label: 'Central (Winnipeg)' },
  { value: 'America/Edmonton', label: 'Mountain (Edmonton / Calgary)' },
  { value: 'America/Vancouver', label: 'Pacific (Vancouver)' },
  { value: 'UTC', label: 'UTC' },
];

/** The zone this browser is in — the sensible default for a viewer. */
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Splits "2025-06-12T14:22:00" (or with a space) into numeric parts. */
function naiveParts(dateTime) {
  if (!dateTime) return null;
  const m = String(dateTime)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;

  const p = {
    y: +m[1], mo: +m[2], d: +m[3],
    h: +m[4], mi: +m[5], s: m[6] ? +m[6] : 0,
  };

  // Range-check rather than letting Date.UTC roll over. A corrupt "2025-13-99"
  // would otherwise silently become April 2026 — a wrong date that looks
  // entirely plausible in a table is worse than a dash.
  if (p.mo < 1 || p.mo > 12 || p.d < 1 || p.d > 31) return null;
  if (p.h > 23 || p.mi > 59 || p.s > 59) return null;
  // Catches 31 February and friends.
  const probe = new Date(Date.UTC(p.y, p.mo - 1, p.d));
  if (probe.getUTCMonth() !== p.mo - 1 || probe.getUTCDate() !== p.d) return null;

  return p;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * How far `timeZone` sits from UTC at a given instant, in ms.
 *
 * Derived by asking Intl what wall clock that instant shows in the zone and
 * differencing it against the instant itself, because the platform exposes no
 * direct offset lookup. Doing it per-instant is what keeps DST correct: Halifax
 * is UTC-4 in winter and UTC-3 in summer, so a fixed offset would be wrong for
 * half the year.
 */
function zoneOffsetMs(instantMs, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(new Date(instantMs))
      .reduce((acc, p) => {
        if (p.type !== 'literal') acc[p.type] = p.value;
        return acc;
      }, {});

    const asUTC = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      // Some engines render midnight as "24" under hour12:false.
      +parts.hour % 24,
      +parts.minute,
      +parts.second
    );
    return asUTC - instantMs;
  } catch {
    return 0;   // unknown zone — treat as UTC rather than blanking the cell
  }
}

/**
 * The true instant of a naive wall clock read in `sourceZone`.
 *
 * Returns null when there is no zone to anchor it to — display code must then
 * show the raw string rather than invent an offset.
 *
 * `assumeZone` is the deliberate exception, for callers measuring *elapsed
 * time* rather than printing a clock. "How long since this scale reported"
 * still has to be answerable when a scale has no zone configured; returning
 * null there marked every such scale as "no data" and emptied the status
 * panel. An assumed zone can be off by a few hours, which almost never moves a
 * reading across the 24-hour or 7-day boundary those tiers are testing, and is
 * far more useful than refusing to answer. Never pass it for display.
 *
 * Solved by iteration: guess that the components are UTC, measure the zone's
 * offset at that guess, correct, then measure once more. The second pass
 * settles the case where the first guess landed on the far side of a DST
 * transition from the real instant.
 */
export function readingInstant(dateTime, sourceZone, assumeZone = null) {
  const p = naiveParts(dateTime);
  if (!p) return null;

  const zone = sourceZone || assumeZone;
  if (!zone) return null;

  const asUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  let ms = asUTC - zoneOffsetMs(asUTC, zone);
  ms = asUTC - zoneOffsetMs(ms, zone);
  return new Date(ms);
}

/**
 * Wall-clock components to display, as { date, time }.
 *
 * Shows the stored value untouched unless the viewer has asked for a zone
 * different from the one the reading was recorded in.
 */
export function readingWallClock(dateTime, sourceZone, displayZone) {
  const p = naiveParts(dateTime);
  if (!p) return null;

  const verbatim = {
    date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`,
    time: `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`,
    converted: false,
  };

  if (!sourceZone || !displayZone || sourceZone === displayZone) return verbatim;

  const instant = readingInstant(dateTime, sourceZone);
  if (!instant) return verbatim;

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: displayZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(instant)
      .reduce((acc, x) => {
        if (x.type !== 'literal') acc[x.type] = x.value;
        return acc;
      }, {});
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${String(+parts.hour % 24).padStart(2, '0')}:${parts.minute}:${parts.second}`,
      converted: true,
    };
  } catch {
    return verbatim;
  }
}

/** "2026-08-11" as the viewer should see it. */
export function formatDate(dateTime, sourceZone, displayZone) {
  return readingWallClock(dateTime, sourceZone, displayZone)?.date ?? '—';
}

/** "14:22:05", or "14:22" with withSeconds = false. */
export function formatTime(dateTime, sourceZone, displayZone, withSeconds = true) {
  const wc = readingWallClock(dateTime, sourceZone, displayZone);
  if (!wc) return '—';
  return withSeconds ? wc.time : wc.time.slice(0, 5);
}

/** "2026-08-11 14:22:05". */
export function formatDateTime(dateTime, sourceZone, displayZone) {
  const wc = readingWallClock(dateTime, sourceZone, displayZone);
  return wc ? `${wc.date} ${wc.time}` : '—';
}

/** Short zone label for a column header, e.g. "ADT" or "EDT". */
export function timeZoneAbbr(timeZone, at = new Date()) {
  if (!timeZone) return 'local';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(at);
    return parts.find((p) => p.type === 'timeZoneName')?.value || timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * "just now" / "12 min ago" / "3 days ago".
 *
 * An elapsed duration needs a real instant. When the scale has no zone set,
 * `assumeZone` (normally the viewer's own) keeps this answerable — an age that
 * may be a few hours out still reads far better than "unknown" against every
 * row. Without either it returns "unknown" rather than assuming UTC, which
 * would have reported a scale as hours stale the instant it reported.
 */
export function relativeTime(dateTime, sourceZone, now = Date.now(), assumeZone = null) {
  const d = readingInstant(dateTime, sourceZone, assumeZone);
  if (!d) return 'unknown';

  const secs = Math.round((now - d.getTime()) / 1000);
  if (secs < 60) return 'just now';          // negative = clock skew, not the future
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Builds uid -> IANA zone from the scale list: where each reading was recorded.
 *
 * Scales with no zone configured map to `fallback`. Passing null as the
 * fallback is meaningful — it marks the source zone as genuinely unknown, so
 * timestamps render verbatim instead of being converted on a guess.
 */
export function buildZoneMap(scales, fallback) {
  const map = {};
  (scales || []).forEach((s) => {
    const id = s.scaleId || s.id;
    if (id) map[id] = s.timeZone || fallback;
  });
  return map;
}
