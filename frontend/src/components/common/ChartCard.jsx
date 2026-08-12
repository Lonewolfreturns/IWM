import { motion } from 'framer-motion';

export default function ChartCard({
  title,
  subtitle,
  action,
  children,
  className = '',
  bodyClassName = '',
  testId,
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`glass rounded-2xl overflow-hidden ${className}`}
      data-testid={testId}
    >
      <header className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-3">
        <div>
          <h3 className="font-display font-semibold text-white text-base sm:text-lg">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs sm:text-sm text-slate-400 mt-1">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className={`px-2 sm:px-4 pb-5 ${bodyClassName}`}>{children}</div>
    </motion.section>
  );
}
