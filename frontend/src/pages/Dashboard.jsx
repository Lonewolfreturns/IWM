import { useEffect, useMemo, useRef, useState } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import {
  Trash2, CalendarDays, Activity, MapPin, AlertTriangle, Radio, ArrowDown,
  ChevronDown, WifiOff, PowerOff, TrendingDown, Gauge, HelpCircle,
} from 'lucide-react';
import StatCard from '../components/common/StatCard.jsx';
import ChartCard from '../components/common/ChartCard.jsx';
import Badge from '../components/common/Badge.jsx';
import ReadingsTable from '../components/common/ReadingsTable.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import { getScales } from '../services/scales';
import { getReadings, getLiveReadings } from '../services/readings';
import { getDashboardStats, getRecentAlerts } from '../services/dashboard';
import {
  buildZoneMap, formatTime, timeZoneAbbr, relativeTime, readingInstant,
  FLEET_TIME_ZONE, FLEET_TIME_ZONE_LABEL,
} from '../lib/time.js';
import { useTimeZonePreference } from '../lib/timeZonePreference.jsx';
import { readDashboardCache, writeDashboardCache } from '../lib/dashboardCache.js';
import {
  deriveScaleStatuses, latestByUid, ONLINE_WINDOW_MS, IDLE_WINDOW_MS,
} from '../lib/scaleStatus.js';

// How often the live ticker re-queries the ±60s window.
const LIVE_POLL_MS = 15000;
// How often the rest of the dashboard re-queries (stats, alerts, readings, scales).
const REFRESH_MS = 15000;

// How far back a refresh re-reads the readings table.
//
// Refreshes used to ask "everything newer than the newest row I already hold",
// which is only sound if every device shares a clock. DateTime is each device's
// own naive wall clock, so one global cursor set by the scale running furthest
// ahead silently excluded every scale behind it: a device an hour back went
// unseen for an hour, and one in another province for most of a day.
//
// A fixed window has no such coupling. Two days comfortably exceeds any
// plausible clock spread, the merge below already de-duplicates the overlap,
// and it costs a bounded read rather than a growing one.
const REFRESH_LOOKBACK_DAYS = 2;
// Cap on rows held in the table, so a long-running session doesn't grow forever.
const MAX_TABLE_ROWS = 2000;

/* --------------------------- Live activity --------------------------- */

// Deposits are bucketed into 2-hour slots across the window, so each scale
// carries a small strip showing WHEN it was busy rather than only how much.
const STRIP_BUCKETS = 12;
const BUCKET_MS = ONLINE_WINDOW_MS / STRIP_BUCKETS;

// How recently a scale reported, as a colour. Silence is not a fault — a scale
// only reports when something is thrown away — so the quiet end is muted grey
// rather than red, which reads as broken.
function freshness(ageMs) {
  if (ageMs <= 60 * 60 * 1000) return { dot: 'bg-leaf shadow-[0_0_8px_#22C55E]', text: 'text-leaf' };
  if (ageMs <= 6 * 60 * 60 * 1000) return { dot: 'bg-sky', text: 'text-sky' };
  return { dot: 'bg-slate-500', text: 'text-slate-400' };
}

/**
 * Scales that have reported in the last 24 hours, one card each.
 *
 * Cards rather than the bar chart this started as. The bars encoded
 * RunningTotalWeight as a fill, which invited the reading "this bin is nearly
 * full" — a meaning it never had, since it is a tare-relative counter that goes
 * negative. Nothing here is drawn as a proportion of anything.
 *
 * The one thing worth drawing is *when* a scale was busy, so each card carries
 * a 2-hourly strip of its own deposits across the window. That is a real time
 * axis rather than a disguised magnitude.
 */
function LiveActivity({ readings, isLive, loading, zones, displayZone }) {
  // Source zone = where the reading was recorded; display zone = what the
  // viewer picked. Equal (or unknown) means the stored value is shown as-is.
  const sourceOf = (uid) => zones?.[uid] || null;
  const shownIn = (uid) => displayZone || sourceOf(uid);

  // Scales that reported in the last 24 hours, newest first.
  //
  // Fed from the live feed AND the week of history together, on purpose. This
  // panel used to read only /readings/live, which returns one of two very
  // different things: the rows inside its narrow band when any match, and
  // every device's last-known rows when none do. Once the band started
  // matching, a minute in which one scale reported made the panel show that
  // one scale — while Quick Scale Status, reading the full history, still
  // showed seven. Both now derive from the same rows, so they cannot disagree.
  const { recent, hiddenCount } = useMemo(() => {
    const now = Date.now();
    const map = new Map();

    readings.forEach((r) => {
      // A UID with no scale record is absent from the zone map entirely, so it
      // falls back to the fleet clock the same way a record without its own
      // `timeZone` does.
      const zone = zones?.[r.uid] || FLEET_TIME_ZONE;
      const at = r.dateTime ? readingInstant(r.dateTime, zone) : null;
      const age = at ? now - at.getTime() : null;
      if (age == null) return;

      if (!map.has(r.uid)) {
        // Rows arrive newest-first from both feeds, so the first sighting of a
        // UID is its latest reading.
        map.set(r.uid, {
          uid: r.uid,
          runningTotal: r.runningTotalWeight ?? 0,
          lastReading: r.perDepositWeight ?? 0,
          lastAt: r.dateTime ?? '',
          ageMs: age,
          deposited: 0,
          deposits: 0,
          strip: new Array(STRIP_BUCKETS).fill(0),
        });
      }
      // Only deposits inside the window count towards the window's totals —
      // summing the whole seven days under a "last 24 h" heading would be a
      // different number wearing the same label.
      if (r.perDepositWeight > 0 && age >= 0 && age <= ONLINE_WINDOW_MS) {
        const s = map.get(r.uid);
        s.deposited += r.perDepositWeight;
        s.deposits += 1;
        // Oldest bucket on the left, so the strip reads left-to-right as time.
        // Clamped at both ends: a reading landing exactly on the 24h boundary
        // divides to STRIP_BUCKETS and would index -1, which counted towards
        // the totals but vanished from the strip.
        const slot = Math.max(
          0,
          Math.min(STRIP_BUCKETS - 1, STRIP_BUCKETS - 1 - Math.floor(age / BUCKET_MS))
        );
        s.strip[slot] += r.perDepositWeight;
      }
    });

    const all = [...map.values()];
    // Most recently heard from first. This is a *live* panel: the thing that
    // just reported is what you want at the top.
    const fresh = all
      .filter((s) => s.ageMs <= ONLINE_WINDOW_MS)
      .sort((a, b) => a.ageMs - b.ageMs);

    return { recent: fresh, hiddenCount: all.length - fresh.length };
  }, [readings, zones]);

  const totalDeposited = recent.reduce((sum, s) => sum + s.deposited, 0);
  const totalDeposits = recent.reduce((sum, s) => sum + s.deposits, 0);

  return (
    <ChartCard
      testId="live-waste-stream"
      title="Live Activity"
      subtitle="Scales that have reported in the last 24 hours"
      action={
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold uppercase tracking-wider ${
            isLive
              ? 'bg-leaf/15 text-leaf border-leaf/30'
              : 'bg-ink-700/70 text-slate-400 border-ink-600'
          }`}
        >
          <Radio className={`w-3 h-3 ${isLive ? 'animate-pulse' : ''}`} />
          {isLive ? 'Live' : 'Idle'}
        </span>
      }
    >
      {loading ? (
        <div className="px-3 py-6 text-sm text-slate-400">Loading…</div>
      ) : recent.length === 0 ? (
        <EmptyState
          testId="live-stream-empty"
          title="No recent activity"
          description={
            hiddenCount > 0
              ? `No scale has reported in the last 24 hours. ${hiddenCount} quieter ${
                  hiddenCount === 1 ? 'scale is' : 'scales are'
                } listed under Quick Scale Status below.`
              : 'Once your scales start reporting, activity will show up here.'
          }
        />
      ) : (
        <div className="px-3">
          {/* Window summary */}
          <div className="flex items-center gap-6 flex-wrap pb-4 mb-4 border-b border-ink-600/40">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                Reporting scales
              </div>
              <div className="font-display font-bold text-2xl text-white tabular-nums">
                {recent.length}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                Deposited in last 24 h
              </div>
              <div className="font-display font-bold text-2xl text-leaf tabular-nums">
                {totalDeposited.toFixed(2)}{' '}
                <span className="text-sm text-slate-400 font-medium">kg</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                Deposits
              </div>
              <div className="font-display font-bold text-2xl text-white tabular-nums">
                {totalDeposits}
              </div>
            </div>
          </div>

          <div className="max-h-[26rem] overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 pr-1">
            {recent.map((s) => {
              const tone = freshness(s.ageMs);
              const peak = Math.max(...s.strip, 0);
              return (
                <div
                  key={s.uid}
                  data-testid={`live-scale-${s.uid}`}
                  className="rounded-xl border border-ink-600 bg-ink-800/50 p-3.5 hover:border-sky/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <span className={`shrink-0 w-2 h-2 rounded-full ${tone.dot}`} />
                      <span className="text-xs font-mono text-slate-200 truncate">
                        {s.uid}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-[10px] tabular-nums ${tone.text}`}
                      title={
                        shownIn(s.uid)
                          ? `${formatTime(s.lastAt, sourceOf(s.uid), displayZone, false)} · ${timeZoneAbbr(shownIn(s.uid))}`
                          : 'Scale has no time zone set — shown as recorded'
                      }
                    >
                      {relativeTime(s.lastAt, sourceOf(s.uid) || FLEET_TIME_ZONE)}
                    </span>
                  </div>

                  <div className="flex items-end justify-between gap-2">
                    <div className="min-w-0">
                      <div
                        className={`font-display font-bold text-xl tabular-nums leading-none ${
                          s.lastReading > 0 ? 'text-leaf' : 'text-slate-400'
                        }`}
                      >
                        {s.lastReading > 0 ? '+' : ''}
                        {s.lastReading.toFixed(2)}
                        <span className="text-xs text-slate-500 font-medium ml-1">kg</span>
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">
                        Last deposit
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-slate-200 tabular-nums leading-none">
                        {s.deposited.toFixed(2)}
                        <span className="text-[10px] text-slate-500 font-medium ml-0.5">kg</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        {s.deposits} in 24 h
                      </div>
                    </div>
                  </div>

                  {/* When this scale was busy, oldest slot on the left. Height
                      is relative to this scale's own peak, so a quiet unit is
                      still readable rather than a flat line beside a busy one. */}
                  <div className="flex items-end gap-[2px] h-6 mt-3" aria-hidden>
                    {s.strip.map((kg, i) => (
                      <div
                        key={i}
                        className={`flex-1 rounded-[2px] ${kg > 0 ? 'bg-sky/70' : 'bg-ink-700'}`}
                        style={{ height: peak > 0 && kg > 0 ? `${Math.max(18, (kg / peak) * 100)}%` : '10%' }}
                        title={`${(STRIP_BUCKETS - i) * 2}-${(STRIP_BUCKETS - i - 1) * 2} h ago — ${kg.toFixed(2)} kg`}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between text-[9px] text-slate-600 mt-1">
                    <span>24 h ago</span>
                    <span
                      className="text-slate-500"
                      title="RunningTotalWeight as the device reports it — a counter since the last tare, not how full the bin is."
                    >
                      {s.runningTotal.toFixed(2)} kg since tare
                    </span>
                    <span>now</span>
                  </div>
                </div>
              );
            })}
          </div>

          {hiddenCount > 0 && (
            <p className="pt-3 text-[11px] text-slate-500">
              {hiddenCount} {hiddenCount === 1 ? 'scale has' : 'scales have'} not
              reported in 24 h — see Quick Scale Status below.
            </p>
          )}
        </div>
      )}
    </ChartCard>
  );
}

/* -------------------------------- Alerts -------------------------------- */

// One icon per rule, so the kind of problem is legible before the text is read.
const ALERT_ICONS = {
  offline: PowerOff,
  silent: Radio,
  'wifi-flapping': WifiOff,
  'reboot-loop': PowerOff,
  drift: TrendingDown,
  'single-drop': TrendingDown,
  flatline: Gauge,
};

const SEVERITY_STYLES = {
  danger: { text: 'text-red-400', ring: 'bg-red-500/15', badge: 'danger' },
  warning: { text: 'text-amber', ring: 'bg-amber/15', badge: 'warning' },
  info: { text: 'text-sky', ring: 'bg-sky/15', badge: 'info' },
};

/**
 * An alert row used to be four columns of which only one carried information,
 * and that one read "5 consecutive readings below -10 kg" — a measurement with
 * no indication of whether it mattered or what to do about it.
 *
 * The API now returns `detail`, `meaning` and `action` as separate fields. The
 * headline and the measurement are always visible; the explanation and the
 * remedy sit one click away, so the panel stays scannable but nothing needs
 * looking up elsewhere.
 */
function AlertRow({ alert }) {
  const [open, setOpen] = useState(false);
  const sev = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.info;
  const Icon = ALERT_ICONS[alert.reason] || AlertTriangle;
  // Older deployments return only `type`; there is nothing to expand for those.
  const expandable = Boolean(alert.meaning || alert.action || alert.alsoFlagged?.length);

  return (
    <li className="border-t border-ink-600/40 first:border-t-0" data-testid={`alert-${alert.id}`}>
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        className={`w-full text-left px-3 py-3 flex items-start gap-3 transition-colors ${
          expandable ? 'hover:bg-ink-700/30 cursor-pointer' : 'cursor-default'
        }`}
      >
        <span className={`shrink-0 mt-0.5 w-7 h-7 rounded-lg grid place-items-center ${sev.ring} ${sev.text}`}>
          <Icon className="w-4 h-4" />
        </span>

        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">
              {alert.title || alert.type}
            </span>
            <Badge label={alert.scale} variant="neutral" />
          </span>
          {alert.detail && (
            <span className="block text-xs text-slate-400 mt-1 leading-relaxed">
              {alert.detail}
            </span>
          )}
          {!alert.detail && (
            <span className="block text-xs text-slate-500 mt-1">{alert.timestamp}</span>
          )}
        </span>

        {expandable && (
          <ChevronDown
            className={`shrink-0 w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {open && (
        <div className="px-3 pb-3.5 pl-[3.25rem] space-y-2.5">
          {alert.meaning && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                What this usually means
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{alert.meaning}</p>
            </div>
          )}
          {alert.action && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                What to do
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{alert.action}</p>
            </div>
          )}
          {alert.alsoFlagged?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                Also flagged on this scale
              </div>
              <div className="flex flex-wrap gap-1.5">
                {alert.alsoFlagged.map((f) => (
                  <Badge
                    key={f.reason}
                    label={f.occurrences > 1 ? `${f.title} (${f.occurrences}x)` : f.title}
                    variant={SEVERITY_STYLES[f.severity]?.badge || 'neutral'}
                  />
                ))}
              </div>
            </div>
          )}
          {alert.noiseFloorKg != null && (
            <p className="text-[11px] text-slate-500 leading-relaxed flex items-start gap-1.5">
              <HelpCircle className="w-3 h-3 mt-0.5 shrink-0" />
              Readings within {Math.round(alert.noiseFloorKg * 1000)} g of zero are treated
              as sensor noise and ignored by this check.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/* -------------------------------- Page --------------------------------- */

export default function Dashboard() {
  // Seeded from the cache so navigating back to this page paints instantly with
  // the last known data instead of resetting to empty tables and spinners. The
  // refresh below still runs; it just updates a populated page rather than
  // filling a blank one.
  const cached = readDashboardCache();

  const [scales, setScales] = useState(cached.scales);
  const [readings, setReadings] = useState(cached.readings); // last 7 days, for the table
  const [live, setLive] = useState(cached.live);             // now ±60s, for the ticker
  const [stats, setStats] = useState(cached.stats);
  const [alerts, setAlerts] = useState(cached.alerts);
  const [liveLoading, setLiveLoading] = useState(cached.live.length === 0);
  const [lastUpdated, setLastUpdated] = useState(cached.lastUpdated);
  // True while a refresh is in flight over data that is already on screen, so
  // the page can say "updating" rather than either lying about its freshness or
  // blanking panels that hold perfectly good rows.
  const [refreshing, setRefreshing] = useState(false);
  // Whether the full history window has been fetched yet. The first load pulls
  // the whole week; refreshes only re-read the recent window.
  const loadedFullWindow = useRef(cached.readings.length > 0);

  // Two refresh cadences, because the queries cost very different amounts.
  //
  //   Live ticker (15s)  — a narrow ±60s window, cheap to re-run often.
  //   Everything else (60s) — stats, alerts, the week of readings and the
  //     scale list. Each of these re-queries a 7-day window per device, so
  //     running them at the ticker's rate would be wasteful for data that
  //     barely moves minute to minute.
  //
  // Both pause while the tab is hidden and refresh immediately on return, so
  // a backgrounded dashboard doesn't burn requests and a returning one is
  // never showing stale numbers.
  useEffect(() => {
    let mounted = true;
    let slowId;
    let fastId;

    // `force` bypasses the hidden-tab check. The very first load always runs —
    // otherwise opening the dashboard in a background tab leaves it blank until
    // it's focused. Only the recurring polls skip while hidden.
    // Each request updates its own panel the moment it lands, rather than four
    // of them waiting on a single allSettled. The readings query walks a 7-day
    // window per device and is by far the slowest of the four — gating the
    // stats tiles and the alerts list behind it meant the whole page appeared
    // at the speed of its slowest part for no reason.
    const pullSlow = (force = false) => {
      if (document.hidden && !force) return;
      setRefreshing(true);

      // The first load takes the full week; every refresh after it re-reads
      // only the recent window. See REFRESH_LOOKBACK_DAYS.
      const readingsCall = loadedFullWindow.current
        ? getReadings({ days: REFRESH_LOOKBACK_DAYS })
        : getReadings();

      // Only replace on success — a transient failure shouldn't blank a panel
      // that already holds good data, so every rejection is swallowed here and
      // the previous value stays on screen.
      const apply = (promise, onValue) =>
        promise
          .then((value) => {
            if (mounted) onValue(value);
          })
          .catch(() => {});

      const jobs = [
        apply(getScales(), (v) => {
          setScales(v);
          writeDashboardCache({ scales: v });
        }),
        apply(getDashboardStats(), (v) => {
          setStats(v);
          writeDashboardCache({ stats: v });
        }),
        apply(getRecentAlerts(), (v) => {
          setAlerts(v);
          writeDashboardCache({ alerts: v });
        }),
        apply(readingsCall, (value) => {
          const incoming = value || [];
          const wasFirst = !loadedFullWindow.current;
          loadedFullWindow.current = true;

          setReadings((prev) => {
            // Merge newest-first, de-duplicating on UID + timestamp. Every
            // refresh overlaps what is already held, so the dedupe is what
            // makes a repeated window cheap rather than duplicative.
            const merged = wasFirst ? incoming : [...incoming, ...prev];
            const seen = new Set();
            const unique = [];
            for (const r of merged) {
              const key = `${r.uid}|${r.dateTime}`;
              if (seen.has(key)) continue;
              seen.add(key);
              unique.push(r);
            }
            unique.sort((a, b) => (a.dateTime < b.dateTime ? 1 : -1));
            const next = unique.slice(0, MAX_TABLE_ROWS);
            writeDashboardCache({ readings: next });
            return next;
          });
        }),
      ];

      Promise.allSettled(jobs).then(() => {
        if (!mounted) return;
        const at = new Date();
        setRefreshing(false);
        setLastUpdated(at);
        writeDashboardCache({ lastUpdated: at, hydrated: true });
      });
    };

    const pullLive = (force = false) => {
      if (document.hidden && !force) return;
      getLiveReadings()
        .then((data) => {
          if (!mounted) return;
          setLive(data);
          writeDashboardCache({ live: data });
        })
        .catch(() => {})
        .finally(() => mounted && setLiveLoading(false));
    };

    // Initial load and return-to-tab both force, so the dashboard is never
    // left blank waiting for the next interval.
    const refreshAll = () => {
      pullSlow(true);
      pullLive(true);
    };

    refreshAll();
    slowId = setInterval(pullSlow, REFRESH_MS);
    fastId = setInterval(pullLive, LIVE_POLL_MS);

    const onVisible = () => {
      if (!document.hidden) refreshAll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      mounted = false;
      clearInterval(slowId);
      clearInterval(fastId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Readings are stored as the producing device's own wall clock, so each
  // scale's configured zone is what anchors its rows to a real instant. A fleet
  // spread across provinces can't share one clock: Halifax is Atlantic and
  // Guelph is Eastern.
  //
  // The fallback is null, not the browser's zone: a scale with no zone set has
  // an genuinely unknown source, and guessing the viewer's zone would silently
  // shift its timestamps by however far apart the two happen to be.
  const zones = useMemo(() => buildZoneMap(scales, FLEET_TIME_ZONE), [scales]);

  // The live feed in front of the week of history, newest-first. Quick Scale
  // Status already merges these two; Live Activity now reads the same list, so
  // the two panels cannot report different counts for the same window.
  const liveAndHistory = useMemo(() => [...live, ...readings], [live, readings]);

  // The API marks rows false when nothing landed in the +/-60s band and it fell
  // back to last-known data, so the badge never claims to be live when it is
  // not. Read from the live feed alone — history is by definition not live.
  const liveIsFresh = live.length > 0 && live[0]?.isLive !== false;
  const { fixedZone: displayZone } = useTimeZonePreference();

  // `lastReading`, `lastActive` and `status` are stored on the scale record but
  // nothing ever writes to them, so they'd read 0 kg / blank forever. Derive
  // them from the telemetry we already have instead: a scale is "online" if it
  // has actually reported recently, not because a field says so.
  // Derived from telemetry, not from the stored `status` field — see
  // lib/scaleStatus.js. Shared with Scale Management so the two pages cannot
  // report different counts for the same fleet.
  const scaleStatuses = useMemo(
    () => deriveScaleStatuses(scales, latestByUid(live, readings)),
    [scales, readings, live]
  );

  const totalActive = scaleStatuses.filter((s) => s.state === 'online').length;

  // This tile now scrolls to Quick Scale Status, so it has to count the same
  // way that panel does — a tile reading 5/10 that jumps to a list where a
  // different number are lit is worse than not linking them at all. Both use
  // `scaleStatuses`: reported inside 24h over scales assigned to the account.
  // The API's own figures stay as the fallback for when no scale records have
  // loaded, since it anchors "active" to the newest reading date rather than
  // to real elapsed time and the two can disagree when ingestion lags.
  const haveScaleList = scaleStatuses.length > 0;
  const activeScales = haveScaleList ? totalActive : stats?.activeScales ?? 0;
  const totalScales = haveScaleList
    ? scaleStatuses.length
    : stats?.totalScales ?? scales.length;
  const sparklineData = stats?.sparkline ?? [];

  // The trend tile used to show `weeklyChangePct`, and it was not salvageable.
  // The stats endpoint reads a 7-day window but computes the comparison from
  // days 7-13, which are outside it — so "last week" is normally 0 and the
  // percentage is 0. When the window is empty the API falls back to each
  // device's latest rows regardless of age, those stray old rows land in the
  // last-week buckets, and the ratio explodes: that is where a 760% "increase"
  // came from. A percentage against a near-zero, arbitrarily-populated
  // denominator is noise however it is rendered.
  //
  // So the tile now shows the thing that is actually well-defined: total kg
  // over the last 7 days. `thisWeekTotal` comes from the API where it is
  // available; otherwise it is summed from `sparkline`, which is exactly those
  // seven daily totals, so this is correct against the currently deployed
  // Lambda too. The comparison badge renders only when the API returns a real
  // `lastWeekTotal` — no denominator, no claim.
  const thisWeekTotal =
    stats?.thisWeekTotal ?? sparklineData.reduce((sum, d) => sum + (d.v ?? 0), 0);
  const lastWeekTotal = stats?.lastWeekTotal ?? null;
  const weekDelta =
    lastWeekTotal != null && lastWeekTotal > 0 ? thisWeekTotal - lastWeekTotal : null;

  // Clicking the Active Scales tile jumps to the panel that names the scales
  // behind the count, since the tile itself can only show the ratio.
  const scaleStatusRef = useRef(null);
  const [highlightScales, setHighlightScales] = useState(false);
  const showScaleStatus = () => {
    scaleStatusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // A brief ring, so it is obvious which panel the page just jumped to.
    setHighlightScales(true);
    setTimeout(() => setHighlightScales(false), 1800);
  };

  return (
    <div className="space-y-6 lg:space-y-8" data-testid="dashboard-page">
      {/* Heading */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-sky font-semibold mb-2">
            <MapPin className="inline w-3.5 h-3.5 mr-1" /> Canada
            <span className="ml-1" aria-hidden>🍁</span>
          </div>
          <h2 className="font-display font-bold text-2xl sm:text-3xl text-white">
            Welcome back — here's your kitchen's pulse today
          </h2>
          {scales.length === 0 && (
            <p className="text-sm text-slate-400 mt-1">No scales connected yet.</p>
          )}
        </div>

        {(lastUpdated || refreshing) && (
          <div
            className="inline-flex items-center gap-2 px-3 h-9 rounded-xl border border-ink-600 bg-ink-800/60 text-[11px] text-slate-400"
            data-testid="dashboard-last-updated"
            title="The dashboard refreshes on its own; no need to reload"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                refreshing ? 'bg-sky' : 'bg-leaf'
              }`}
            />
            {/* Says which of the two states it is in, because "updated 12:04"
                sitting over figures that are actively being replaced reads as
                a stale page rather than a live one. */}
            {refreshing ? (
              lastUpdated ? 'Updating…' : 'Loading…'
            ) : (
              <>
                Auto-refreshing · updated{' '}
                {lastUpdated.toLocaleTimeString('en-CA', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false,
                })}
              </>
            )}
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
        <StatCard
          testId="stat-total-waste"
          title="Total Waste Today"
          value={stats?.totalWasteToday ?? 0}
          suffix="kg"
          icon={Trash2}
          color="green"
        />

        <StatCard
          testId="stat-weekly-trend"
          title="Waste This Week"
          value={thisWeekTotal}
          suffix="kg"
          format="one"
          hint="Total collected over the last 7 days"
          change={
            weekDelta == null
              ? null
              : `${weekDelta >= 0 ? '+' : '\u2212'}${Math.abs(weekDelta).toFixed(1)} kg`
          }
          changeType={weekDelta == null ? 'neutral' : weekDelta <= 0 ? 'down' : 'up'}
          changeLabel={weekDelta == null ? undefined : 'vs last week'}
          icon={CalendarDays}
          color="sky"
        >
          {sparklineData.length > 0 && (
            <div className="h-10 -mx-1" title="Daily totals, oldest to newest">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparklineData}>
                  <defs>
                    <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.7} />
                      <stop offset="100%" stopColor="#38BDF8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke="#38BDF8" strokeWidth={2} fill="url(#sparkGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </StatCard>

        <StatCard
          testId="stat-active-scales"
          title="Active Scales"
          value={`${activeScales}/${totalScales}`}
          hint={`${activeScales} of your ${totalScales} scales reported in the last 24 h`}
          icon={Activity}
          color="amber"
          onClick={showScaleStatus}
        >
          {totalScales > 0 && (
            <div className="mt-1 space-y-2">
              {/* One dot per scale in the fleet. Quiet is not broken — a scale
                  only reports when something is thrown away — so the unlit
                  dots are muted rather than red, which read as a fault. */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {Array.from({ length: totalScales }).map((_, i) => (
                  <span
                    key={i}
                    title={i < activeScales ? 'Reported in the last 24 h' : 'No reading in the last 24 h'}
                    className={`w-2 h-2 rounded-full ${
                      i < activeScales ? 'bg-leaf shadow-[0_0_6px_#22C55E]' : 'bg-ink-600'
                    }`}
                  />
                ))}
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sky">
                <ArrowDown className="w-3 h-3" />
                See which scales
              </span>
            </div>
          )}
        </StatCard>
      </div>

      {/* Recent activity */}
      <LiveActivity
        readings={liveAndHistory}
        isLive={liveIsFresh}
        loading={liveLoading}
        zones={zones}
        displayZone={displayZone}
      />

      {/* Weekly readings table — raw device export shape, searchable/sortable/paginated */}
      <ChartCard
        testId="weekly-readings-table"
        title="This Week's Readings"
        subtitle="Raw telemetry from the IWM scale network over the last 7 days"
        action={<Badge label={`${readings.length} rows`} variant="info" />}
        bodyClassName="px-3 sm:px-5"
      >
        <ReadingsTable
          testId="weekly-readings"
          zones={zones}
          data={readings}
          pageSize={8}
          filterable
          emptyLabel="No readings in the selected window."
        />
      </ChartCard>

      {/* Alerts + Scale Status */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 lg:gap-6">
        <ChartCard
          testId="recent-alerts-card"
          title="Needs Attention"
          subtitle="Most serious first — click any row for what it means"
          className="xl:col-span-3"
          action={<Badge label={`${alerts.filter((a) => a.status === 'Open').length} open`} variant="danger" />}
        >
          {alerts.length === 0 ? (
            <EmptyState testId="alerts-empty" icon={AlertTriangle} title="No alerts" description="Nothing to flag right now." />
          ) : (
            <ul className="max-h-[26rem] overflow-y-auto">
              {alerts.slice(0, 8).map((a) => (
                <AlertRow key={a.id} alert={a} />
              ))}
            </ul>
          )}
        </ChartCard>

        <div
          ref={scaleStatusRef}
          id="quick-scale-status"
          className={`xl:col-span-2 scroll-mt-24 rounded-2xl transition-shadow duration-500 ${
            highlightScales ? 'ring-2 ring-sky/70 shadow-glow' : 'ring-0'
          }`}
        >
        <ChartCard
          testId="quick-scale-status"
          title="Quick Scale Status"
          subtitle="Most recently reported first"
          className="h-full"
          action={
            <Badge
              label={`${scaleStatuses.filter((s) => s.state === 'online').length}/${scaleStatuses.length} active`}
              variant={scaleStatuses.some((s) => s.state === 'online') ? 'success' : 'neutral'}
            />
          }
        >
          {scaleStatuses.length === 0 ? (
            <EmptyState testId="scales-empty" icon={Activity} title="No scales yet" description="Assign a scale to see its status here." />
          ) : (
            // Scrolls rather than truncating: a fleet of a dozen devices should
            // all be reachable, not just the first handful.
            <ul className="divide-y divide-ink-600/40 max-h-[22rem] overflow-y-auto pr-1">
              {scaleStatuses.map((s) => (
                <li key={s.id} className="px-3 py-3 hover:bg-ink-700/25 transition-colors rounded-md">
                  <div className="flex items-center gap-3">
                    <span
                      className={`shrink-0 w-2.5 h-2.5 rounded-full ${
                        s.state === 'online'
                          ? 'bg-leaf shadow-[0_0_8px_#22C55E]'
                          : s.state === 'maintenance' || s.state === 'idle'
                          ? 'bg-amber'
                          : s.state === 'silent'
                          ? 'bg-red-500'
                          : 'bg-slate-600'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">{s.name}</div>
                      <div
                        className="text-xs text-slate-500 truncate"
                        title={
                          s.ownZone
                            ? `Recorded on this scale's own clock (${s.sourceZone})`
                            : `No zone set on this scale — read on the fleet clock: ${FLEET_TIME_ZONE_LABEL}`
                        }
                      >
                        {[s.location, s.lastSeenLabel].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-slate-100 tabular-nums">
                        {s.lastKg == null ? '—' : `${s.lastKg.toFixed(2)} kg`}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        {s.stateLabel}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
        </div>
      </div>
    </div>
  );
}