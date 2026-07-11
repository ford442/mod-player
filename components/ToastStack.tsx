import { cn } from '../utils/cn';
import type { ToastMessage } from '../hooks/useToast';

interface ToastStackProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const KIND_STYLES: Record<ToastMessage['kind'], string> = {
  info: 'border-cyan-500/60 bg-cyan-950/90 text-cyan-100',
  success: 'border-green-500/60 bg-green-950/90 text-green-100',
  warning: 'border-amber-500/60 bg-amber-950/90 text-amber-100',
  error: 'border-red-500/60 bg-red-950/90 text-red-100',
};

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] flex max-w-sm flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-relevant="additions"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur-sm',
            KIND_STYLES[toast.kind],
          )}
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="leading-snug">{toast.text}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="shrink-0 text-xs opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
