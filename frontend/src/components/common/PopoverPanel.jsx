import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A panel anchored to a trigger element but rendered into <body>.
 *
 * Absolutely-positioned dropdowns get clipped the moment an ancestor sets
 * `overflow: hidden` — ChartCard does, to keep its rounded corners — so a
 * calendar opening near the bottom of a card was sliced off at the card edge.
 *
 * `position: fixed` alone does not rescue it: ChartCard is a framer-motion
 * element, and a `transform` on an ancestor makes that ancestor the containing
 * block for fixed descendants, re-trapping the panel. Portalling to <body>
 * escapes both the clip and the transform, so coordinates are computed from the
 * trigger's viewport rect instead of inherited from the DOM position.
 *
 * Because the panel is fixed, it does not move when the page scrolls — so it
 * repositions itself on scroll and resize to stay glued to its trigger, and
 * only closes once the trigger has actually left the viewport.
 */
export default function PopoverPanel({
  anchorRef,
  open,
  onClose,
  children,
  matchWidth = true,
  minWidth = 0,
  className = '',
}) {
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight || 0;
    const panelWidth = Math.max(matchWidth ? rect.width : 0, minWidth) || rect.width;

    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = panelHeight > 0 && spaceBelow < panelHeight + 12 && rect.top > panelHeight;

    // Keep the panel inside the viewport horizontally rather than letting a
    // right-aligned control push it off-screen.
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - panelWidth - 8)
    );

    setPos({
      top: flipUp ? rect.top - panelHeight - 6 : rect.bottom + 6,
      left,
      width: panelWidth,
    });
  }, [anchorRef, matchWidth, minWidth]);

  // Measured before paint so the panel never shows at 0,0 for a frame.
  useLayoutEffect(() => {
    if (open) reposition();
    else setPos(null);
  }, [open, reposition, children]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return;   // let the trigger toggle
      onClose?.();
    };

    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };

    // Capture phase, because scroll does not bubble and the scrolling element
    // may be any ancestor. That breadth is why the panel's own list has to be
    // excluded explicitly: without this check, dragging the dropdown's
    // scrollbar counted as "the page moved" and dismissed it mid-use.
    const onScroll = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      const rect = anchorRef.current?.getBoundingClientRect();
      // Once the trigger itself has scrolled out of sight there is nothing to
      // stay anchored to, so close rather than float over unrelated content.
      if (rect && (rect.bottom < 0 || rect.top > window.innerHeight)) {
        onClose?.();
        return;
      }
      reposition();
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, onClose, anchorRef, reposition]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        // Hidden until measured, so the first paint can't flash in the corner.
        visibility: pos ? 'visible' : 'hidden',
        ...(matchWidth ? { width: pos?.width } : { minWidth: minWidth || undefined }),
        // Must sit above Modal (z-80). Both portal to <body>, so a lower value
        // put every dropdown and calendar opened inside a modal *behind* the
        // modal surface — the list rendered correctly and was simply not
        // visible, which reads as "the dropdown is empty".
        // Kept below toasts (z-100) so notifications still surface over it.
        zIndex: 90,
      }}
      className={`glass-strong border border-ink-600 rounded-xl shadow-2xl ${className}`}
    >
      {children}
    </div>,
    document.body
  );
}
