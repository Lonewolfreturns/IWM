import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, FileSpreadsheet, Plus, CalendarRange } from 'lucide-react';
import { toast } from 'sonner';
import ChartCard from '../components/common/ChartCard.jsx';
import Badge from '../components/common/Badge.jsx';
import DatePicker from '../components/common/DatePicker.jsx';
import SelectMenu from '../components/common/SelectMenu.jsx';
import CoverageNotice from '../components/common/CoverageNotice.jsx';
import BusyOverlay from '../components/common/BusyOverlay.jsx';
import LoadingSpinner from '../components/common/LoadingSpinner.jsx';
import { getScales } from '../services/scales';
import { buildReport, getReportCoverage, SECTIONS } from '../services/reports';
import {
  defaultWindow, validateWindow, formatWindowLabel, daysInWindow, shiftDays, todayUTC,
} from '../lib/dataWindow';
import {
  weeklySections, monthlySections, monthLabel, coverageSections,
} from '../lib/reportBuilders';
import { downloadCSV, downloadPDF } from '../lib/fileExport.js';

const TABS = [
  { key: 'weekly', label: 'Weekly Report', Icon: CalendarRange },
  { key: 'monthly', label: 'Monthly Report', Icon: CalendarRange },
  { key: 'custom', label: 'Custom Export', Icon: FileSpreadsheet },
];

/**
 * Sections each preset asks the API for.
 *
 * Weekly and monthly deliberately omit `raw`. A PDF is a document people read,
 * and several thousand telemetry rows in one is unreadable — the per-scale
 * status block answers the same "is this number real" question in a form that
 * fits on a page. Raw rows belong in the CSV, where they can be filtered and
 * sorted.
 */
const PRESET_SECTIONS = [
  SECTIONS.TOTAL, SECTIONS.CATEGORY, SECTIONS.SCALE, SECTIONS.MEALS, SECTIONS.DAILY,
];

const CUSTOM_METRICS = [
  { key: SECTIONS.TOTAL, label: 'Totals & averages' },
  { key: SECTIONS.CATEGORY, label: 'Category breakdown' },
  { key: SECTIONS.SCALE, label: 'Per-scale status' },
  { key: SECTIONS.MEALS, label: 'Service periods' },
  { key: SECTIONS.DAILY, label: 'Daily totals' },
  { key: SECTIONS.RAW, label: 'Raw readings (CSV only)' },
];

/** Sunday-to-Saturday week containing `date`. */
function weekOf(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const from = shiftDays(date, -d.getUTCDay());
  return { from, to: shiftDays(from, 6) };
}

/** First to last day of the month containing `date`. */
function monthOf(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { from: first, to: last };
}

export default function Reports() {
  const [tab, setTab] = useState('weekly');

  // Each tab owns its range: a week, a month, and a free range respectively.
  const lastWeek = useMemo(() => weekOf(shiftDays(todayUTC(), -7)), []);
  const lastMonth = useMemo(() => monthOf(shiftDays(todayUTC(), -28)), []);
  const initial = useMemo(() => defaultWindow(), []);

  const [weekAnchor, setWeekAnchor] = useState(lastWeek.from);
  const [monthAnchor, setMonthAnchor] = useState(lastMonth.from);
  const [customFrom, setCustomFrom] = useState(initial.from);
  const [customTo, setCustomTo] = useState(initial.to);

  const [scale, setScale] = useState('all');
  const [metrics, setMetrics] = useState([
    SECTIONS.TOTAL, SECTIONS.CATEGORY, SECTIONS.SCALE, SECTIONS.RAW,
  ]);
  const [format, setFormat] = useState('CSV');

  const [scales, setScales] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [checking, setChecking] = useState(false);
  const [generating, setGenerating] = useState(false);

  // The range currently in play, derived from whichever tab is open.
  const range = useMemo(() => {
    if (tab === 'weekly') return weekOf(weekAnchor);
    if (tab === 'monthly') return monthOf(monthAnchor);
    return { from: customFrom, to: customTo };
  }, [tab, weekAnchor, monthAnchor, customFrom, customTo]);

  useEffect(() => {
    let mounted = true;
    getScales()
      .then((s) => mounted && setScales(s || []))
      .catch(() => mounted && setScales([]));
    return () => {
      mounted = false;
    };
  }, []);

  // Coverage is checked as the range changes, not only at generate time, so
  // nobody exports a month that holds four days of data and finds out after.
  useEffect(() => {
    let mounted = true;
    if (validateWindow(range.from, range.to)) {
      setCoverage(null);
      return undefined;
    }
    setChecking(true);
    getReportCoverage({ from: range.from, to: range.to, uid: scale })
      .then((res) => mounted && setCoverage(res?.coverage ?? null))
      .catch(() => mounted && setCoverage(null))
      .finally(() => mounted && setChecking(false));
    return () => {
      mounted = false;
    };
  }, [range.from, range.to, scale]);

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

  const toggleMetric = (key) => {
    setMetrics((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]
    );
  };

  const jumpToDate = (date) => {
    if (tab === 'weekly') setWeekAnchor(date);
    else if (tab === 'monthly') setMonthAnchor(date);
    else {
      setCustomFrom(shiftDays(date, -3));
      setCustomTo(shiftDays(date, 3));
    }
  };

  const generate = async () => {
    const problem = validateWindow(range.from, range.to);
    if (problem) {
      toast.error(problem);
      return;
    }
    const isCustom = tab === 'custom';
    const wanted = isCustom ? metrics : PRESET_SECTIONS;
    if (wanted.length === 0) {
      toast.error('Select at least one section');
      return;
    }

    setGenerating(true);
    let report;
    try {
      report = await buildReport({
        from: range.from,
        to: range.to,
        uid: scale,
        sections: wanted,
      });
    } catch (err) {
      setGenerating(false);
      toast.error('Could not build the report', {
        description: err?.response?.data?.message || 'The export was not generated.',
      });
      return;
    }
    setGenerating(false);

    const cov = report.coverage || {};
    setCoverage(cov);

    // An empty range produces no document. A PDF of zeroes that looks like a
    // real report is worse than being told there is nothing to report.
    if (cov.status === 'empty') {
      toast.error('No data in that range', { description: cov.message });
      return;
    }

    // The label is always the range the data actually covers, never the range
    // that was typed — that gap is how a document ends up claiming a period
    // its own figures were never filtered to.
    const actual = cov.actual || range;
    const rangeLabel = formatWindowLabel(actual.from, actual.to);
    const scopeLabel =
      scale === 'all'
        ? `${report.scope?.scales ?? 0} scale${report.scope?.scales === 1 ? '' : 's'}`
        : scale;

    if (isCustom && format === 'CSV') {
      exportCSV(`iwm_export_${actual.from}_${actual.to}.csv`, report, cov, rangeLabel);
    } else if (isCustom) {
      downloadPDF(`iwm_export_${actual.from}_${actual.to}.pdf`, {
        title: 'Custom Waste Report',
        subtitle: scopeLabel,
        dateRange: rangeLabel,
        sections: [...coverageSections(cov), ...customSections(report)],
      });
    } else if (tab === 'weekly') {
      downloadPDF(`iwm_weekly_${actual.from}.pdf`, {
        title: 'Weekly Waste Report',
        subtitle: scopeLabel,
        dateRange: rangeLabel,
        sections: weeklySections(report),
      });
    } else {
      downloadPDF(`iwm_monthly_${actual.from.slice(0, 7)}.pdf`, {
        title: `Monthly Waste Report — ${monthLabel(range.from, range.to)}`,
        subtitle: scopeLabel,
        dateRange: rangeLabel,
        sections: monthlySections(report),
      });
    }

    toast.success('Report generated', {
      description: `${rangeLabel}${cov.complete ? '' : ' · partial coverage'}`,
    });
  };

  const isCustom = tab === 'custom';
  const spanDays = daysInWindow(range.from, range.to);

  return (
    <div className="space-y-6 lg:space-y-8" data-testid="reports-page">
      {/* The one place a full block is warranted: the result of this arrives
          in the browser's download tray, not on the page, so an unblocked
          screen looks like nothing happened — and the natural response is to
          click again and produce a second document. */}
      <BusyOverlay
        open={generating}
        title="Preparing your report"
        detail={`Collecting ${formatWindowLabel(range.from, range.to)} — this can take a few seconds.`}
      />

      <div>
        <div className="text-xs uppercase tracking-[0.22em] text-sky font-semibold mb-2">
          <FileText className="inline w-3.5 h-3.5 mr-1" /> Reports & Exports
        </div>
        <h2 className="font-display font-bold text-2xl sm:text-3xl text-white">
          Download insights, share with stakeholders
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Data is fetched for the range you choose, so every figure matches the
          period printed on the document.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-ink-800/60 border border-ink-600 rounded-xl w-full overflow-x-auto sm:w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            data-testid={`reports-tab-${t.key}`}
            className={`inline-flex items-center gap-2 px-4 h-10 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
              tab === t.key
                ? 'bg-sky-gradient text-ink-900 shadow-glow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <t.Icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      <CoverageNotice coverage={coverage} onUseRange={jumpToDate} />

      <ChartCard
        testId="report-builder"
        title={
          isCustom ? 'Custom Export' : tab === 'weekly' ? 'Weekly Report' : 'Monthly Report'
        }
        subtitle={
          isCustom
            ? 'Pick any range and sections. CSV carries every raw reading.'
            : tab === 'weekly'
            ? 'A full week of scale status, distribution and daily detail.'
            : 'A month, with week-on-week comparison and a collection heatmap.'
        }
        action={
          coverage?.status === 'partial' ? (
            <Badge label={`${coverage.daysWithData}/${coverage.daysRequested} days`} variant="warning" />
          ) : coverage?.status === 'full' ? (
            <Badge label={`${coverage.daysWithData} days`} variant="success" />
          ) : null
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 px-2">
          {/* Range */}
          <div className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
              {isCustom ? 'Date Range' : tab === 'weekly' ? 'Week' : 'Month'}
            </h4>

            {isCustom ? (
              <>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                    From
                  </label>
                  <DatePicker
                    value={customFrom}
                    max={customTo || undefined}
                    onChange={setCustomFrom}
                    testId="custom-from"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                    To
                  </label>
                  <DatePicker
                    value={customTo}
                    min={customFrom || undefined}
                    onChange={setCustomTo}
                    testId="custom-to"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                  {tab === 'weekly' ? 'Any day in the week' : 'Any day in the month'}
                </label>
                <DatePicker
                  value={tab === 'weekly' ? weekAnchor : monthAnchor}
                  max={todayUTC()}
                  onChange={tab === 'weekly' ? setWeekAnchor : setMonthAnchor}
                  testId="preset-anchor"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                Scale
              </label>
              <SelectMenu
                value={scale}
                onChange={setScale}
                options={scaleOptions}
                testId="report-scale"
              />
            </div>

            <p className="text-[11px] text-slate-500 leading-snug" data-testid="report-range-label">
              {formatWindowLabel(range.from, range.to)} · {spanDays} day(s)
              {checking ? ' · checking coverage…' : ''}
            </p>
          </div>

          {/* Contents */}
          <div className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
              {isCustom ? 'Sections to Include' : 'Report Contents'}
            </h4>

            {isCustom ? (
              <div className="flex flex-col gap-2">
                {CUSTOM_METRICS.map((m) => {
                  const checked = metrics.includes(m.key);
                  const rawInPdf = m.key === SECTIONS.RAW && format === 'PDF';
                  return (
                    <label
                      key={m.key}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                        checked
                          ? 'bg-sky/10 border-sky/40 text-white'
                          : 'bg-ink-800/40 border-ink-600 text-slate-300 hover:border-ink-600'
                      } ${rawInPdf ? 'opacity-50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMetric(m.key)}
                        data-testid={`metric-${m.key}`}
                        className="accent-sky w-4 h-4"
                      />
                      <span className="text-sm font-medium">{m.label}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <ul className="text-sm text-slate-300 space-y-2">
                {[
                  'Coverage statement & missing days',
                  'Totals, averages and heaviest day',
                  'Per-scale status — readings, total, min/max, average',
                  'Category distribution',
                  'Service-period distribution',
                  ...(tab === 'monthly'
                    ? ['Week-on-week comparison', 'Sample-collection heatmap']
                    : []),
                  'Day-by-day detail',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-sky shrink-0" />
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Format + generate */}
          <div className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
              Format
            </h4>

            {isCustom ? (
              <div className="grid grid-cols-2 gap-2">
                {['CSV', 'PDF'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormat(f)}
                    data-testid={`format-${f.toLowerCase()}`}
                    className={`h-11 rounded-xl text-sm font-semibold transition-all inline-flex items-center justify-center gap-2 ${
                      format === f
                        ? 'bg-sky-gradient text-ink-900 shadow-glow'
                        : 'bg-ink-800/60 border border-ink-600 text-slate-300 hover:text-white'
                    }`}
                  >
                    {f === 'PDF' ? (
                      <FileText className="w-4 h-4" />
                    ) : (
                      <FileSpreadsheet className="w-4 h-4" />
                    )}
                    {f}
                  </button>
                ))}
              </div>
            ) : (
              <div className="h-11 rounded-xl bg-ink-800/40 border border-ink-600 inline-flex items-center gap-2 px-4 text-sm text-slate-300 w-full">
                <FileText className="w-4 h-4 text-sky" /> PDF document
              </div>
            )}

            <button
              type="button"
              onClick={generate}
              disabled={generating || coverage?.status === 'empty'}
              data-testid="generate-report-btn"
              className="btn-sky h-12 w-full disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              {generating ? (
                <>
                  <LoadingSpinner size={17} /> Building
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" /> Generate {isCustom ? format : 'PDF'}
                </>
              )}
            </button>

            <p className="text-[11px] text-slate-500 leading-snug">
              {isCustom && format === 'PDF' && metrics.includes(SECTIONS.RAW)
                ? 'Raw readings are omitted from PDFs — thousands of rows are unreadable in a document. Switch to CSV for the full set.'
                : isCustom && format === 'CSV'
                ? 'CSV carries every section as one flat sheet, raw readings included.'
                : 'Per-scale status stands in for raw rows: readings, total, min/max and average per device.'}
            </p>
          </div>
        </div>
      </ChartCard>
    </div>
  );
}

/* ------------------------------ exporters ------------------------------ */

/** Custom PDF: whichever sections were ticked, minus raw. */
function customSections(report) {
  const s = report.sections || {};
  const out = [];

  if (s.total) {
    out.push({ type: 'heading', text: 'Totals' });
    out.push({
      type: 'kv',
      items: [
        ['Total waste', `${s.total.totalKg.toLocaleString('en-CA')} kg`],
        ['Deposits', s.total.deposits.toLocaleString('en-CA')],
        ['Daily average', `${s.total.avgPerActiveDayKg} kg`],
        ['Scales reporting', String(s.total.scalesReporting)],
      ],
    });
  }
  if (s.category?.length) {
    out.push({ type: 'heading', text: 'Category Breakdown' });
    out.push({
      type: 'table',
      columns: ['Category', 'Waste (kg)', 'Deposits', '% of Total'],
      rows: s.category.map((c) => [c.name, c.value, c.deposits, `${c.pctOfTotal}%`]),
    });
  }
  if (s.scale?.length) {
    out.push({ type: 'heading', text: 'Scale Status' });
    out.push({
      type: 'table',
      columns: ['Scale', 'Readings', 'Deposits', 'Total (kg)', 'Min', 'Max', 'Avg'],
      rows: s.scale.map((x) => [
        `${x.name} (${x.uid})`,
        x.readings ?? '—',
        x.deposits ?? '—',
        x.totalKg,
        x.minKg ?? '—',
        x.maxKg ?? '—',
        x.avgKg ?? '—',
      ]),
    });
  }
  if (s.meals?.rows?.length) {
    out.push({ type: 'heading', text: 'Service Periods' });
    out.push({
      type: 'table',
      columns: ['Period', 'Window', 'Waste (kg)', 'Deposits'],
      rows: s.meals.rows.map((m) => [m.label, m.window, m.value, m.deposits]),
    });
  }
  if (s.daily?.length) {
    out.push({ type: 'heading', text: 'Daily Totals' });
    out.push({
      type: 'table',
      columns: ['Date', 'Day', 'Waste (kg)', 'Deposits'],
      rows: s.daily.map((d) => [d.date, d.day, d.value, d.hasData ? d.deposits : 'no data']),
    });
  }
  if (s.raw) {
    out.push({
      type: 'callout',
      text: `${s.raw.totalAvailable} raw readings are available for this range. Export as CSV to include them.`,
    });
  }
  return out;
}

/**
 * CSV export — one flat sheet with a leading Section column.
 *
 * A single attachment is the one that actually gets opened, and a Section
 * column keeps it filterable in Excel without splitting the data across files.
 */
function exportCSV(file, report, cov, rangeLabel) {
  const s = report.sections || {};
  const cols = ['Section', 'Item', 'Detail', 'Value'];
  const rows = [
    ['Coverage', 'Requested', `${cov.requested?.from} → ${cov.requested?.to}`, `${cov.daysRequested} day(s)`],
    ['Coverage', 'Contains data', rangeLabel, `${cov.daysWithData} day(s)`],
    ['Coverage', 'Status', cov.status, cov.message || ''],
  ];
  (cov.missing || []).forEach((m) =>
    rows.push(['Coverage', 'Missing', m.from === m.to ? m.from : `${m.from} → ${m.to}`, 'no readings'])
  );

  if (s.total) {
    rows.push(['Totals', 'Total waste', 'All selected scales', `${s.total.totalKg} kg`]);
    rows.push(['Totals', 'Deposits', '', String(s.total.deposits)]);
    rows.push(['Totals', 'Daily average', `over ${s.total.daysWithData} reporting day(s)`, `${s.total.avgPerActiveDayKg} kg`]);
    rows.push(['Totals', 'Scales reporting', '', String(s.total.scalesReporting)]);
    if (s.total.peakDay) {
      rows.push(['Totals', 'Peak day', s.total.peakDay.date, `${s.total.peakDay.value} kg`]);
    }
  }
  (s.category || []).forEach((c) =>
    rows.push(['Category', c.name, `${c.deposits} deposit(s)`, `${c.value} kg (${c.pctOfTotal}%)`])
  );
  (s.scale || []).forEach((x) =>
    rows.push([
      'Scale',
      `${x.uid} · ${x.name}`,
      x.reportedInRange
        ? `${x.readings ?? '—'} readings · min ${x.minKg ?? '—'} · max ${x.maxKg ?? '—'} · avg ${x.avgKg ?? '—'}`
        : 'no readings in range',
      `${x.totalKg} kg`,
    ])
  );
  (s.meals?.rows || []).forEach((m) =>
    rows.push(['Service period', m.label, m.window, `${m.value} kg · ${m.deposits} deposit(s)`])
  );
  (s.daily || []).forEach((d) =>
    rows.push(['Daily', d.date, d.hasData ? `${d.deposits} deposit(s)` : 'no data', `${d.value} kg`])
  );

  if (s.raw) {
    rows.push([
      'Raw',
      '—',
      `${s.raw.count} of ${s.raw.totalAvailable} row(s)`,
      s.raw.truncated ? 'TRUNCATED — raise the limit for the full set' : 'complete',
    ]);
    // Header row for the raw block, so the columns are labelled inline.
    rows.push(['Raw', 'UID', 'Date / Time', 'PerDeposit / RunningTotal / Messages']);
    s.raw.rows.forEach((r) =>
      rows.push([
        'Raw',
        r[0],
        `${r[1]} ${r[2]}`,
        `${r[3]} | ${r[4]} | ${r[5]} | ${r[6]} | ${r[7]}`,
      ])
    );
  }

  downloadCSV(file, cols, rows);
}
