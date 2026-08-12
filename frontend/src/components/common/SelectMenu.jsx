import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import PopoverPanel from './PopoverPanel.jsx';

/**
 * Single-select dropdown styled to match the rest of the app.
 *
 * Replaces native <select>, which renders with the OS widget: a white popup on
 * a dark page, ignoring every colour and radius the app sets. The visible
 * control is a button and the list is our own markup, so it themes like
 * everything else.
 *
 * Keyboard behaviour is implemented rather than inherited, since dropping the
 * native element also drops what it gave for free:
 *   ↑/↓        move the highlight (opens the list if closed)
 *   Enter/Space commit the highlighted option
 *   Esc        close without changing the value
 *   Tab        close and move on
 *
 * `options` are `{ value, label, color? }`. A `color` renders a swatch, which
 * is what lets the category filter show its palette next to each entry.
 */
export default function SelectMenu({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  testId,
  disabled = false,
  icon: Icon = null,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);
  const listRef = useRef(null);

  const selectedIndex = useMemo(
    () => options.findIndex((o) => o.value === value),
    [options, value]
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  // Opening highlights the current value rather than the top of the list.
  useEffect(() => {
    if (open) setActive(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.children?.[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const commit = (index) => {
    const opt = options[index];
    if (!opt) return;
    onChange?.(opt.value);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (disabled) return;

    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit(active);
    }
  };

  return (
    <div className={`relative ${className}`} ref={rootRef} data-testid={testId}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className={`w-full h-11 ${Icon ? 'pl-9' : 'pl-3.5'} pr-3 rounded-xl bg-ink-800/60 border border-ink-600
                    text-sm text-slate-100 inline-flex items-center justify-between gap-2 transition-all
                    hover:border-sky/50 focus:border-sky/60 focus:outline-none focus:ring-2 focus:ring-sky/20
                    disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-ink-600`}
      >
        {Icon && (
          <Icon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        )}
        <span className={`truncate flex items-center gap-2 ${selected ? '' : 'text-slate-400'}`}>
          {selected?.color && (
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: selected.color }}
            />
          )}
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <PopoverPanel
        anchorRef={rootRef}
        open={open}
        onClose={() => setOpen(false)}
      >
        <ul
          ref={listRef}
          role="listbox"
          className="max-h-64 overflow-y-auto p-1.5"
        >
          {options.length === 0 && (
            <li className="px-2.5 py-2 text-sm text-slate-500">No options</li>
          )}
          {options.map((opt, i) => {
            const isSelected = opt.value === value;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(i)}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer text-sm
                            transition-colors ${
                              i === active ? 'bg-ink-700/70 text-white' : 'text-slate-200'
                            }`}
              >
                {opt.color && (
                  <span
                    className="w-2 h-2 rounded-sm shrink-0"
                    style={{ background: opt.color }}
                  />
                )}
                <span className="truncate flex-1">{opt.label}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-sky shrink-0" />}
              </li>
            );
          })}
        </ul>
      </PopoverPanel>
    </div>
  );
}
