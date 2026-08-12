/**
 * Placeholder bars shown while a chart's data is in flight.
 *
 * Replaces the blank panel that used to sit there. A chart area that is simply
 * empty is indistinguishable from one that finished loading and found nothing
 * — the difference matters, and it is the difference between "wait" and "there
 * is no data". Motion carries that without asking anyone to read a word, which
 * is the point: the people using this are looking at a kitchen screen, not
 * studying the interface.
 */
export default function ChartSkeleton({ bars = 9, height = 'h-72 sm:h-80', testId }) {
  // Fixed, uneven heights rather than random ones: a skeleton that reshuffles
  // on every render draws the eye to the noise instead of the wait.
  const heights = [42, 68, 55, 80, 38, 72, 60, 48, 76, 52, 64, 44];

  return (
    <div
      className={`${height} flex items-end gap-2 sm:gap-3 px-2 pb-6 pt-4`}
      data-testid={testId}
      role="status"
      aria-label="Loading chart data"
    >
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-lg bg-gradient-to-t from-ink-700/70 to-ink-600/40 animate-pulse"
          style={{
            height: `${heights[i % heights.length]}%`,
            // Staggered so the row reads as a wave rather than one block
            // flashing, which is easier to recognise as "working".
            animationDelay: `${(i % 6) * 110}ms`,
            animationDuration: '1.4s',
          }}
        />
      ))}
    </div>
  );
}

/** Row of placeholder stat tiles, for the summary strip above the charts. */
export function StatSkeleton({ count = 4, testId }) {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
      data-testid={testId}
      role="status"
      aria-label="Loading summary"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass rounded-2xl p-5">
          <div
            className="h-3 w-24 rounded bg-ink-700/70 animate-pulse"
            style={{ animationDelay: `${i * 90}ms` }}
          />
          <div
            className="h-7 w-32 rounded bg-ink-600/50 animate-pulse mt-3"
            style={{ animationDelay: `${i * 90 + 60}ms` }}
          />
        </div>
      ))}
    </div>
  );
}
