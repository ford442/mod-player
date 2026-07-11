import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
  id: string;
  text: string;
  kind: ToastKind;
}

const TOAST_DURATION_MS = 4500;

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, text, kind }]);
    const timer = setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
    timersRef.current.set(id, timer);
  }, [dismissToast]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return { toasts, showToast, dismissToast };
}
