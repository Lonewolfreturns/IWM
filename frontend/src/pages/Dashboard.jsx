import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaChart, Area,
  CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Trash2, TrendingDown, Activity, MapPin, AlertTriangle, Radio, Inbox,
} from 'lucide-react';
import StatCard from '../components/common/StatCard.jsx';
import ChartCard from '../components/common/ChartCard.jsx';
import Badge from '../components/common/Badge.jsx';
import ReadingsTable from '../components/common/ReadingsTable.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import { getScales } from '../services/scales';
import { getReadings, getReadingsSince, getLiveReadings } from '../services/readings';
import { getDashboardStats, getRecentAlerts } from '../services/dashboard';
import {
  buildZoneMap, formatTime, timeZoneAbbr, relativeTime, readingInstant,
} from '../lib/time.js';
import { useTimeZonePreference } from '../lib/timeZonePreference.jsx';

// How often the live ticker re-queries the ±60s window.
const LIVE_POLL_MS = 15000;
// How often the rest of the dashboard re-queries (stats, alerts, readings, scales).
const REFRESH_MS = 60000;
// Cap on rows held in the table, so a long-running session doesn't grow forever.
const MAX_TABLE_ROWS = 2000;
// Readings are event-driven — a scale only reports when something is thrown
// away — so silence isn't automatically a fault. A kitchen can legitimately go
// overnight without a deposit. These tiers separate "quiet" from "worrying"
// instead of calling anything past an hour dead.
const HOUR_MS = 60 * 60 * 1000;
const ONLINE_WINDOW_MS = 24 * HOUR_MS;   // reported today
const IDLE_WINDOW_MS = 7 * 24 * HOUR_MS; // quiet, but plausibly just unused

function ChartTooltip({ active, payload, label, valueSuffix = ' kg' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-ink-600 bg-ink-900/95 backdrop-blur-md px-3 py-2 shadow-2xl">
      {label && (
        <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">{label}</div>
      )}
      <div className="flex flex-col gap-0.5">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2 text-xs">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-slate-300 capitalize">{p.name}:</span>
            <span className="text-white font-semibold">{p.value}{valueSuffix}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusToVariant(status) {
  if (status === 'Open') return 'danger';
  if (status === 'Resolved') return 'success';
  if (status === 'Acknowledged') return 'warning';
  if (status === 'Scheduled') return 'info';
  return 'neutral';
}

/* --------------------------- Live activity --------------------------- */

/**
 * RunningTotalWeight is per-scale state that resets on tare, so plotting it as
 * a single time series across several scales produces a line that jumps
 * between unrelated values — meaningless, and misleading rather than merely
 * ambiguous. So the panel adapts to how many scales are actually in scope:
 *
 *   1 scale   -> a time series is genuinely meaningful, so draw one.
 *   2 or more -> compare scales side by side, each bar labelled with its UID,
 *                so it is always clear which device a number belongs to.
 */
function LiveActivity({ readings, loading, zones, displayZone }) {
  // Source zone = where the reading was recorded; display zone = what the
  // viewer picked. Equal (or unknown) means the stored value is shown as-is.
  const sourceOf = (uid) => zones?.[uid] || null;
  const shownIn = (uid) => displayZone || sourceOf(uid);
  // Readings arrive newest-first, so the first row seen per UID is its latest.
  const perScale = useMemo(() => {
    const map = new Map();
    readings.forEach((r) => {
      if (!map.has(r.uid)) {
        map.set(r.uid, {
          uid: r.uid,
          runningTotal: r.runningTotalWeight ?? 0,
          lastReading: r.perDepositWeight ?? 0,
          lastAt: r.dateTime ?? '',
          deposited: 0,
        });
      }
      if (r.perDepositWeight > 0) map.get(r.uid).deposited += r.perDepositWeight;
    });
    // Most recently heard from first. This is a *live* panel: the thing that
    // just reported is what you want at the top, not whichever bin happens to
    // be fullest — that ordering barely changes and buries new activity.
    return [...map.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  }, [readings]);

  const single = perScale.length === 1;

  // Only built for the single-scale case, where a time axis means something.
  const series = useMemo(() => {
    if (!single) return [];
    return [...readings]
      .slice(0, 40)
      .reverse()
      .map((r) => ({ t: r.time?.slice(0, 5) ?? '', kg: r.runningTotalWeight }));
  }, [readings, single]);

  const totalDeposited = perScale.reduce((sum, s) => sum + s.deposited, 0);
  // The API marks rows false when nothing landed in the +/-60s band and it fell
  // back to last-known data, so the badge never claims to be live when it isn't.
  const isLive = readings.length > 0 && readings[0]?.isLive !== false;

  return (
    <ChartCard
      testId="live-waste-stream"
      title="Live Activity"
      subtitle={
        single
          ? `${perScale[0].uid} — running total over the last minute`
          : 'Current bin load per scale'
      }
      className="xl:col-span-3"
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
      ) : perScale.length === 0 ? (
        <EmptyState
          testId="live-stream-empty"
          title="No readings yet"
          description="Once your scales start reporting, activity will show up here."
        />
      ) : (
        <>
          <div className="flex items-baseline gap-6 px-3 pb-3 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                Reporting scales
              </div>
              <div className="font-display font-bold text-2xl text-white tabular-nums">
                {perScale.length}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                Deposited in window
              </div>
              <div className="font-display font-bold text-2xl text-leaf tabular-nums">
                {totalDeposited.toFixed(2)}{' '}
                <span className="text-sm text-slate-400 font-medium">kg</span>
              </div>
            </div>
          </div>

          {single ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
                  <defs>
                    <linearGradient id="liveGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22C55E" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#22C55E" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 4" stroke="#334155" vertical={false} />
                  <XAxis dataKey="t" stroke="#64748B" fontSize={10} tickLine={false} axisLine={false} minTickGap={44} />
                  <YAxis stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} unit=" kg" width={46} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#22C55E', strokeOpacity: 0.25 }} />
                  <Area
                    type="monotone"
                    dataKey="kg"
                    name="Running total"
                    stroke="#22C55E"
                    strokeWidth={2.5}
                    fill="url(#liveGrad)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-56 overflow-y-auto px-3 space-y-2.5">
              {perScale.map((s) => {
                const max = perScale[0].runningTotal || 1;
                const pct = Math.max(2, Math.round((s.runningTotal / max) * 100));
                return (
                  <div key={s.uid} className="flex items-center gap-3" data-testid={`live-scale-${s.uid}`}>
                    <span className="w-24 shrink-0 text-xs font-mono text-slate-300 truncate">
                      {s.uid}
                    </span>
                    <div className="flex-1 h-6 rounded-md bg-ink-800/60 overflow-hidden">
                      <div
                        className="h-full rounded-md bg-sky-gradient transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-xs font-semibold text-slate-100 tabular-nums">
                      {s.runningTotal.toFixed(2)} kg
                    </span>
                    <span
                      className="w-20 shrink-0 text-right text-[10px] text-slate-500 tabular-nums"
                      title={
                        shownIn(s.uid)
                          ? `${timeZoneAbbr(shownIn(s.uid))} · ${shownIn(s.uid)}`
                          : 'Scale has no time zone set — shown as recorded'
                      }
                    >
                      {formatTime(s.lastAt, sourceOf(s.uid), displayZone, false)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </ChartCard>
  );
}

function IncomingFeed({ readings, loading, zones, displayZone }) {
  return (
    <ChartCard
      testId="incoming-feed"
      title="Incoming Readings"
      subtitle="Most recent captures as scales report in"
      className="xl:col-span-2"
    >
      {loading ? (
        <div className="px-3 py-6 text-sm text-slate-400">Loading…</div>
      ) : readings.length === 0 ? (
        <EmptyState testId="incoming-feed-empty" icon={Inbox} title="Nothing reported yet" />
      ) : (
        <ul className="divide-y divide-ink-600/40">
          {readings.slice(0, 7).map((r, i) => (
            <li key={`${r.uid}-${r.time}-${i}`} className="px-3 py-2.5 flex items-center gap-3 hover:bg-ink-700/25 rounded-md transition-colors">
              <span className="w-2 h-2 rounded-full shrink-0 bg-sky" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{r.uid}</div>
                <div className="text-xs text-slate-500 truncate">{r.message1 || 'Deposit'} · {r.date}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-slate-100 tabular-nums">{r.perDepositWeight?.toFixed(2)} kg</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 tabular-nums">
                  {formatTime(r.dateTime, zones?.[r.uid] || null, displayZone, false)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

/* -------------------------------- Page --------------------------------- */

export default function Dashboard() {
  const [scales, setScales] = useState([]);
  const [readings, setReadings] = useState([]);     // last 7 days, for the table
  const [live, setLive] = useState([]);             // now ±60s, for the ticker
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  // Newest DateTime already loaded — the cursor for incremental refreshes.
  const newestSeen = useRef(null);

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
    const pullSlow = (force = false) => {
      if (document.hidden && !force) return;

      // After the first load, ask only for rows newer than the newest one we
      // already hold. A quiet minute then costs an empty response instead of
      // re-sending the whole week.
      const newest = newestSeen.current;
      const readingsCall = newest ? getReadingsSince(newest) : getReadings();

      Promise.allSettled([
        getScales(), readingsCall, getDashboardStats(), getRecentAlerts(),
      ]).then(([scalesRes, readingsRes, statsRes, alertsRes]) => {
        if (!mounted) return;
        // Only replace on success — a transient failure shouldn't blank a
        // panel that already holds good data.
        if (scalesRes.status === 'fulfilled') setScales(scalesRes.value);
        if (statsRes.status === 'fulfilled') setStats(statsRes.value);
        if (alertsRes.status === 'fulfilled') setAlerts(alertsRes.value);

        if (readingsRes.status === 'fulfilled') {
          const incoming = readingsRes.value || [];
          if (incoming.length) {
            newestSeen.current = incoming.reduce(
              (max, r) => (r.dateTime > max ? r.dateTime : max),
              newestSeen.current || ''
            );
          }
          setReadings((prev) => {
            if (!newest) return incoming;            // first load: full set
            if (!incoming.length) return prev;       // nothing new
            // Merge newest-first, de-duplicating on UID + timestamp.
            //
            // The dedupe is not belt-and-braces: an older deployment of the
            // readings Lambda ignores `since` and replies with the whole
            // window, which would otherwise stack the same rows on every
            // poll. Keying the merge makes the client correct either way.
            const merged = [...incoming, ...prev];
            const seen = new Set();
            const unique = [];
            for (const r of merged) {
              const key = `${r.uid}|${r.dateTime}`;
              if (seen.has(key)) continue;
              seen.add(key);
              unique.push(r);
            }
            unique.sort((a, b) => (a.dateTime < b.dateTime ? 1 : -1));
            return unique.slice(0, MAX_TABLE_ROWS);
          });
        }

        setLoading(false);
        setLastUpdated(new Date());
      });
    };

    const pullLive = (force = false) => {
      if (document.hidden && !force) return;
      getLiveReadings()
        .then((data) => mounted && setLive(data))
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
  const zones = useMemo(() => buildZoneMap(scales, null), [scales]);
  const { fixedZone: displayZone, deviceZone: viewerZone } = useTimeZonePreference();

  // `lastReading`, `lastActive` and `status` are stored on the scale record but
  // nothing ever writes to them, so they'd read 0 kg / blank forever. Derive
  // them from the telemetry we already have instead: a scale is "online" if it
  // has actually reported recently, not because a field says so.
  const scaleStatuses = useMemo(() => {
    const latest = new Map();
    // readings and live are both newest-first, so first sighting per UID wins.
    [...live, ...readings].forEach((r) => {
      if (!latest.has(r.uid)) latest.set(r.uid, r);
    });

    const now = Date.now();
    const rank = { online: 0, maintenance: 1, idle: 2, silent: 3, unknown: 4 };

    return scales
      .map((sc) => {
        const id = sc.scaleId || sc.id;
        const last = latest.get(id);
        const lastAt = last?.dateTime || null;
        // Age is an elapsed duration, so it needs a real instant. Most scales
        // have no `timeZone` set — and admin's unregistered devices never do —
        // so this falls back to the viewer's zone rather than giving up, which
        // would report every such scale as "no data" and show 0 active.
        // A few hours' error almost never crosses the 24h / 7d tier below.
        const zoneKnown = Boolean(sc.timeZone);
        const lastInstant = lastAt
          ? readingInstant(lastAt, sc.timeZone || null, viewerZone)
          : null;
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
          state,
          stateLabel:
            state === 'online' ? 'active'
              : state === 'maintenance' ? 'maintenance'
              : state === 'idle' ? 'quiet'
              : state === 'silent' ? 'silent'
              : 'no data',
          lastKg: last?.perDepositWeight ?? null,
          // Flagged so the row can say the age is estimated rather than
          // presenting a guessed offset as fact.
          zoneKnown,
          lastSeenLabel: lastAt
            ? relativeTime(lastAt, sc.timeZone || null, now, viewerZone)
            : 'never reported',
        };
      })
      .sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name));
  }, [scales, readings, live, viewerZone]);

  const totalActive = scaleStatuses.filter((s) => s.state === 'online').length;
  const cityCount = new Set(scales.map((s) => s.location)).size;

  const weeklyChangePct = stats?.weeklyChangePct ?? 0;
  const activeScales = stats?.activeScales ?? totalActive;
  const totalScales = stats?.totalScales ?? scales.length;
  const sparklineData = stats?.sparkline ?? [];

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
          <p className="text-sm text-slate-400 mt-1">
            {scales.length === 0
              ? 'No scales connected yet.'
              : `Live data from ${totalActive} scales across ${cityCount} cities.`}
          </p>
        </div>

        {lastUpdated && (
          <div
            className="inline-flex items-center gap-2 px-3 h-9 rounded-xl border border-ink-600 bg-ink-800/60 text-[11px] text-slate-400"
            data-testid="dashboard-last-updated"
            title="The dashboard refreshes on its own; no need to reload"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-leaf animate-pulse" />
            Auto-refreshing · updated{' '}
            {lastUpdated.toLocaleTimeString('en-CA', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            })}
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
          title="Weekly Waste Trend"
          value={weeklyChangePct}
          suffix="%"
          change={`${Math.abs(weeklyChangePct)}% ${weeklyChangePct <= 0 ? 'reduction' : 'increase'}`}
          changeType="down"
          changeLabel="vs last week"
          icon={TrendingDown}
          color="sky"
          format="int"
        >
          {sparklineData.length > 0 && (
            <div className="h-10 -mx-1">
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
          icon={Activity}
          color="amber"
        >
          {totalScales > 0 && (
            <div className="flex items-center gap-1.5 mt-1">
              {Array.from({ length: totalScales }).map((_, i) => (
                <span
                  key={i}
                  className={`w-2 h-2 rounded-full ${i < activeScales ? 'bg-leaf shadow-[0_0_6px_#22C55E]' : 'bg-red-500'}`}
                />
              ))}
            </div>
          )}
        </StatCard>
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 lg:gap-6">
        <LiveActivity readings={live} loading={liveLoading} zones={zones} displayZone={displayZone} />
        <IncomingFeed readings={live} loading={liveLoading} zones={zones} displayZone={displayZone} />
      </div>

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
          emptyLabel="No readings in the selected window."
        />
      </ChartCard>

      {/* Alerts + Scale Status */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 lg:gap-6">
        <ChartCard
          testId="recent-alerts-card"
          title="Recent Alerts"
          subtitle="Last 5 events from connected scales"
          className="xl:col-span-3"
          action={<Badge label={`${alerts.filter((a) => a.status === 'Open').length} open`} variant="danger" />}
        >
          {alerts.length === 0 ? (
            <EmptyState testId="alerts-empty" icon={AlertTriangle} title="No alerts" description="Nothing to flag right now." />
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="text-left font-semibold uppercase tracking-wider text-[11px] px-3 py-2.5">Time</th>
                    <th className="text-left font-semibold uppercase tracking-wider text-[11px] px-3 py-2.5">Scale</th>
                    <th className="text-left font-semibold uppercase tracking-wider text-[11px] px-3 py-2.5">Type</th>
                    <th className="text-left font-semibold uppercase tracking-wider text-[11px] px-3 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.slice(0, 5).map((a) => (
                    <tr key={a.id} className="border-t border-ink-600/40 hover:bg-ink-700/30">
                      <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{a.timestamp}</td>
                      <td className="px-3 py-2.5 text-slate-200 max-w-[220px] truncate">{a.scale}</td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-slate-200">
                          <AlertTriangle
                            className={`w-3.5 h-3.5 ${
                              a.severity === 'danger' ? 'text-red-400' : a.severity === 'warning' ? 'text-amber' : 'text-sky'
                            }`}
                          />
                          {a.type}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge label={a.status} variant={StatusToVariant(a.status)} dot />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>

        <ChartCard
          testId="quick-scale-status"
          title="Quick Scale Status"
          subtitle="Reported today first, then quiet, then silent"
          className="xl:col-span-2"
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
                          s.zoneKnown
                            ? undefined
                            : 'No time zone set for this scale — age estimated using your zone'
                        }
                      >
                        {[s.location, s.lastSeenLabel].filter(Boolean).join(' · ')}
                        {!s.zoneKnown && s.lastKg != null && (
                          <span className="text-slate-600"> ·&nbsp;approx</span>
                        )}
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
  );
}
