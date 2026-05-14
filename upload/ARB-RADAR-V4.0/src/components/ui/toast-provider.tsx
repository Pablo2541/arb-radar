'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';

// ── Types ──────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  closing?: boolean;
}

interface ToastContextValue {
  addToast: (type: ToastType, title: string, message?: string) => void;
}

// ── Context ────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// ── Config ─────────────────────────────────────────────────────────────

const TOAST_COLORS: Record<ToastType, { bg: string; border: string; icon: string; iconColor: string; accent: string }> = {
  success: {
    bg: 'rgba(46, 235, 200, 0.08)',
    border: 'rgba(46, 235, 200, 0.25)',
    icon: '✓',
    iconColor: '#2eebc8',
    accent: '#2eebc8',
  },
  error: {
    bg: 'rgba(248, 113, 113, 0.08)',
    border: 'rgba(248, 113, 113, 0.25)',
    icon: '✕',
    iconColor: '#f87171',
    accent: '#f87171',
  },
  warning: {
    bg: 'rgba(251, 191, 36, 0.08)',
    border: 'rgba(251, 191, 36, 0.25)',
    icon: '⚠',
    iconColor: '#fbbf24',
    accent: '#fbbf24',
  },
  info: {
    bg: 'rgba(34, 211, 238, 0.08)',
    border: 'rgba(34, 211, 238, 0.25)',
    icon: 'ℹ',
    iconColor: '#22d3ee',
    accent: '#22d3ee',
  },
};

const AUTO_DISMISS_MS = 4000;

// ── Provider ───────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const idCounter = useRef(0);

  const addToast = useCallback(
    (type: ToastType, title: string, message?: string) => {
      const id = `toast-${++idCounter.current}-${Date.now()}`;
      const newToast: ToastMessage = { id, type, title, message };
      setToasts((prev) => [...prev, newToast]);

      // Auto-dismiss after 4s
      setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, closing: true } : t))
        );
        // Remove after slide-out animation
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 300);
      }, AUTO_DISMISS_MS);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, closing: true } : t))
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

// ── Toast Container ────────────────────────────────────────────────────

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        const colors = TOAST_COLORS[toast.type];
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl border p-4 shadow-2xl backdrop-blur-md flex items-start gap-3 ${
              toast.closing
                ? 'animate-slide-out-right'
                : 'animate-slide-in-right'
            }`}
            style={{
              backgroundColor: colors.bg,
              borderColor: colors.border,
            }}
          >
            {/* Icon */}
            <div
              className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold"
              style={{
                backgroundColor: `${colors.iconColor}15`,
                color: colors.iconColor,
              }}
            >
              {colors.icon}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div
                className="text-sm font-medium"
                style={{ color: colors.accent }}
              >
                {toast.title}
              </div>
              {toast.message && (
                <div className="text-xs text-app-text3 mt-0.5 leading-relaxed">
                  {toast.message}
                </div>
              )}
            </div>

            {/* Close button */}
            <button
              onClick={() => onDismiss(toast.id)}
              className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-app-text4 hover:text-app-text2 hover:bg-app-hover transition-colors"
              aria-label="Cerrar notificación"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default ToastProvider;
