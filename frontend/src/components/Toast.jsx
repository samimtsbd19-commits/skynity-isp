import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import clsx from 'clsx';

const ToastCtx = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error:   AlertCircle,
  warning: AlertTriangle,
  info:    Info,
};

const STYLES = {
  success: 'border-green/40 bg-green/5 text-green',
  error:   'border-red/40 bg-red/5 text-red',
  warning: 'border-amber/40 bg-amber/5 text-amber',
  info:    'border-border bg-surface2 text-text-dim',
};

let uid = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message, { type = 'info', duration = 4000 } = {}) => {
    const id = ++uid;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
    if (duration > 0) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const success = useCallback((msg, opts) => toast(msg, { type: 'success', ...opts }), [toast]);
  const error   = useCallback((msg, opts) => toast(msg, { type: 'error',   ...opts }), [toast]);
  const warning = useCallback((msg, opts) => toast(msg, { type: 'warning', ...opts }), [toast]);
  const info    = useCallback((msg, opts) => toast(msg, { type: 'info',    ...opts }), [toast]);

  return (
    <ToastCtx.Provider value={{ toast, success, error, warning, info, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </ToastCtx.Provider>
  );
}

function ToastContainer({ toasts, dismiss }) {
  if (!toasts.length) return null;
  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast: t, onDismiss }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 200ms, transform 200ms';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
  }, []);

  const Icon = ICONS[t.type] || Info;
  return (
    <div
      ref={ref}
      role="alert"
      className={clsx(
        'pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-sm border',
        'min-w-[280px] max-w-sm shadow-lg font-mono text-sm',
        STYLES[t.type] || STYLES.info,
      )}
    >
      <Icon size={15} className="shrink-0 mt-0.5" />
      <span className="flex-1 text-text leading-snug">{t.message}</span>
      <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
        <X size={13} />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
