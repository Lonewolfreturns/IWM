import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingDown, TrendingUp } from 'lucide-react';

/**
 * Animated count-up hook (no external deps).
 */
function useCountUp(end, duration = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const target = Number(end) || 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [end, duration]);
  return value;
}

function formatValue(value, format) {
  if (format === 'int') return Math.round(value).toLocaleString('en-CA');
  if (format === 'one') return value.toFixed(1);
  return Math.round(value).toLocaleString('en-CA');
}

const COLORS = {
  sky: {
    bg: 'bg-sky/15',
    text: 'text-sky',
    top: 'from-sky to-transparent',
  },
  green: {
    bg: 'bg-leaf/15',
    text: 'text-leaf',
    top: 'from-leaf to-transparent',
  },
  amber: {
    bg: 'bg-amber/15',
    text: 'text-amber',
    top: 'from-amber to-transparent',
  },
  red: {
    bg: 'bg-red-500/15',
    text: 'text-red-400',
    top: 'from-red-500 to-transparent',
  },
};

export default function StatCard({
  title,
  value,
  suffix = '',
  change,
  changeType = 'down', // 'up' | 'down' | 'neutral'
  changeLabel,
  icon: Icon,
  color = 'sky',
  format = 'int',
  children, // optional inline node (e.g., sparkline)
  testId,
}) {
  const animated = useCountUp(typeof value === 'number' ? value : 0);
  const c = COLORS[color] || COLORS.sky;

  const TrendIcon =
    changeType === 'up'
      ? TrendingUp
      : changeType === 'down'
      ? TrendingDown
      : TrendingDown;

  const trendColor =
    changeType === 'up'
      ? 'text-red-400 bg-red-500/15'
      : changeType === 'down'
      ? 'text-leaf bg-leaf/15'
      : 'text-slate-300 bg-ink-700/60';

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl glass p-5 hover:border-sky/40 hover:shadow-glow transition-all duration-300 group"
      data-testid={testId}
    >
      {/* Top accent border */}
      <div
        className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${c.top} opacity-80`}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400 font-medium">
            {title}
          </div>
          <div className="mt-2 font-display font-bold text-3xl sm:text-4xl text-white leading-tight">
            {typeof value === 'number' ? formatValue(animated, format) : value}
            {suffix && (
              <span className="text-base sm:text-lg text-slate-400 font-medium ml-1.5">
                {suffix}
              </span>
            )}
          </div>

          {change != null && (
            <div className="mt-3 flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md ${trendColor}`}
              >
                <TrendIcon className="w-3 h-3" />
                {change}
              </span>
              {changeLabel && (
                <span className="text-xs text-slate-500">{changeLabel}</span>
              )}
            </div>
          )}
        </div>

        {Icon && (
          <div
            className={`shrink-0 w-12 h-12 rounded-xl grid place-items-center ${c.bg} ${c.text} group-hover:scale-110 transition-transform`}
          >
            <Icon className="w-6 h-6" strokeWidth={2} />
          </div>
        )}
      </div>

      {children && <div className="mt-3">{children}</div>}
    </motion.div>
  );
}
