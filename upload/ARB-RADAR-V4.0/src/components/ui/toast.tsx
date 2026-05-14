'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
} from 'react';

// ── Types ──────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
  closing: boolean;
  progress: number;
}

interface ToastContextValue {
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

// ── Config ─────────────────────────────────────────────────────────────

const DEFAULT_DURATION = 4000;
const EXIT_ANIMATION_MS = 300;

const TOAST_STYLES: Record<
  ToastType,
  { icon: string; color: string; bg: string; border: string }
> = {
  success: {
    icon: '✓',
    color: '#2eebc8',
    bg: 'rgba(46, 235, 200, 0.06)',
    border: 'rgba(46, 235, 200, 0.3)',
  },
  error: {
    icon: '✗',
    color: '#f87171',
    bg: 'rgba(248, 113, 113, 0.06)',
    border: 'rgba(248, 113, 113, 0.3)',
  },
  warning: {
    icon: '⚠',
    color: '#fbbf24',
    bg: 'rgba(251, 191, 36, 0.06)',
    border: 'rgba(251, 191, 36, 0.3)',
  },
  info: {
    icon: 'ℹ',
    color: '#22d3ee',
    bg: 'rgba(34, 211, 238, 0.06)',
    border: 'rgba(34, 211, 238, 0.3)',
  },
};

// ── Context ────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idCounter = useRef(0);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clean up all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const dismissToast = useCallback((id: string) => {
    // Clear the auto-dismiss timer if still active
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, closing: true } : t))
    );

    // Remove from DOM after exit animation
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_ANIMATION_MS);
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string, duration = DEFAULT_DURATION) => {
      const id = `toast-${++idCounter.current}-${Date.now()}`;
      const newToast: ToastItem = {
        id,
        type,
        message,
        duration,
        closing: false,
        progress: 100,
      };

      setToasts((prev) => [...prev, newToast]);

      // Auto-dismiss after duration
      const timer = setTimeout(() => {
        dismissToast(id);
      }, duration);

      timersRef.current.set(id, timer);
    },
    [dismissToast]
  );

  const contextValue = useMemo<ToastContextValue>(
    () => ({
      success: (msg, dur) => addToast('success', msg, dur),
      error: (msg, dur) => addToast('error', msg, dur),
      warning: (msg, dur) => addToast('warning', msg, dur),
      info: (msg, dur) => addToast('info', msg, dur),
    }),
    [addToast]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useToastContext(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToastContext must be used within a <ToastProvider>');
  }
  return ctx;
}

// ── Toast Container ────────────────────────────────────────────────────

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      aria-live="polite"
      aria-label="Notificaciones"
    >
      {toasts.map((toast) => {
        const styles = TOAST_STYLES[toast.type];
        return (
          <div
            key={toast.id}
            role="alert"
            className={`pointer-events-auto rounded-xl border shadow-2xl backdrop-blur-md flex items-start gap-3 overflow-hidden ${
              toast.closing ? 'animate-toast-out' : 'animate-toast-in'
            }`}
            style={{
              backgroundColor: 'var(--app-card)',
              borderColor: styles.border,
            }}
          >
            {/* Left accent bar */}
            <div
              className="flex-shrink-0 w-1 self-stretch"
              style={{ backgroundColor: styles.color }}
            />

            {/* Icon */}
            <div
              className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold mt-3"
              style={{
                backgroundColor: `${styles.color}18`,
                color: styles.color,
              }}
            >
              {styles.icon}
            </div>

            {/* Message */}
            <div className="flex-1 min-w-0 py-3 pr-2">
              <p className="text-sm text-app-text leading-relaxed">
                {toast.message}
              </p>
            </div>

            {/* Close button */}
            <button
              onClick={() => onDismiss(toast.id)}
              className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-app-text4 hover:text-app-text2 hover:bg-app-hover transition-colors mt-3 mr-2"
              aria-label="Cerrar notificación"
            >
              <span className="text-xs">✕</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default ToastProvider;
