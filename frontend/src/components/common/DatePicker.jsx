import { useMemo, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { Calendar as CalendarIcon } from 'lucide-react';
import PopoverPanel from './PopoverPanel.jsx';

/**
 * Date field with a themed calendar popover.
 *
 * Replaces <input type="date">, whose picker is drawn by the browser: on
 * Chrome/Windows that is a light-grey panel with its own fonts and a native
 * spin control, which is what made these fields look bolted on next to the
 * rest of the UI. Rendering the calendar ourselves is the only way to theme it
 * — the native one exposes almost nothing to CSS.
 *
 * Values are exchanged as YYYY-MM-DD strings, matching what the readings API
 * expects, and are parsed as *local* noon. Parsing a bare date as UTC midnight
 * and reading it back through local getters lands on the previous day for
 * anyone west of Greenwich, which would show the calendar a day off from the
 * value the caller holds.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-08-11" -> local Date at noon, or undefined. */
function parseValue(iso) {
  if (!iso) return undefined;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d, 12);
}

/** Local Date -> "2026-08-11", without a UTC round-trip. */
function toISO(date) {
  if (!date) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "2026-08-11" -> "11 Aug 2026" for the closed field. */
function displayLabel(iso) {
  const d = parseValue(iso);
  if (!d) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

export default function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Pick a date',
  testId,
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const selected = useMemo(() => parseValue(value), [value]);
  const fromDate = useMemo(() => parseValue(min), [min]);
  const toDate = useMemo(() => parseValue(max), [max]);

  const handleSelect = (date) => {
    if (!date) return;
    onChange?.(toISO(date));
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={rootRef} data-testid={testId}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className="w-full h-11 pl-9 pr-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm
                   text-slate-100 inline-flex items-center text-left transition-all
                   hover:border-sky/50 focus:border-sky/60 focus:outline-none focus:ring-2 focus:ring-sky/20
                   disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-ink-600"
      >
        <CalendarIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <span className={`truncate ${value ? '' : 'text-slate-400'}`}>
          {value ? displayLabel(value) : placeholder}
        </span>
      </button>

      <PopoverPanel
        anchorRef={rootRef}
        open={open}
        onClose={() => setOpen(false)}
        matchWidth={false}
        minWidth={300}
        className="p-3"
      >
        <DayPicker
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={handleSelect}
            fromDate={fromDate}
            toDate={toDate}
            showOutsideDays
            weekStartsOn={0}
            classNames={{
              months: 'flex flex-col',
              month: 'space-y-3',
              caption: 'flex justify-center pt-1 relative items-center',
              caption_label: 'text-sm font-semibold text-white font-display',
              nav: 'flex items-center gap-1',
              nav_button:
                'inline-flex items-center justify-center h-7 w-7 rounded-lg text-slate-400 ' +
                'hover:text-white hover:bg-ink-700/70 transition-colors',
              nav_button_previous: 'absolute left-1',
              nav_button_next: 'absolute right-1',
              table: 'w-full border-collapse',
              head_row: 'flex',
              head_cell:
                'text-slate-500 rounded-md w-9 font-medium text-[11px] uppercase tracking-wider',
              row: 'flex w-full mt-1',
              cell: 'h-9 w-9 text-center text-sm p-0 relative',
              day:
                'h-9 w-9 p-0 font-normal rounded-lg text-slate-200 transition-colors ' +
                'hover:bg-ink-700/70 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky/40',
              day_selected:
                'bg-sky text-ink-900 font-semibold hover:bg-sky hover:text-ink-900 ' +
                'shadow-[0_0_16px_-2px_rgba(56,189,248,0.6)]',
              day_today: 'border border-sky/50 text-sky',
              day_outside: 'text-slate-600',
              day_disabled: 'text-slate-700 opacity-50 cursor-not-allowed hover:bg-transparent',
            day_hidden: 'invisible',
          }}
        />
      </PopoverPanel>
    </div>
  );
}
