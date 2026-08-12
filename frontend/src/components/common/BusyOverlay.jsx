import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import LoadingSpinner from './LoadingSpinner.jsx';

/**
 * Full-screen block, used sparingly.
 *
 * Deliberately NOT used for ordinary page loads or the dashboard's polling —
 * an overlay that appears every sixty seconds makes a working app feel broken,
 * and blocking the screen to refresh a number nobody asked to refresh is worse
 * than a quiet update.
 *
 * It is here for one shape of task: something the person explicitly started,
 * that takes real time, and whose result lands *outside* the page. Report
 * generation is exactly that — several API calls, then a PDF that appears in
 * the browser's download tray rather than on screen. Without a block, the
 * honest reading of a still-sitting-there page is "my click did nothing", and
 * the natural response is to click again, which produces a second document.
 *
 * Sits above every other layer (modal 80, popovers 90, toasts 100) because
 * while it is up, nothing behind it should be reachable.
 */
export default function BusyOverlay({ open, title, detail }) {
  // A blocking overlay that lets the page scroll underneath feels detached
  // from what it is covering.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 grid place-items-center bg-ink-950/80 backdrop-blur-sm px-4"
      style={{ zIndex: 120 }}
      role="alertdialog"
      aria-busy="true"
      aria-live="assertive"
      aria-label={title}
      data-testid="busy-overlay"
    >
      <div className="glass-strong border border-ink-600 rounded-2xl px-8 py-7 flex flex-col items-center gap-4 max-w-sm text-center shadow-2xl">
        <LoadingSpinner size={40} />
        <div>
          <div className="font-display font-semibold text-white text-base">{title}</div>
          {detail && <p className="text-sm text-slate-400 mt-1.5 leading-snug">{detail}</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
