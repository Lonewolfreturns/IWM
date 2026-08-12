import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

const pad = (n) => String(n).padStart(2, '0');
const POPOVER_W = 248;
const POPOVER_H = 430;
const MARGIN = 10;

function parseValue(value) {
  const [h, m] = String(value || '08:00').split(':').map((v) => parseInt(v, 10) || 0);
  const hour24 = Math.min(23, Math.max(0, h));
  const minute = Math.min(59, Math.max(0, m));
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const meridiem = hour24 < 12 ? 'AM' : 'PM';
  return { hour24, minute, hour12, meridiem };
}

function combine(hour12, meridiem, minute) {
  let h = hour12 % 12;
  if (meridiem === 'PM') h += 12;
  return `${pad(h)}:${pad(minute)}`;
}

const HOUR_MARKS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTE_CHIPS = [0, 15, 30, 45];

/**
 * A friendly analog-clock style time picker.
 * value: "HH:MM" 24h string. onChange(next: "HH:MM")
 * Renders its popover into a document.body portal, positioned in fixed
 * (viewport) coordinates and clamped so it never spills off-screen.
 */
export default function ClockTimePicker({ value, onChange, testId, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const { minute, hour12, meridiem } = useMemo(() => parseValue(value), [value]);

  const place = () => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + POPOVER_W > window.innerWidth - MARGIN) {
      left = window.innerWidth - POPOVER_W - MARGIN;
    }
    if (left < MARGIN) left = MARGIN;
    if (top + POPOVER_H > window.innerHeight - MARGIN) {
      const above = rect.top - POPOVER_H - 8;
      top = above > MARGIN ? above : Math.max(MARGIN, window.innerHeight - POPOVER_H - MARGIN);
    }
    setCoords({ top, left });
  };

  useEffect(() => {
    if (!open) return undefined;
    place();
    const reposition = () => place();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    const handler = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        popoverRef.current && !popoverRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('mousedown', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const setHour = (h12) => onChange(combine(h12, meridiem, minute));
  const setMinute = (m) => onChange(combine(hour12, meridiem, m));
  const setMeridiem = (mer) => onChange(combine(hour12, mer, minute));

  const display = `${hour12}:${pad(minute)} ${meridiem}`;
  const center = 76;
  const radius = 58;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        data-testid={testId}
        className={`inline-flex items-center gap-2 h-11 px-3.5 rounded-xl bg-ink-800/60 border transition-all text-sm font-semibold tabular-nums
          ${open ? 'border-sky/60 shadow-glow text-white' : 'border-ink-600 text-slate-100 hover:border-ink-500'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <Clock className="w-4 h-4 text-sky" />
        {display}
      </button>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={popoverRef}
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.16 }}
                style={{ position: 'fixed', top: coords.top, left: coords.left, width: POPOVER_W }}
                className="z-[100] rounded-2xl glass-strong border border-ink-600 shadow-2xl p-4"
              >
                {/* Digital readout */}
                <div className="text-center font-display font-bold text-xl text-white tabular-nums mb-3">
                  {display}
                </div>

                {/* Clock face */}
                <div className="relative w-[152px] h-[152px] mx-auto rounded-full bg-ink-800/70 border border-ink-600 mb-4">
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 152 152">
                    <line
                      x1={center}
                      y1={center}
                      x2={center + radius * 0.62 * Math.cos(((hour12 % 12) * 30 - 90) * (Math.PI / 180))}
                      y2={center + radius * 0.62 * Math.sin(((hour12 % 12) * 30 - 90) * (Math.PI / 180))}
                      stroke="#38BDF8"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <circle cx={center} cy={center} r="3.5" fill="#38BDF8" />
                  </svg>
                  {HOUR_MARKS.map((h) => {
                    const angle = (h % 12) * 30 - 90;
                    const x = center + radius * Math.cos((angle * Math.PI) / 180);
                    const y = center + radius * Math.sin((angle * Math.PI) / 180);
                    const active = h === hour12;
                    return (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setHour(h)}
                        data-testid={`${testId}-hour-${h}`}
                        className={`absolute grid place-items-center w-7 h-7 rounded-full text-xs font-bold tabular-nums transition-all -translate-x-1/2 -translate-y-1/2
                          ${active ? 'bg-sky-gradient text-ink-900 shadow-glow' : 'text-slate-300 hover:bg-ink-700/70 hover:text-white'}`}
                        style={{ left: x, top: y }}
                      >
                        {h}
                      </button>
                    );
                  })}
                </div>

                {/* Minutes */}
                <div className="mb-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 text-center">Minutes</div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {MINUTE_CHIPS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMinute(m)}
                        data-testid={`${testId}-minute-${m}`}
                        className={`h-8 rounded-lg text-xs font-semibold tabular-nums transition-all
                          ${minute === m ? 'bg-sky-gradient text-ink-900 shadow-glow' : 'bg-ink-800/60 border border-ink-600 text-slate-300 hover:text-white'}`}
                      >
                        :{pad(m)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* AM/PM + done */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 grid grid-cols-2 gap-1 p-1 bg-ink-800/60 border border-ink-600 rounded-lg">
                    {['AM', 'PM'].map((mer) => (
                      <button
                        key={mer}
                        type="button"
                        onClick={() => setMeridiem(mer)}
                        data-testid={`${testId}-${mer.toLowerCase()}`}
                        className={`h-8 rounded-md text-xs font-bold transition-all ${
                          meridiem === mer ? 'bg-sky-gradient text-ink-900 shadow-glow' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {mer}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="h-9 px-3 rounded-lg text-xs font-semibold bg-leaf/15 text-leaf border border-leaf/30 hover:bg-leaf/25 transition-all"
                  >
                    Done
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}

export { parseValue as parseClockValue };
