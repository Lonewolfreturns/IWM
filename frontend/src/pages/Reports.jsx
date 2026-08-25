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
import { getCurrentUser } from '../services/auth';
import { buildReport, getReportCoverage, SECTIONS } from '../services/reports';
import {
  defaultWindow, validateWindow, formatWindowLabel, daysInWindow, shiftDays, todayUTC,
} from '../lib/dataWindow';
import {
  weeklySections, monthlySections, monthLabel, coverageSections,
  summarySections, scaleSections, categorySections, mealSections, dailySections,
  weeklyBuckets,
} from '../lib/reportBuilders';
import { downloadXLSX, downloadPDF } from '../lib/fileExport.js';

const TABS = [
  { key: 'weekly', label: 'Weekly Report', Icon: CalendarRange },
  { key: 'monthly', label: 'Monthly Report', Icon: CalendarRange },
  { key: 'custom', label: 'Custom Export', Icon: FileSpreadsheet },
];

/**
 * Sections each preset asks the API for.
 *
 * `raw` is left out of the PDF set on purpose. A PDF is a document people read,
 * and several thousand telemetry rows in one is unreadable — the per-scale
 * status block answers the same "is this number real" question in a form that
 * fits on a page.
 *
 * That argument is about the medium, not the report, so it does not carry to a
 * workbook: a weekly Excel export gets the raw rows too, on their own sheet
 * where they can be filtered and summed.
 */
const PRESET_SECTIONS = [
  SECTIONS.TOTAL, SECTIONS.CATEGORY, SECTIONS.SCALE, SECTIONS.MEALS, SECTIONS.DAILY,
];

const PRESET_SECTIONS_XLSX = [...PRESET_SECTIONS, SECTIONS.RAW];

/**
 * Builds the suggested download name.
 *
 * The old names were `iwm_export_<from>_<to>` — every custom export of the same
 * range landed in Downloads with an identical name, so the second one became
 * "(1)" and nobody could tell which scale or which sections it held.
 *
 * Shape: IWM_<kind>_<who>_<range>_<sections>
 *
 *   kind      Weekly / Monthly / Custom, because the same week exported from
 *             two different tabs holds different things.
 *   who       the scale, when one is selected; otherwise the person who ran it,
 *             since an all-scales export is only identifiable by who asked.
 *   range     the dates the data actually covers, not the ones typed.
 *   sections  which parts were included, so two exports of the same window are
 *             still told apart.
 */
// Characters Windows and POSIX genuinely refuse in a filename, plus control
// characters. Deliberately not a strip-to-ASCII rule: someone typing an
// accented word should get it back, not have every letter with a diacritic
// deleted. Windows has supported Unicode filenames for decades.
const FILENAME_ILLEGAL = /[\\/:*?"<>|\u0000-\u001F]+/g;

// Windows also reserves these names outright, extension or not.
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Long enough for the fullest generated name (~90 chars), short enough that a
// pasted essay cannot push the path past what Explorer will open.
const FILENAME_MAX = 120;

function slug(value) {
  const cleaned = String(value || '')
    .replace(FILENAME_ILLEGAL, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    // Leading and trailing dots hide the file on POSIX and are dropped by
    // Windows, either of which turns the name into something else.
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, FILENAME_MAX)
    .replace(/[-.]+$/g, '');
  return RESERVED_NAMES.test(cleaned) ? `${cleaned}-export` : cleaned;
}

function suggestFilename({ tab, scale, user, from, to, sections }) {
  const kind = tab === 'weekly' ? 'Weekly' : tab === 'monthly' ? 'Monthly' : 'Custom';

  // One scale names itself. For "all scales" there is no single subject, so the
  // export is tagged with whoever produced it — the local part of the email
  // only, since the domain adds length without adding identity.
  const who =
    scale !== 'all'
      ? slug(scale)
      : slug((user?.email || '').split('@')[0] || user?.name || 'all-scales');

  const range = from === to ? slug(from) : `${slug(from)}_to_${slug(to)}`;

  // Ordered by SECTION_ORDER rather than click order, so the same selection
  // always produces the same name.
  const picked = SECTION_ORDER.filter((k) => sections.includes(k)).join('-');

  return ['IWM', kind, who, range, picked].filter(Boolean).join('_');
}

// Fixed order, so a name is stable regardless of the order boxes were ticked.
const SECTION_ORDER = [
  SECTIONS.TOTAL, SECTIONS.CATEGORY, SECTIONS.SCALE,
  SECTIONS.MEALS, SECTIONS.DAILY, SECTIONS.RAW,
];

const CUSTOM_METRICS = [
  { key: SECTIONS.TOTAL, label: 'Totals & averages' },
  { key: SECTIONS.CATEGORY, label: 'Category breakdown' },
  { key: SECTIONS.SCALE, label: 'Per-scale status' },
  { key: SECTIONS.MEALS, label: 'Service periods' },
  { key: SECTIONS.DAILY, label: 'Daily totals' },
  { key: SECTIONS.RAW, label: 'Raw readings (Excel only)' },
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
  const [format, setFormat] = useState('Excel');
  // Empty means "use the suggested name". Kept as an override rather than
  // seeding the box with the suggestion, so the name keeps tracking the
  // scale/range/section pickers until the moment someone types their own.
  const [customName, setCustomName] = useState('');
  // Parsed from localStorage on every call, so it would be a new object each
  // render and defeat the memo below. The signed-in user does not change while
  // this page is mounted.
  const user = useMemo(() => getCurrentUser(), []);

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
    const isXlsx = format === 'Excel';
    const wanted = isCustom
      ? metrics
      : isXlsx ? PRESET_SECTIONS_XLSX : PRESET_SECTIONS;
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

    // Every tab now offers both formats. The workbook is section-driven and so
    // builds itself from whatever the report came back with — the three presets
    // differ only in the range they asked for and what the file is called.
    //
    // The name is built from the range the data actually covers, so a file is
    // never labelled with a window its own figures were not filtered to.
    const stem =
      slug(customName) ||
      suggestFilename({
        tab, scale, user, from: actual.from, to: actual.to, sections: wanted,
      });

    const preset = {
      stem,
      title: isCustom
        ? 'Custom waste report'
        : tab === 'weekly'
        ? 'Weekly waste report'
        : `Monthly waste report — ${monthLabel(range.from, range.to)}`,
    };

    if (isXlsx) {
      exportWorkbook(`${preset.stem}.xlsx`, report, cov, scopeLabel, preset.title);
    } else if (isCustom) {
      downloadPDF(`${preset.stem}.pdf`, {
        title: 'Custom Waste Report',
        subtitle: scopeLabel,
        dateRange: rangeLabel,
        sections: [...coverageSections(cov), ...customSections(report)],
      });
    } else if (tab === 'weekly') {
      downloadPDF(`${preset.stem}.pdf`, {
        title: 'Weekly Waste Report',
        subtitle: scopeLabel,
        dateRange: rangeLabel,
        sections: weeklySections(report),
      });
    } else {
      downloadPDF(`${preset.stem}.pdf`, {
        title: `Monthly Waste Report — ${monthLabel(range.from, range.to)}`,
        subtitle: scopeLabel,
        dateRange: rangeLabel,
        sections: monthlySections(report),
      });
    }

    toast.success('Report generated', {
      description: `${preset.stem}.${isXlsx ? 'xlsx' : 'pdf'}${
        cov.complete ? '' : ' · partial coverage'
      }`,
    });
  };

  const isCustom = tab === 'custom';
  const spanDays = daysInWindow(range.from, range.to);

  // Shown as the input's placeholder so the name is visible before generating,
  // and updates live as the pickers change. Built from the requested range
  // because coverage is not known until the report comes back — the file itself
  // is named from the range the data actually covers.
  const suggestedName = useMemo(
    () =>
      suggestFilename({
        tab,
        scale,
        user,
        from: range.from,
        to: range.to,
        sections: isCustom
          ? metrics
          : format === 'Excel' ? PRESET_SECTIONS_XLSX : PRESET_SECTIONS,
      }),
    [tab, scale, user, range.from, range.to, isCustom, metrics, format]
  );

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
                  // The monthly extras are drawn by the PDF builder; the
                  // workbook covers the same ground with its own sheets.
                  ...(tab === 'monthly' && format === 'PDF'
                    ? ['Week-on-week comparison', 'Sample-collection heatmap']
                    : []),
                  'Day-by-day detail',
                  ...(format === 'Excel' ? ['Every individual reading'] : []),
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

            <div className="grid grid-cols-2 gap-2">
              {['Excel', 'PDF'].map((f) => (
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

            <div className="space-y-1.5 pt-1">
              <label
                htmlFor="report-filename"
                className="text-xs uppercase tracking-wider text-slate-400 font-semibold"
              >
                File name
              </label>
              <div className="flex items-center rounded-xl bg-ink-800/60 border border-ink-600 focus-within:border-sky/50 transition-colors">
                <input
                  id="report-filename"
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder={suggestedName}
                  data-testid="report-filename"
                  className="flex-1 min-w-0 h-11 bg-transparent px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                />
                <span className="shrink-0 pr-3 text-xs text-slate-500 font-mono">
                  .{format === 'Excel' ? 'xlsx' : 'pdf'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-snug">
                {customName
                  ? 'Using your name. Clear the box to go back to the suggested one.'
                  : 'Leave blank to use the suggested name, which follows the scale, range and sections you picked.'}
              </p>
            </div>

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
                  <Plus className="w-4 h-4" /> Generate {format}
                </>
              )}
            </button>

            <p className="text-[11px] text-slate-500 leading-snug">
              {format === 'PDF' && isCustom && metrics.includes(SECTIONS.RAW)
                ? 'Raw readings are omitted from PDFs — thousands of rows are unreadable in a document. Switch to Excel for the full set.'
                : format === 'Excel'
                ? 'One sheet per section, plus a plain-English overview. Raw readings get a column each, so they can be sorted and summed.'
                : 'A written document with charts. Per-scale status stands in for raw rows: readings, total, min/max and average per device.'}
            </p>
          </div>
        </div>
      </ChartCard>
    </div>
  );
}

/* ------------------------------ exporters ------------------------------ */

/** Custom PDF: whichever sections were ticked, minus raw. */
/**
 * Sections for the Custom PDF.
 *
 * Previously this built its own tables-only version of every section, so the
 * Custom report was the one PDF in the app with no charts in it at all - pages
 * of numbers with nothing to look at. The weekly and monthly reports already
 * had a charted builder for each section, so this now composes those instead
 * of maintaining a second, poorer copy.
 *
 * The user chooses which sections appear, so each is included only when the
 * report actually carries it.
 */
function customSections(report) {
  const s = report.sections || {};
  const out = [
    ...summarySections(s.total),
    ...categorySections(s.category),
    ...scaleSections(s.scale),
    ...mealSections(s.meals),
    ...dailySections(s.daily),
  ];

  if (s.raw) {
    out.push({
      type: 'callout',
      text: `${s.raw.totalAvailable} individual readings sit behind this report. A PDF cannot usefully hold them - choose Excel to get them as a sortable sheet.`,
    });
  }
  return out;
}

/* ------------------------------ Exports ------------------------------ */

// A date the report knows as 2026-08-24 reads as "24 Aug 2026" to everyone,
// including the people who will never open the raw sheet.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function prettyDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso || '—';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

function prettyRange(from, to) {
  if (!from || !to) return '—';
  return from === to ? prettyDate(from) : `${prettyDate(from)} to ${prettyDate(to)}`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The raw readings, split into one column per field.
 *
 * These used to be crushed into a single cell as
 * "0.05 | 0 |  |  | someone@example.com", which is unusable: you cannot sum a
 * pipe-delimited string, sort by weight, or filter by message. The device
 * export has eight distinct fields and so does this.
 */
const RAW_HEADERS = [
  'Scale ID', 'Date', 'Time', 'Deposit (kg)', 'Running total (kg)',
  'Message 1', 'Message 2', 'Message 3',
];

const RAW_WIDTHS = [16, 12, 10, 13, 18, 30, 22, 22];

function rawSheetRows(raw) {
  const head = RAW_HEADERS.map((h) => ({ v: h, s: 'head' }));
  // Weights stay numeric so the sheet can be summed, sorted and charted;
  // everything else is text. `?? ''` rather than `|| ''` keeps a genuine 0.
  const body = (raw.rows || []).map((r) => [
    r[0], r[1], r[2],
    typeof r[3] === 'number' ? r[3] : Number(r[3]) || 0,
    typeof r[4] === 'number' ? r[4] : Number(r[4]) || 0,
    r[5] ?? '', r[6] ?? '', r[7] ?? '',
  ]);
  return [head, ...body];
}

/**
 * Sheet 1 — written for someone who has never seen a scale reading.
 *
 * Every figure gets a "what this means" column beside it. The numbers on their
 * own invite exactly the wrong reading: a running total that goes negative
 * looks like an error, a partial range looks like missing kilograms rather
 * than days the kitchen simply did not report, and "8701 rows" means nothing
 * to anyone who is not about to write a query against them.
 */
function overviewSheet(report, cov, scopeLabel, reportTitle) {
  const s = report.sections || {};
  const actual = cov.actual || {};
  const requested = cov.requested || {};
  const rows = [];

  const blank = () => rows.push([]);
  const heading = (text) => rows.push([{ v: text, s: 'bold' }]);
  const item = (label, value, meaning) =>
    rows.push([label, value, { v: meaning || '', s: 'wrap' }]);

  rows.push([{ v: reportTitle || 'Food waste report', s: 'title' }]);
  rows.push([{ v: `${prettyRange(actual.from, actual.to)} · ${scopeLabel}`, s: 'muted' }]);
  blank();

  heading('What this report covers');
  rows.push([
    { v: 'Item', s: 'head' }, { v: 'Value', s: 'head' }, { v: 'What it means', s: 'head' },
  ]);
  item(
    'Dates you asked for',
    prettyRange(requested.from, requested.to),
    `The window requested when this report was generated — ${plural(cov.daysRequested ?? 0, 'day', 'days')} in total.`
  );
  item(
    'Dates with readings',
    prettyRange(actual.from, actual.to),
    'The report only describes these dates. Everything below is measured over this window, not the one above.'
  );
  item(
    'Days that reported',
    `${cov.daysWithData ?? 0} of ${cov.daysRequested ?? 0}`,
    'A scale only sends a reading when something is thrown away, so a day with no readings usually means the kitchen was closed or the bin was untouched — not that data was lost.'
  );
  item('Scales included', scopeLabel, 'Which scales the figures below are drawn from.');
  blank();

  if (s.total) {
    heading('The headline numbers');
    rows.push([
      { v: 'Item', s: 'head' }, { v: 'Value', s: 'head' }, { v: 'What it means', s: 'head' },
    ]);
    item(
      'Total food waste',
      `${s.total.totalKg} kg`,
      'Everything weighed across every included scale over the reporting window.'
    );
    item(
      'Number of deposits',
      s.total.deposits,
      'How many separate times something was put on a scale. One deposit is one trip to the bin.'
    );
    item(
      'Average per reporting day',
      `${s.total.avgPerActiveDayKg} kg`,
      `Total waste divided by the ${plural(s.total.daysWithData ?? 0, 'day', 'days')} that actually reported. Days with no readings are left out, so a quiet week does not flatter the average.`
    );
    item(
      'Scales that reported',
      s.total.scalesReporting,
      'How many scales sent at least one reading during the window.'
    );
    if (s.total.peakDay) {
      item(
        'Busiest day',
        `${prettyDate(s.total.peakDay.date)} — ${s.total.peakDay.value} kg`,
        'The single day with the most waste recorded. Worth checking against the menu or a known event.'
      );
    }
    blank();
  }

  heading("How complete is this?");
  rows.push([
    { v: 'Item', s: 'head' }, { v: 'Value', s: 'head' }, { v: 'What it means', s: 'head' },
  ]);
  const gaps = (cov.missing || []).length;
  item(
    'Coverage',
    cov.complete ? 'Complete' : 'Partial',
    cov.complete
      ? 'Every day in the requested range has readings behind it.'
      : `${plural(gaps, 'stretch', 'stretches')} of the requested range had no readings at all. They are listed on the "Coverage gaps" sheet. The totals above simply do not include those days.`
  );
  if (s.raw) {
    item(
      'Individual readings included',
      s.raw.truncated
        ? `${s.raw.count} of ${s.raw.totalAvailable}`
        : `${s.raw.totalAvailable} (all of them)`,
      s.raw.truncated
        ? `The "Raw readings" sheet holds the ${s.raw.count} most recent readings. There are ${s.raw.totalAvailable} in this window — raise the row limit before generating if you need every one. The summary figures above are calculated from all ${s.raw.totalAvailable}, not just the ones listed.`
        : 'Every individual reading in this window is listed on the "Raw readings" sheet.'
    );
  }
  blank();

  heading("What's in this workbook");
  rows.push([
    { v: 'Sheet', s: 'head' }, { v: 'Holds', s: 'head' }, { v: '', s: 'head' },
  ]);
  if (s.daily) rows.push(['Daily totals', 'One row per day: how much was thrown away and how many deposits.']);
  if (s.daily?.length > 7) rows.push(['Week by week', 'The same figures grouped into calendar weeks, for comparing one week against the next.']);
  if (s.scale) rows.push(['By scale', 'One row per scale, so you can see which kitchen or station contributes most.']);
  if (s.category) rows.push(['By category', 'Waste grouped by the reason it was thrown away.']);
  if (s.meals) rows.push(['Service periods', 'Waste split across breakfast, lunch, dinner and so on.']);
  if (gaps) rows.push(['Coverage gaps', 'The date ranges with no readings, listed in full.']);
  if (s.raw) rows.push(['Raw readings', 'Every individual weighing, exactly as the scale recorded it.']);
  blank();

  if (s.raw) {
    heading('How to read the "Raw readings" sheet');
    rows.push([
      { v: 'Column', s: 'head' }, { v: 'What it is', s: 'head' }, { v: '', s: 'head' },
    ]);
    rows.push(['Scale ID', { v: 'The device that recorded the reading.', s: 'wrap' }]);
    rows.push(['Date / Time', { v: "When it was recorded, on the scale's own clock.", s: 'wrap' }]);
    rows.push([
      'Deposit (kg)',
      { v: 'The weight of that one deposit. This is the column to add up. A negative value means weight was taken off the scale — a bin being emptied, or a correction after something was placed by mistake.', s: 'wrap' },
    ]);
    rows.push([
      'Running total (kg)',
      { v: "The scale's own counter since it was last reset to zero. It is NOT how full the bin is, and it can read negative after a reset. Do not add this column up — use Deposit (kg) instead.", s: 'wrap' },
    ]);
    rows.push([
      'Message 1-3',
      { v: 'Optional notes the scale attached to the reading, such as the operator or the waste category. Often blank.', s: 'wrap' },
    ]);
  }

  return {
    name: 'Overview',
    cols: [28, 30, 78],
    rows,
  };
}

/**
 * XLSX export — the summary and the raw readings in one workbook, a sheet each.
 *
 * Replaces a single flat CSV that stacked six unrelated tables into the same
 * four columns and then jammed five raw fields into the last one. Each table
 * now keeps its own headers and its own column types, which is the difference
 * between a file you can pivot and a file you have to re-parse first.
 */
function exportWorkbook(file, report, cov, scopeLabel, reportTitle) {
  const s = report.sections || {};
  const sheets = [overviewSheet(report, cov, scopeLabel, reportTitle)];
  const head = (labels) => labels.map((h) => ({ v: h, s: 'head' }));

  if (s.daily) {
    sheets.push({
      name: 'Daily totals',
      cols: [14, 12, 14, 12, 14],
      freeze: true,
      autoFilter: true,
      rows: [
        head(['Date', 'Day', 'Waste (kg)', 'Deposits', 'Reported?']),
        ...s.daily.map((d) => [
          d.date,
          d.day,
          d.hasData ? d.value : '',
          d.hasData ? d.deposits : '',
          d.hasData ? 'Yes' : 'No readings',
        ]),
      ],
    });
  }

  if (s.scale) {
    sheets.push({
      name: 'By scale',
      cols: [16, 24, 12, 14, 14, 14, 14],
      freeze: true,
      autoFilter: true,
      rows: [
        head(['Scale ID', 'Name', 'Readings', 'Total (kg)', 'Smallest (kg)', 'Largest (kg)', 'Average (kg)']),
        ...s.scale.map((x) => [
          x.uid,
          x.name,
          x.reportedInRange ? x.readings ?? '' : '',
          x.totalKg,
          x.reportedInRange ? x.minKg ?? '' : '',
          x.reportedInRange ? x.maxKg ?? '' : '',
          x.reportedInRange ? x.avgKg ?? '' : '',
        ]),
      ],
    });
  }

  // The monthly PDF draws a week-on-week comparison; without this the workbook
  // would be the only output that cannot answer "was this week worse than last".
  // Keyed off the data rather than the tab, so a long custom range gets it too.
  if (s.daily && s.daily.length > 7) {
    sheets.push({
      name: 'Week by week',
      cols: [10, 14, 14, 14, 12, 16],
      freeze: true,
      rows: [
        head(['Week', 'From', 'To', 'Waste (kg)', 'Deposits', 'Days reporting']),
        ...weeklyBuckets(s.daily).map((b) => [
          b.label, b.from, b.to, b.value, b.deposits, b.days,
        ]),
      ],
    });
  }

  if (s.category) {
    sheets.push({
      name: 'By category',
      cols: [26, 12, 14, 16],
      freeze: true,
      autoFilter: true,
      rows: [
        head(['Category', 'Deposits', 'Waste (kg)', 'Share of total (%)']),
        ...s.category.map((c) => [c.name, c.deposits, c.value, c.pctOfTotal]),
      ],
    });
  }

  if (s.meals?.rows?.length) {
    sheets.push({
      name: 'Service periods',
      cols: [22, 20, 14, 12],
      freeze: true,
      rows: [
        head(['Period', 'Time window', 'Waste (kg)', 'Deposits']),
        ...s.meals.rows.map((m) => [m.label, m.window, m.value, m.deposits]),
      ],
    });
  }

  if ((cov.missing || []).length) {
    sheets.push({
      name: 'Coverage gaps',
      cols: [14, 14, 10, 46],
      freeze: true,
      rows: [
        head(['From', 'To', 'Days', 'Note']),
        ...cov.missing.map((m) => {
          // Both ends are ISO dates, so the difference is a plain day count.
          const days =
            Math.round((Date.parse(m.to) - Date.parse(m.from)) / 86400000) + 1;
          return [
            m.from,
            m.to,
            Number.isFinite(days) ? days : '',
            'No readings — the scales sent nothing on these dates.',
          ];
        }),
      ],
    });
  }

  if (s.raw) {
    sheets.push({
      name: 'Raw readings',
      cols: RAW_WIDTHS,
      freeze: true,
      autoFilter: true,
      rows: rawSheetRows(s.raw),
    });
  }

  downloadXLSX(file, sheets);
}

