import { AlertTriangle, CalendarX, CircleAlert, CircleCheck } from 'lucide-react';

/**
 * States what a range actually holds, above whatever is drawn from it.
 *
 * Without this the charts are quietly dishonest: thirty days of axes drawn
 * from two days of data look identical to thirty days of data, and the total
 * underneath reads as a month's worth either way. The banner is the only thing
 * separating "June was a quiet month" from "we only have the last fortnight of
 * June".
 *
 * Full coverage renders nothing — a green "all good" bar on every page is
 * noise, and noise is what people learn to stop reading.
 */
export default function CoverageNotice({ coverage, onUseRange, testId = 'coverage-notice' }) {
  if (!coverage) return null;
  const { status } = coverage;
  if (status === 'full') return null;

  const tone = {
    partial: {
      Icon: CircleAlert,
      wrap: 'bg-amber/10 border-amber/30',
      icon: 'text-amber',
    },
    empty: {
      Icon: CalendarX,
      wrap: 'bg-ink-800/60 border-ink-600',
      icon: 'text-slate-400',
    },
    error: {
      Icon: AlertTriangle,
      wrap: 'bg-red-500/10 border-red-500/30',
      icon: 'text-red-400',
    },
  }[status] || { Icon: CircleCheck, wrap: 'bg-ink-800/60 border-ink-600', icon: 'text-slate-400' };

  const { Icon } = tone;
  const nearest = coverage.nearest || {};

  return (
    <div
      className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${tone.wrap}`}
      data-testid={testId}
      data-status={status}
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${tone.icon}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-200 leading-snug">{coverage.message}</p>

        {status === 'partial' && (
          <p className="text-[11px] text-slate-500 mt-1">
            {coverage.daysWithData} of {coverage.daysRequested} days in range hold readings.
          </p>
        )}

        {/* An empty range is a dead end unless it points somewhere. These
            jump straight to where the data actually is. */}
        {status === 'empty' && (nearest.before || nearest.after) && onUseRange && (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {nearest.before && (
              <button
                type="button"
                onClick={() => onUseRange(nearest.before.date)}
                data-testid="coverage-jump-before"
                className="btn-ghost h-8 text-xs"
              >
                Go to {nearest.before.date}
              </button>
            )}
            {nearest.after && (
              <button
                type="button"
                onClick={() => onUseRange(nearest.after.date)}
                data-testid="coverage-jump-after"
                className="btn-ghost h-8 text-xs"
              >
                Go to {nearest.after.date}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
