const VARIANTS = {
  success: 'bg-leaf/15 text-leaf border-leaf/30',
  danger: 'bg-red-500/15 text-red-400 border-red-500/30',
  warning: 'bg-amber/15 text-amber border-amber/30',
  info: 'bg-sky/15 text-sky border-sky/30',
  neutral: 'bg-ink-700/70 text-slate-300 border-ink-600',
};

export default function Badge({ label, variant = 'neutral', dot = false, className = '' }) {
  const cls = VARIANTS[variant] || VARIANTS.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold uppercase tracking-wider ${cls} ${className}`}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            variant === 'success'
              ? 'bg-leaf'
              : variant === 'danger'
              ? 'bg-red-500'
              : variant === 'warning'
              ? 'bg-amber'
              : variant === 'info'
              ? 'bg-sky'
              : 'bg-slate-400'
          }`}
        />
      )}
      {label}
    </span>
  );
}
