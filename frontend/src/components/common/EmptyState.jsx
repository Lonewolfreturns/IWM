import { Inbox } from 'lucide-react';

// Shown wherever a page is waiting on the real backend — no fake numbers,
// just an honest "nothing here yet" until the API is wired up.
export default function EmptyState({
  icon: Icon = Inbox,
  title = 'No data yet',
  description = 'This will populate once connected to the live backend.',
  testId,
}) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center gap-2 py-12 px-4"
      data-testid={testId}
    >
      <div className="grid place-items-center w-11 h-11 rounded-xl bg-ink-700/60 text-slate-400 mb-1">
        <Icon className="w-5 h-5" />
      </div>
      <div className="text-sm font-semibold text-slate-300">{title}</div>
      <p className="text-xs text-slate-500 max-w-xs">{description}</p>
    </div>
  );
}
