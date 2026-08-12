import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  testId,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const sizeClass = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }[size];

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center px-4 py-8"
          role="dialog"
          aria-modal="true"
          data-testid={testId}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-ink-950/75 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className={`relative w-full ${sizeClass} glass-strong rounded-2xl border border-ink-600 shadow-2xl overflow-hidden`}
          >
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-ink-600/60">
              <div>
                <h3 className="font-display font-semibold text-white text-lg">
                  {title}
                </h3>
                {subtitle && (
                  <p className="text-sm text-slate-400 mt-1">{subtitle}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close modal"
                data-testid="modal-close-btn"
                className="grid place-items-center w-9 h-9 rounded-lg text-slate-400 hover:text-white hover:bg-ink-700/60"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5 max-h-[65vh] overflow-y-auto">
              {children}
            </div>
            {footer && (
              <div className="px-6 py-4 border-t border-ink-600/60 bg-ink-900/40">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
