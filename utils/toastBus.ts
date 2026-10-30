import type { ToastKind } from '../hooks/useToast';

type ToastListener = (text: string, kind: ToastKind) => void;

const listeners = new Set<ToastListener>();

/**
 * Show a toast from code that has no `showToast` prop (e.g. media elements deep in the tree).
 * `useToast` subscribes while mounted; with no subscriber the message is dropped.
 */
export function emitToast(text: string, kind: ToastKind = 'info'): void {
  for (const listener of listeners) listener(text, kind);
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
