import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, Area, PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Filter, MapPin, ChevronDown, Trash2, CalendarDays, Layers, TrendingDown,
} from 'lucide-react';
import { toast } from 'sonner';
import ChartCard from '../components/common/ChartCard.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import DatePicker from '../components/common/DatePicker.jsx';
import SelectMenu from '../components/common/SelectMenu.jsx';
import CoverageNotice from '../components/common/CoverageNotice.jsx';
import StatCard from '../components/common/StatCard.jsx';
import LoadingSpinner from '../components/common/LoadingSpinner.jsx';
import ChartSkeleton, { StatSkeleton } from '../components/common/ChartSkeleton.jsx';
import { WASTE_CATEGORIES } from '../data/mockData';
import { getScales } from '../services/scales';
import { defaultWindow, validateWindow, formatWindowLabel, shiftDays } from '../lib/dataWindow';
import {
  getSummary, getDailyTrend, getCategoryBreakdown, getHourlyWaste,
  getMealPeriods, getScaleComparison, getPeriodComparison,
} from '../services/analytics';

function ChartTooltip({ active, payload, label, valueSuffix = ' kg' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-ink-600 bg-ink-900/95 backdrop-blur-md px-3 py-2 shadow-2xl">
      {label && (
        <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">
          {label}
        </div>
      )}
      {payload.map((p) => (
        <div key={p.dataKey || p.name} className="flex items-center gap-2 text-xs">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: p.color || p.payload?.fill }}
          />
          <span className="text-slate-300 capitalize">{p.name}:</span>
          <span className="text-white font-semibold">
            {p.value}
            {valueSuffix}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Service-period tooltip.
 *
 * Shows the window and the deposit count alongside the weight, because the
 * bars are not comparable on height alone: the default Night period spans
 * eight hours against everything else's four, and a scale's own schedule can
 * make them wildly uneven. Without the window on screen, a tall bar reads as
 * a wasteful service rather than simply a longer one.
 */
function MealTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-ink-600 bg-ink-900/95 backdrop-blur-md px-3 py-2 shadow-2xl">
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: row.color }} />
        <span className="text-white text-xs font-semibold">{row.label}</span>
      </div>
      <div className="text-[11px] text-slate-400">{row.window}</div>
      <div className="text-sm text-white font-semibold mt-1">{row.value} kg</div>
      <div className="text-[11px] text-slate-400">
        {row.deposits} deposit{row.deposits === 1 ? '' : 's'}
      </div>
    </div>
  );
}

function MultiSelect({ label, options, selected, onChange, testId }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (val) => {
    onChange(
      selected.includes(val)
        ? selected.filter((v) => v !== val)
        : [...selected, val]
    );
  };
  return (
    <div className="relative z-10" data-testid={testId} ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-11 px-3.5 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 inline-flex items-center justify-between gap-2 hover:border-sky/50 transition-all"
      >
        <span className="truncate">
          {selected.length === 0
            ? label
            : `${selected.length} selected`}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1.5 w-full glass-strong border border-ink-600 rounded-xl shadow-2xl p-1.5">
          {options.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-ink-700/60 cursor-pointer text-sm text-slate-200"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="accent-sky"
              />
              <span
                className="w-2 h-2 rounded-sm"
                style={{ background: opt.color }}
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Analytics() {
  // Opens on the API's own default window — the trailing week ending today,
  // the same range the main dashboard shows.
  const initialWindow = useMemo(() => defaultWindow(), []);
  const [from, setFrom] = useState(initialWindow.from);
  const [to, setTo] = useState(initialWindow.to);
  const [location, setLocation] = useState('all');
  const [scale, setScale] = useState('all');
  const [categories, setCategories] = useState([]);

  const [loading, setLoading] = useState(true);
  const [scales, setScales] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [summary, setSummary] = useState(null);
  const [dailyTrend, setDailyTrend] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [categoryBreakdown, setCategoryBreakdown] = useState([]);
  const [hourlyWaste, setHourlyWaste] = useState([]);
  const [mealPeriods, setMealPeriods] = useState([]);
  const [mealSource, setMealSource] = useState('default');
  const [scaleComparison, setScaleComparison] = useState([]);

  // The range the charts on screen were actually fetched for. Held separately
  // from the `from`/`to` inputs so that editing a date does not relabel the
  // charts until Apply has refetched them.
  const [applied, setApplied] = useState({ ...initialWindow, uid: 'all' });

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    const opts = applied;
    Promise.allSettled([
      getScales(),
      getSummary(opts), getDailyTrend(opts), getPeriodComparison(opts),
      getCategoryBreakdown(opts), getHourlyWaste(opts),
      getMealPeriods(opts), getScaleComparison(opts),
    ]).then((results) => {
      if (!mounted) return;
      const value = (r) => (r.status === 'fulfilled' ? r.value : null);

      setScales(value(results[0]) || []);

      const summaryRes = value(results[1]);
      // Coverage is identical across routes for a given range, so one is
      // enough — taken from summary because it's the cheapest to reason about.
      setCoverage(summaryRes?.coverage ?? null);
      setSummary(summaryRes?.data ?? null);

      setDailyTrend(value(results[2])?.data || []);
      setComparison(value(results[3])?.data ?? null);
      setCategoryBreakdown(value(results[4])?.data || []);
      setHourlyWaste(value(results[5])?.data || []);

      const meals = value(results[6]);
      setMealPeriods(meals?.data || []);
      setMealSource(meals?.scheduleSource || 'default');

      setScaleComparison(value(results[7])?.data || []);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [applied]);

  /**
   * Jump to the week around a date the API reported as the nearest data.
   * Applies immediately — the button exists precisely because the current
   * range is empty, so there is nothing to lose by reloading.
   */
  const jumpToDate = (date) => {
    const nextFrom = shiftDays(date, -3);
    const nextTo = shiftDays(date, 3);
    setFrom(nextFrom);
    setTo(nextTo);
    setApplied({ from: nextFrom, to: nextTo, uid: scale });
  };

  const applyFilters = () => {
    const problem = validateWindow(from, to);
    if (problem) {
      toast.error(problem);
      return;
    }
    setApplied({ from, to, uid: scale });
  };

  const clearFilters = () => {
    const reset = defaultWindow();
    setFrom(reset.from);
    setTo(reset.to);
    setLocation('all');
    setScale('all');
    setCategories([]);
    setApplied({ ...reset, uid: 'all' });
  };

  // True while the inputs hold a range the charts have not been fetched for.
  const isDirty = from !== applied.from || to !== applied.to || scale !== applied.uid;

  // Both dropdowns are built from the fleet actually returned by /scales, not
  // from a fixed list. A hardcoded set of cities offered places with no scale
  // in them while hiding every location that had one.
  const locationOptions = useMemo(() => {
    const seen = [...new Set(scales.map((s) => s.location).filter(Boolean))].sort();
    return [
      { value: 'all', label: 'All locations' },
      ...seen.map((city) => ({ value: city, label: city })),
    ];
  }, [scales]);

  const scaleOptions = useMemo(
    () => [
      { value: 'all', label: 'All scales' },
      ...scales.map((s) => ({
        value: s.scaleId || s.id,
        label: s.name || s.scaleId || s.id,
      })),
    ],
    [scales]
  );

  const categoryTotal = useMemo(
    () => categoryBreakdown.reduce((a, b) => a + b.value, 0),
    [categoryBreakdown]
  );

  return (
    <div className="space-y-6 lg:space-y-8" data-testid="analytics-page">
      {/* Header & filters */}
      <div>
        <div className="text-xs uppercase tracking-[0.22em] text-sky font-semibold mb-2">
          <Filter className="inline w-3.5 h-3.5 mr-1" /> Analytics
        </div>
        <h2 className="font-display font-bold text-2xl sm:text-3xl text-white">
          Deep insights across your kitchen network
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Filter by date range or scale to find what's driving your waste. Charts
          below cover{' '}
          <span className="text-slate-300 font-medium">
            {formatWindowLabel(applied.from, applied.to)}
          </span>
          .
        </p>
      </div>

      <div className="relative z-20 glass rounded-2xl p-4 sm:p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <div className="xl:col-span-2 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
                From
              </label>
              <DatePicker
                value={from}
                max={to || undefined}
                onChange={setFrom}
                testId="filter-from"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
                To
              </label>
              <DatePicker
                value={to}
                min={from || undefined}
                onChange={setTo}
                testId="filter-to"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Location
            </label>
            <SelectMenu
              value={location}
              onChange={setLocation}
              options={locationOptions}
              icon={MapPin}
              testId="filter-location"
            />
          </div>

          <div className="xl:col-span-2">
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Waste Categories
            </label>
            <MultiSelect
              label="All categories"
              testId="filter-categories"
              options={WASTE_CATEGORIES.map((c) => ({
                value: c.key,
                label: c.label,
                color: c.color,
              }))}
              selected={categories}
              onChange={setCategories}
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Scale
            </label>
            <SelectMenu
              value={scale}
              onChange={setScale}
              options={scaleOptions}
              testId="filter-scale"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500" data-testid="filter-applied-range">
            {isDirty
              ? 'Unapplied changes — press Apply Filters to reload.'
              : `Showing ${formatWindowLabel(applied.from, applied.to)}`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={clearFilters}
              className="btn-ghost h-10"
              data-testid="filter-clear"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={applyFilters}
              disabled={loading}
              className="btn-sky h-10 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
              data-testid="filter-apply"
            >
              {/* Motion rather than a word swap: a spinning ring reads as
                  "working" without being read at all. */}
              {loading && <LoadingSpinner size={15} />}
              {loading ? 'Loading' : 'Apply Filters'}
            </button>
          </div>
        </div>
      </div>

      {/* What the range actually holds — above every chart drawn from it. */}
      <CoverageNotice coverage={coverage} onUseRange={jumpToDate} />

      {/* Range totals */}
      {loading ? <StatSkeleton testId="analytics-stats-skeleton" /> : (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          testId="analytics-total"
          title="Total Waste"
          value={summary ? `${summary.totalKg.toLocaleString('en-CA')} kg` : '—'}
          icon={Trash2}
          color="sky"
        />
        <StatCard
          testId="analytics-daily-avg"
          title="Avg / Reporting Day"
          value={summary ? `${summary.avgPerActiveDayKg.toLocaleString('en-CA')} kg` : '—'}
          icon={CalendarDays}
          color="leaf"
        >
          {summary && (
            <div className="text-[11px] text-slate-500 mt-1">
              across {summary.daysWithData} day{summary.daysWithData === 1 ? '' : 's'} with data
            </div>
          )}
        </StatCard>
        <StatCard
          testId="analytics-deposits"
          title="Deposits"
          value={summary ? summary.deposits.toLocaleString('en-CA') : '—'}
          icon={Layers}
          color="amber"
        />
        <StatCard
          testId="analytics-change"
          title="vs Previous Period"
          value={
            comparison?.changePct == null
              ? '—'
              : `${comparison.changePct > 0 ? '+' : ''}${comparison.changePct}%`
          }
          icon={TrendingDown}
          color={comparison?.changePct > 0 ? 'danger' : 'leaf'}
        >
          {/* No baseline and no change are different answers, and only one of
              them is good news. */}
          <div className="text-[11px] text-slate-500 mt-1">
            {comparison?.changePct == null
              ? 'no data in the preceding period'
              : `${comparison.previous.from} → ${comparison.previous.to}`}
          </div>
        </StatCard>
      </div>
      )}

      {/* Daily waste trend */}
      <ChartCard
        testId="chart-daily-trend"
        title="Daily Waste Trend"
        subtitle={`kg per day across ${formatWindowLabel(applied.from, applied.to)}`}
      >
        {loading ? (
          <ChartSkeleton testId="daily-trend-skeleton" />
        ) : dailyTrend.length === 0 ? (
          <EmptyState testId="daily-trend-empty" />
        ) : (
          <div className="h-72 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyTrend} margin={{ left: 8, right: 16, top: 12, bottom: 4 }}>
                <defs>
                  <linearGradient id="dailyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#38BDF8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 4" stroke="#334155" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke="#64748B"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  tickFormatter={(d) => String(d).slice(5)}
                />
                <YAxis stroke="#64748B" fontSize={12} tickLine={false} axisLine={false} unit=" kg" />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#38BDF8', strokeOpacity: 0.25 }} />
                <Area type="monotone" dataKey="value" stroke="transparent" fill="url(#dailyFill)" />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Waste"
                  stroke="#38BDF8"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 6, fill: '#38BDF8', strokeWidth: 3, stroke: '#0F172A' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      {/* Service periods */}
      <ChartCard
        testId="chart-meal-periods"
        title="Waste by Service Period"
        subtitle={
          mealSource === 'scale'
            ? "Using this scale's configured service times"
            : 'Using the standard service windows — select a single scale to use its own'
        }
      >
        {loading ? (
          <ChartSkeleton bars={5} testId="meal-periods-skeleton" />
        ) : mealPeriods.length === 0 ? (
          <EmptyState testId="meal-periods-empty" />
        ) : (
          <div className="h-72 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mealPeriods} margin={{ left: 8, right: 16, top: 12, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="#334155" vertical={false} />
                <XAxis dataKey="label" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748B" fontSize={12} tickLine={false} axisLine={false} unit=" kg" />
                <Tooltip
                  content={<MealTooltip />}
                  cursor={{ fill: '#38BDF8', fillOpacity: 0.06 }}
                />
                <Bar dataKey="value" name="Waste" radius={[8, 8, 0, 0]}>
                  {mealPeriods.map((m) => (
                    <Cell key={m.key} fill={m.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      {/* Category breakdown + Peak hours */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6">
        <ChartCard
          testId="chart-category-breakdown"
          title="Food Category Breakdown"
          subtitle="Where is your waste coming from?"
          className="lg:col-span-3"
        >
          {loading ? (
            <ChartSkeleton bars={4} testId="category-skeleton" />
          ) : categoryBreakdown.length === 0 ? (
            <EmptyState testId="category-breakdown-empty" />
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="h-64 w-full sm:w-1/2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryBreakdown}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={92}
                      paddingAngle={2}
                      stroke="#0F172A"
                      strokeWidth={3}
                    >
                      {categoryBreakdown.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip valueSuffix=" kg" />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 w-full">
                <ul className="space-y-2">
                  {categoryBreakdown.map((c) => {
                    const pct = categoryTotal ? Math.round((c.value / categoryTotal) * 100) : 0;
                    return (
                      <li key={c.name} className="flex items-center gap-3 group">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ background: c.color }}
                        />
                        <span className="text-sm text-slate-200 flex-1">{c.name}</span>
                        <span className="text-xs text-slate-400 font-semibold tabular-nums">
                          {c.value} kg
                        </span>
                        <span className="text-xs text-slate-500 tabular-nums w-10 text-right">
                          {pct}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard
          testId="chart-peak-hours"
          title="Peak Waste Hours"
          subtitle="When is the most waste generated?"
          className="lg:col-span-2"
        >
          {loading ? (
            <ChartSkeleton bars={12} testId="hourly-skeleton" />
          ) : hourlyWaste.length === 0 ? (
            <EmptyState testId="hourly-waste-empty" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyWaste} margin={{ left: 0, right: 6, top: 8, bottom: 4 }}>
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38BDF8" stopOpacity={1} />
                      <stop offset="100%" stopColor="#38BDF8" stopOpacity={0.35} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 4" stroke="#334155" vertical={false} />
                  <XAxis dataKey="hour" stroke="#64748B" fontSize={10} tickLine={false} axisLine={false} interval={1} />
                  <YAxis stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} unit=" kg" />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(56,189,248,0.08)' }} />
                  <Bar dataKey="value" name="Waste" fill="url(#barGrad)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Per-scale comparison */}
      <ChartCard
        testId="chart-scale-comparison"
        title="Waste by Scale"
        subtitle="Total captured per device across the selected range"
      >
        {loading ? (
          <ChartSkeleton bars={6} testId="scale-comparison-skeleton" />
        ) : scaleComparison.length === 0 ? (
          <EmptyState testId="scale-comparison-empty" />
        ) : (
          <div className="h-72 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={scaleComparison}
                layout="vertical"
                margin={{ left: 8, right: 24, top: 12, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 4" stroke="#334155" horizontal={false} />
                <XAxis type="number" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} unit=" kg" />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke="#64748B"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={120}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(56,189,248,0.08)' }} />
                <Bar dataKey="value" name="Waste" fill="#38BDF8" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
