// Turns a `/reports/build` payload into PDF section lists.
//
// Kept out of the page component because these are pure data->document
// transforms with real edge cases (empty ranges, partial coverage, months that
// start mid-week), and they are far easier to reason about — and to test —
// away from JSX.

import { WASTE_CATEGORIES, UNCATEGORISED } from '../data/mockData';

const CATEGORY_COLOR = Object.fromEntries(
  [...WASTE_CATEGORIES, UNCATEGORISED].map((c) => [c.key, c.color])
);

const MEAL_COLORS = {
  breakfast: '#F59E0B',
  lunch: '#22C55E',
  snacks: '#38BDF8',
  dinner: '#A78BFA',
  night: '#64748B',
  outside: '#475569',
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function kg(v) {
  return `${Number(v || 0).toLocaleString('en-CA')} kg`;
}

/* ---------------------------------------------------------------------- */
/* Shared blocks                                                           */
/* ---------------------------------------------------------------------- */

/**
 * Coverage always leads the document.
 *
 * A report is forwarded to people who were not looking at the filters when it
 * was generated. If it covers eleven days of a thirty-day month, the document
 * itself has to say so — nothing else in the export can.
 */
export function coverageSections(cov) {
  if (!cov) return [];
  const out = [];

  if (cov.status === 'partial') {
    out.push({
      type: 'callout',
      tone: 'warn',
      text: `Partial coverage — ${cov.daysWithData} of ${cov.daysRequested} days in this range hold readings. ${cov.message}`,
    });
  } else if (cov.status === 'empty') {
    out.push({ type: 'callout', tone: 'bad', text: cov.message });
  } else if (cov.status === 'full') {
    out.push({
      type: 'callout',
      text: `Full coverage — all ${cov.daysRequested} days in this range hold readings.`,
    });
  }

  if ((cov.missing || []).length) {
    out.push({
      type: 'table',
      columns: ['Days with no readings', 'Through'],
      rows: cov.missing.map((m) => [m.from, m.to]),
    });
  }
  return out;
}

function summarySections(total) {
  if (!total) return [];
  return [
    { type: 'heading', text: 'At a Glance' },
    {
      type: 'kv',
      items: [
        ['Total waste', kg(total.totalKg)],
        ['Deposits recorded', total.deposits.toLocaleString('en-CA')],
        ['Average per reporting day', kg(total.avgPerActiveDayKg)],
        ['Scales reporting', `${total.scalesReporting}`],
        ...(total.peakDay
          ? [['Heaviest day', `${total.peakDay.date} · ${kg(total.peakDay.value)}`]]
          : []),
        ['Days with data', `${total.daysWithData} of ${total.daysRequested}`],
      ],
    },
  ];
}

/**
 * Per-scale status — the replacement for dumping raw rows into the PDF.
 *
 * `minKg` arrives already floored at zero by the API: a negative minimum is a
 * bin removal or a tare correction, and "lightest deposit: −18 kg" is not a
 * fact about waste. `hadNegative` is surfaced separately, because a scale
 * producing large negatives is worth investigating even though the figure
 * does not belong in a deposit column.
 */
function scaleSections(scaleRows) {
  if (!scaleRows?.length) return [];

  const reporting = scaleRows.filter((s) => s.reportedInRange);
  const silent = scaleRows.filter((s) => !s.reportedInRange);
  const flagged = reporting.filter((s) => s.hadNegative);

  const out = [
    { type: 'heading', text: 'Scale Status' },
    {
      type: 'table',
      columns: ['Scale', 'Location', 'Readings', 'Deposits', 'Total', 'Min', 'Max', 'Avg'],
      rows: scaleRows.map((s) => [
        `${s.name}\n${s.uid}`,
        s.location,
        s.readings ?? '—',
        s.deposits ?? '—',
        s.totalKg != null ? `${s.totalKg}` : '—',
        s.minKg != null ? `${s.minKg}` : '—',
        s.maxKg != null ? `${s.maxKg}` : '—',
        s.avgKg != null ? `${s.avgKg}` : '—',
      ]),
    },
  ];

  if (reporting.length > 1) {
    out.push({
      type: 'barchart',
      unit: 'kg',
      height: 150,
      data: reporting
        .slice()
        .sort((a, b) => b.totalKg - a.totalKg)
        .slice(0, 10)
        .map((s) => ({
          label: s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name,
          sublabel: `${s.deposits} dep`,
          value: s.totalKg,
          color: '#38BDF8',
        })),
    });
  }

  if (silent.length) {
    out.push({
      type: 'callout',
      tone: 'warn',
      text: `${silent.length} provisioned scale${silent.length === 1 ? '' : 's'} reported nothing in this period: ${nameList(silent)}`,
    });
  }
  if (flagged.length) {
    out.push({
      type: 'callout',
      tone: 'warn',
      text: `${flagged.length} scale${flagged.length === 1 ? '' : 's'} recorded negative readings (bin removals or tare corrections): ${nameList(flagged)} Minimums are shown floored at 0 kg.`,
    });
  }
  return out;
}

/**
 * Joins scale names, capping the list.
 *
 * A thirty-scale fleet would otherwise put every name into a callout, and the
 * table directly above already carries the full detail — the callout only
 * needs to say how many and give enough examples to orient the reader.
 */
function nameList(rows, cap = 6) {
  const names = rows.map((s) => s.name);
  if (names.length <= cap) return `${names.join(', ')}.`;
  return `${names.slice(0, cap).join(', ')} and ${names.length - cap} more.`;
}

function categorySections(category) {
  if (!category?.length) return [];
  return [
    { type: 'heading', text: 'What Is Being Wasted' },
    {
      type: 'share',
      data: category.map((c) => ({
        label: c.name,
        value: c.value,
        color: CATEGORY_COLOR[c.name] || '#64748B',
      })),
    },
    {
      type: 'table',
      columns: ['Category', 'Waste (kg)', 'Deposits', '% of Total'],
      rows: category.map((c) => [c.name, c.value, c.deposits, `${c.pctOfTotal}%`]),
    },
  ];
}

function mealSections(meals) {
  if (!meals?.rows?.length) return [];
  return [
    { type: 'heading', text: 'When It Is Being Wasted' },
    {
      type: 'paragraph',
      text:
        meals.scheduleSource === 'scale'
          ? "Service windows are this scale's own configured times."
          : 'Service windows are the standard IWM periods. Selecting a single scale uses its own configured times instead.',
    },
    {
      type: 'barchart',
      unit: 'kg',
      height: 150,
      data: meals.rows.map((m) => ({
        label: m.label.length > 12 ? `${m.label.slice(0, 11)}…` : m.label,
        sublabel: m.window,
        value: m.value,
        color: MEAL_COLORS[m.key] || '#38BDF8',
      })),
    },
    {
      type: 'table',
      columns: ['Period', 'Window', 'Waste (kg)', 'Deposits'],
      rows: meals.rows.map((m) => [m.label, m.window, m.value, m.deposits]),
    },
  ];
}

function dailySections(daily, { chart = true } = {}) {
  if (!daily?.length) return [];
  const out = [{ type: 'heading', text: 'Day by Day' }];
  if (chart) {
    out.push({
      type: 'barchart',
      unit: 'kg',
      height: 150,
      data: daily.map((d) => ({
        label: d.day,
        sublabel: d.date.slice(5),
        value: d.value,
        // Days with no readings are drawn flat and grey rather than as a zero
        // bar, so an outage is visually distinct from a genuinely quiet day.
        color: d.hasData ? '#22C55E' : '#CBD5E1',
      })),
    });
  }
  out.push({
    type: 'table',
    columns: ['Date', 'Day', 'Waste (kg)', 'Deposits'],
    rows: daily.map((d) => [d.date, d.day, d.value, d.hasData ? d.deposits : 'no data']),
  });
  return out;
}

/* ---------------------------------------------------------------------- */
/* Weekly                                                                  */
/* ---------------------------------------------------------------------- */

export function weeklySections(report) {
  const s = report.sections || {};
  return [
    ...coverageSections(report.coverage),
    ...summarySections(s.total),
    ...scaleSections(s.scale),
    ...categorySections(s.category),
    ...mealSections(s.meals),
    ...dailySections(s.daily),
  ];
}

/* ---------------------------------------------------------------------- */
/* Monthly                                                                 */
/* ---------------------------------------------------------------------- */

/** Groups daily rows into calendar weeks for the comparison chart. */
export function weeklyBuckets(daily) {
  if (!daily?.length) return [];
  const buckets = [];
  let current = null;

  daily.forEach((d) => {
    const date = new Date(`${d.date}T00:00:00Z`);
    const dow = date.getUTCDay();
    // A new bucket starts on Sunday, or at the very first row — so a month
    // beginning mid-week yields a short opening week rather than silently
    // folding those days into the one before it.
    if (!current || dow === 0) {
      current = { label: `W${buckets.length + 1}`, from: d.date, to: d.date, value: 0, deposits: 0, days: 0 };
      buckets.push(current);
    }
    current.to = d.date;
    current.value += Number(d.value) || 0;
    current.deposits += Number(d.deposits) || 0;
    if (d.hasData) current.days += 1;
  });

  return buckets.map((b) => ({ ...b, value: Math.round(b.value * 10) / 10 }));
}

/**
 * Lays daily rows out as calendar weeks, padded to real weekday columns.
 *
 * Padding matters: without it the first row starts on the wrong column and
 * every weekday reads one place off, which is exactly the pattern a heatmap
 * exists to reveal.
 */
export function calendarWeeks(daily, key = 'deposits') {
  if (!daily?.length) return [];
  const weeks = [];
  let week = new Array(7).fill(null);

  daily.forEach((d, i) => {
    const date = new Date(`${d.date}T00:00:00Z`);
    const dow = date.getUTCDay();
    if (i > 0 && dow === 0) {
      weeks.push(week);
      week = new Array(7).fill(null);
    }
    week[dow] = {
      day: date.getUTCDate(),
      value: Number(d[key]) || 0,
      date: d.date,
    };
  });
  weeks.push(week);
  return weeks;
}

export function monthlySections(report) {
  const s = report.sections || {};
  const daily = s.daily || [];
  const buckets = weeklyBuckets(daily);

  const sections = [
    ...coverageSections(report.coverage),
    ...summarySections(s.total),
  ];

  if (buckets.length > 1) {
    sections.push({ type: 'heading', text: 'Week on Week' });
    sections.push({
      type: 'paragraph',
      text: 'Each bar is one calendar week in the period. Weeks are cut on Sunday, so a month starting mid-week opens with a short week.',
    });
    sections.push({
      type: 'groupedbar',
      unit: 'kg',
      height: 160,
      series: [
        { key: 'value', label: 'Waste (kg)', color: '#38BDF8' },
        { key: 'deposits', label: 'Deposits', color: '#22C55E' },
      ],
      data: buckets.map((b) => ({
        label: b.label,
        value: b.value,
        deposits: b.deposits,
      })),
    });
    sections.push({
      type: 'table',
      columns: ['Week', 'From', 'To', 'Waste (kg)', 'Deposits', 'Days with data'],
      rows: buckets.map((b) => [b.label, b.from, b.to, b.value, b.deposits, b.days]),
    });
  }

  if (daily.length) {
    sections.push({ type: 'heading', text: 'Sample Collection Heatmap' });
    sections.push({
      type: 'paragraph',
      text: 'Readings collected per day. Darker is busier; blank squares fall outside the selected range.',
    });
    sections.push({
      type: 'heatmap',
      legend: 'readings',
      weeks: calendarWeeks(daily, 'deposits'),
    });
  }

  sections.push(
    ...scaleSections(s.scale),
    ...categorySections(s.category),
    ...mealSections(s.meals),
    // The day-by-day table is kept but its chart dropped — the heatmap above
    // already carries that shape, and a second view of it earns nothing.
    ...dailySections(daily, { chart: false })
  );

  return sections;
}

/** "June 2026", or the raw range when it isn't a clean single month. */
export function monthLabel(from, to) {
  if (!from || !to) return '';
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) {
    return `${MONTH_NAMES[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  }
  return `${from} → ${to}`;
}
