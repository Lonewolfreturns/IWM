import { useEffect, useMemo, useState } from 'react';
import { Clock3, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { getReadings } from '../../services/readings';
import { COMMON_TIME_ZONES, FLEET_TIME_ZONE, readingInstant } from '../../lib/time.js';

/**
 * Infers what clock a scale is actually keeping, from its own readings.
 *
 * Nobody can tell you a device's clock offset reliably — the person who
 * installed it has moved on, the label says where the kitchen is rather than
 * what the firmware was set to, and a unit that ignores daylight saving looks
 * correct for half the year. Asking the data avoids all of that.
 *
 * The signal is the daily rhythm. A kitchen scale is busy across service
 * periods and idle overnight, so the hour-of-day distribution of its deposits
 * is a fingerprint of the clock it is stamping with. If deposits peak at 04:00
 * by the device's own stamps, the device is not telling local time — and the
 * size of the shift is the offset.
 *
 * Deliberately advisory. It reports what it sees and suggests a zone; a person
 * still chooses. A genuine 24-hour operation, or a scale with barely any
 * traffic, will not produce a usable pattern and is told so rather than being
 * given a confident wrong answer.
 */

// Readings within this of zero are sensor noise, not deposits. Matches
// NOISE_FLOOR_KG in the readings Lambda.
const NOISE_FLOOR_KG = 0.05;

// A day's activity is summarised by its circular mean hour. Canadian kitchen
// service runs roughly 07:00-20:00, so a device telling local time lands near
// the middle of that.
const EXPECTED_CENTRE_HOUR = 13;

// Below this, the pattern is noise and no verdict is offered.
const MIN_DEPOSITS = 30;

// ---------------------------------------------------------------------------
// The verdict leans on overnight activity, not on the centre of the day.
//
// The centre alone produces false positives, and a diagnostic that cries wolf
// is worse than none — it sends someone off to "fix" a clock that was right.
// Measured against the real fleet, centre-only flagged DAL00002 as 2.3 h out
// when it has *zero* deposits between 01:00 and 05:00, and STRATH01 as 1.7 h
// out on 5%. Both are simply kitchens whose service is weighted late or early.
//
// What no kitchen does is throw food away at 3am. Deposits landing in the small
// hours are the reliable evidence that the stamps are not local time, and that
// holds whether the site is breakfast-heavy or dinner-heavy. The centre is then
// used only to say which way and how far.
// ---------------------------------------------------------------------------
const OVERNIGHT_OK = 0.08;      // at or below: the kitchen is shut at night
const OVERNIGHT_SUSPECT = 0.15; // at or above: the clock is almost certainly out

// Service patterns genuinely vary by a couple of hours either side, so the
// centre has to be well clear of that before it is quoted as a shift.
const TOLERANCE_HOURS = 3;

const DAYS = 90;

function circularMeanHour(hours) {
  let x = 0;
  let y = 0;
  hours.forEach((count, hour) => {
    const angle = (2 * Math.PI * hour) / 24;
    x += Math.cos(angle) * count;
    y += Math.sin(angle) * count;
  });
  if (x === 0 && y === 0) return null;
  return (((Math.atan2(y, x) * 12) / Math.PI) + 24) % 24;
}

/** Signed hours to add to the device clock to reach local kitchen time. */
function shortestShift(from, to) {
  let diff = to - from;
  while (diff > 12) diff -= 24;
  while (diff < -12) diff += 24;
  return diff;
}

/**
 * The zone whose current offset is `shiftHours` away from the fleet clock.
 *
 * Offered as a fixed-offset zone rather than a named one because the whole
 * reason a device drifts from its label is that it does not follow daylight
 * saving; suggesting a DST-observing zone would re-introduce the same bug in
 * six months.
 */
function suggestZone(currentZone, shiftHours) {
  const base = offsetHoursOf(currentZone || FLEET_TIME_ZONE);
  if (base == null) return null;
  const target = Math.round(base + shiftHours);
  if (target > 0 || target < -12) return null;
  const value = target === 0 ? 'UTC' : `Etc/GMT+${Math.abs(target)}`;
  return COMMON_TIME_ZONES.find((z) => z.value === value) || null;
}

/** A zone's current UTC offset in hours, or null if it cannot be read. */
function offsetHoursOf(zone) {
  try {
    const label = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    }).format(new Date());
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(label);
    if (!match) return 0; // GMT with no suffix means UTC
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) + Number(match[3]) / 60);
  } catch {
    return null;
  }
}

const BLOCKS = ['bg-ink-700', 'bg-sky/30', 'bg-sky/55', 'bg-sky/80', 'bg-sky'];

export default function ClockCheck({ uid, currentZone }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    if (!uid) return undefined;

    getReadings({ uid, days: DAYS })
      .then((data) => alive && setRows(data || []))
      .catch((err) =>
        alive &&
        setError(err?.response?.data?.message || 'Could not load this scale’s readings')
      );
    return () => {
      alive = false;
    };
  }, [uid]);

  const result = useMemo(() => {
    if (!rows) return null;

    // The device's own stamp is what is being assessed, so the hour is read
    // straight off the string. Converting it first would fold in the very
    // assumption under test.
    const hours = new Array(24).fill(0);
    let deposits = 0;
    rows.forEach((r) => {
      if (!(r.perDepositWeight > NOISE_FLOOR_KG)) return;
      const raw = r.dateTime || `${r.date}T${r.time}`;
      const match = /[T ](\d{2}):/.exec(String(raw));
      if (!match) return;
      hours[Number(match[1]) % 24] += 1;
      deposits += 1;
    });

    if (deposits < MIN_DEPOSITS) {
      return { hours, deposits, verdict: 'insufficient' };
    }

    const centre = circularMeanHour(hours);
    const busiest = hours.indexOf(Math.max(...hours));
    const overnight = (hours[1] + hours[2] + hours[3] + hours[4]) / deposits;
    const shift = shortestShift(centre, EXPECTED_CENTRE_HOUR);

    let verdict;
    if (overnight <= OVERNIGHT_OK) {
      // Nothing at 3am: whatever the service pattern, this clock is telling
      // something close enough to local time.
      verdict = 'plausible';
    } else if (overnight >= OVERNIGHT_SUSPECT) {
      verdict = 'offset';
    } else {
      // Enough night-time activity to raise an eyebrow, not enough to accuse.
      verdict = 'uncertain';
    }

    return {
      hours,
      deposits,
      centre,
      busiest,
      overnight,
      shift,
      verdict,
      // Only offered when the shift is big enough to name a different zone.
      suggestion:
        verdict === 'offset' && Math.abs(shift) > TOLERANCE_HOURS
          ? suggestZone(currentZone, shift)
          : null,
    };
  }, [rows, currentZone]);

  if (error) {
    return <p className="text-[11px] text-amber">{error}</p>;
  }
  if (!rows) {
    return (
      <p className="text-[11px] text-slate-500 inline-flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" />
        Checking this scale’s clock against its own activity…
      </p>
    );
  }

  const peak = Math.max(...result.hours, 1);

  return (
    <div className="space-y-2" data-testid="clock-check">
      <div className="flex items-end gap-[2px] h-10" title="Deposits by hour, on the device’s own clock">
        {result.hours.map((count, hour) => (
          <div
            key={hour}
            className={`flex-1 rounded-sm ${BLOCKS[Math.min(4, Math.ceil((count / peak) * 4))]}`}
            style={{ height: `${Math.max(8, (count / peak) * 100)}%` }}
            title={`${String(hour).padStart(2, '0')}:00 — ${count} deposit${count === 1 ? '' : 's'}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-slate-600 -mt-1">
        <span>00:00</span>
        <span>12:00</span>
        <span>23:00</span>
      </div>

      {result.verdict === 'insufficient' && (
        <p className="text-[11px] text-slate-500">
          Only {result.deposits} real deposit{result.deposits === 1 ? '' : 's'} in the
          last {DAYS} days — not enough of a daily pattern to judge the clock from.
          Set it from what the device was configured with.
        </p>
      )}

      {result.verdict === 'plausible' && (
        <p className="text-[11px] text-leaf inline-flex items-start gap-1.5">
          <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            Looks right. Busiest at{' '}
            {String(result.busiest).padStart(2, '0')}:00 with{' '}
            {Math.round(result.overnight * 100)}% of deposits overnight — a normal
            kitchen day on this clock.
          </span>
        </p>
      )}

      {result.verdict === 'uncertain' && (
        <p className="text-[11px] text-slate-400 inline-flex items-start gap-1.5">
          <Clock3 className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            Unclear. {Math.round(result.overnight * 100)}% of deposits land between
            01:00 and 05:00 — more than a closed kitchen should have, but not
            enough to call the clock wrong. Worth checking against the site's
            actual opening hours.
          </span>
        </p>
      )}

      {result.verdict === 'offset' && (
        <div className="text-[11px] text-amber space-y-1">
          <p className="inline-flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              <strong>{Math.round(result.overnight * 100)}% of deposits land
              between 01:00 and 05:00</strong>, when a kitchen is shut — so these
              stamps are almost certainly not local time. Busiest hour reads{' '}
              {String(result.busiest).padStart(2, '0')}:00, which puts the clock
              roughly {Math.abs(result.shift).toFixed(1)} h{' '}
              {result.shift > 0 ? 'behind' : 'ahead'}.
            </span>
          </p>
          {result.suggestion && (
            <p className="text-slate-400 inline-flex items-start gap-1.5">
              <Clock3 className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                Try <strong className="text-slate-200">{result.suggestion.label}</strong>{' '}
                above, then re-open this dialog to re-check.
              </span>
            </p>
          )}
        </div>
      )}

      <p className="text-[10px] text-slate-600">
        Based on {result.deposits} deposit{result.deposits === 1 ? '' : 's'} over the
        last {DAYS} days, read on the device’s own stamps.
      </p>
    </div>
  );
}
