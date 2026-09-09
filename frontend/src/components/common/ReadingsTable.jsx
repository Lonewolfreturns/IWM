import { useMemo, useState } from 'react';
import DataTable from './DataTable.jsx';
import Badge from './Badge.jsx';
import SelectMenu from './SelectMenu.jsx';
import { formatDate, formatTime, timeZoneAbbr } from '../../lib/time.js';
import { useTimeZonePreference } from '../../lib/timeZonePreference.jsx';

// Renders raw scale telemetry in the exact shape the real device export
// uses: UID, Date, Time, PerDepositWeight, RunningTotalWeight, Message1,
// Message2, Message3. Shared by Dashboard, Analytics and Reports so
// every "readings" table in the app stays in lockstep with the real schema.

const MESSAGE_VARIANT = {
  'Bin Dumped': 'warning',
  'System Tared': 'info',
  'System Reboot': 'danger',
  'Wifi Reconnected': 'info',
};

function MessageCell({ value }) {
  if (!value) return <span className="text-slate-600">—</span>;
  return <Badge label={value} variant={MESSAGE_VARIANT[value] || 'neutral'} dot />;
}

// Never let a malformed/missing numeric field crash the table — render "—" instead.
function fmtKg(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value.toFixed(2) : '—';
}

/**
 * Columns are built per-render because Date and Time depend on the viewer's
 * chosen zone.
 *
 * `zones` maps UID -> the zone each scale records in (its source zone).
 * `displayZone` is what the viewer asked to read in; null means "show each
 * row in its own scale's time", which renders the stored value untouched.
 */
export function buildReadingsColumns(zones = {}, displayZone = null) {
  const sourceOf = (r) => zones[r.uid] || null;
  const shownIn = (r) => displayZone || sourceOf(r);
  return [
    { key: 'uid', label: 'UID', sortable: true, cellClassName: 'font-medium text-white whitespace-nowrap', render: (r) => r.uid ?? '—' },
    {
      key: 'date',
      label: 'Date',
      sortable: true,
      cellClassName: 'whitespace-nowrap text-slate-400 tabular-nums',
      render: (r) =>
        r.dateTime ? formatDate(r.dateTime, sourceOf(r), displayZone) : r.date ?? '—',
    },
    {
      key: 'time',
      label: 'Time',
      cellClassName: 'whitespace-nowrap text-slate-400 tabular-nums',
      render: (r) => (
        <span
          title={
            shownIn(r)
              ? `${timeZoneAbbr(shownIn(r))} · ${shownIn(r)}`
              : 'Scale has no time zone set — shown as recorded'
          }
        >
          {r.dateTime ? formatTime(r.dateTime, sourceOf(r), displayZone) : r.time ?? '—'}
        </span>
      ),
    },
    {
      key: 'perDepositWeight',
      label: 'Per Deposit (kg)',
      sortable: true,
      cellClassName: 'tabular-nums font-semibold text-white',
      render: (r) => fmtKg(r.perDepositWeight),
    },
    {
      key: 'runningTotalWeight',
      label: 'Running Total (kg)',
      sortable: true,
      cellClassName: 'tabular-nums text-slate-200',
      render: (r) => fmtKg(r.runningTotalWeight),
    },
    { key: 'message1', label: 'Message 1', render: (r) => <MessageCell value={r.message1} /> },
    { key: 'message2', label: 'Message 2', render: (r) => <MessageCell value={r.message2} /> },
  ];
}

// Default column set, for callers that have no per-scale zone information.
export const READINGS_COLUMNS = buildReadingsColumns();

// Flat [UID, Date, Time, PerDepositWeight, RunningTotalWeight, Message1, Message2]
// rows — matches the real CSV export column order, for CSV/report generation.
export function toRawRows(data) {
  return (data || []).map((r) => [
    r.uid ?? '',
    r.date ?? '',
    r.time ?? '',
    fmtKg(r.perDepositWeight),
    fmtKg(r.runningTotalWeight),
    r.message1 || '',
    r.message2 || '',
  ]);
}

export const RAW_COLUMN_HEADERS = [
  'UID', 'Date', 'Time', 'PerDepositWeight', 'RunningTotalWeight', 'Message1', 'Message2',
];

export default function ReadingsTable({
  data,
  testId,
  pageSize = 8,
  searchableKeys = ['uid', 'message1', 'message2'],
  emptyLabel = 'No readings found.',
  zones,
  // Filters are opt-in: the Reports preview and other embeds already scope
  // their own data and would only be cluttered by a second set of controls.
  filterable = false,
}) {
  // Read straight from the preference so every readings table in the app
  // follows the sidebar picker without each page having to thread it down.
  const { fixedZone } = useTimeZonePreference();
  const columns = useMemo(
    () => buildReadingsColumns(zones || {}, fixedZone),
    [zones, fixedZone]
  );

  const [uid, setUid] = useState('');

  const rows = Array.isArray(data) ? data : [];

  // Only the scales actually present in the loaded rows. Listing the whole
  // fleet would offer choices that return nothing, which reads as a broken
  // filter rather than an empty week.
  const uidOptions = useMemo(() => {
    const counts = new Map();
    rows.forEach((r) => {
      if (r?.uid) counts.set(r.uid, (counts.get(r.uid) || 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, n]) => ({ value: id, label: `${id} (${n})` }));
  }, [rows]);

  const filtered = useMemo(
    () => (filterable && uid ? rows.filter((r) => r.uid === uid) : rows),
    [rows, uid, filterable]
  );

  const toolbar = filterable ? (
    <div className="flex items-center gap-3 flex-1">
      <SelectMenu
        value={uid}
        onChange={setUid}
        options={[
          { value: '', label: `All scales (${uidOptions.length})` },
          ...uidOptions,
        ]}
        placeholder="All scales"
        testId="readings-uid-filter"
        className="w-full sm:w-56"
      />
      {/* No separate Clear control: "All scales" is the reset, and a second
          button that does the same thing is just another thing to explain. */}
      {uid && (
        <span className="text-[11px] text-slate-500 shrink-0">
          {filtered.length} of {rows.length} rows
        </span>
      )}
    </div>
  ) : null;

  return (
    <DataTable
      testId={testId}
      columns={columns}
      data={filtered}
      searchableKeys={searchableKeys}
      pageSize={pageSize}
      emptyLabel={uid ? `No readings from ${uid} in this window.` : emptyLabel}
      toolbar={toolbar}
    />
  );
}
