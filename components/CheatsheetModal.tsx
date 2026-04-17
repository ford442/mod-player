import React, { useEffect, useRef } from 'react';

interface CheatsheetModalProps {
  onClose: () => void;
}

export const CheatsheetModal: React.FC<CheatsheetModalProps> = ({ onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const getFocusable = () => dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    ) ?? [];

    getFocusable()[0]?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const focusable = Array.from(getFocusable());
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-2xl rounded-lg border border-cyan-500/40 bg-[#0b1116] p-5 text-sm text-gray-200 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-cyan-300">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2 font-mono text-xs">
          {[
            ['Space', 'Play / pause'],
            ['ArrowLeft', 'Seek −1 row'],
            ['ArrowRight', 'Seek +1 row'],
            ['Shift + ArrowLeft', 'Seek −1 order'],
            ['Shift + ArrowRight', 'Seek +1 order'],
            ['ArrowUp', 'Previous order'],
            ['ArrowDown', 'Next order'],
            ['Shift + ArrowUp', 'Volume up'],
            ['Shift + ArrowDown', 'Volume down'],
            ['Digit1–Digit9', 'Jump to order N−1'],
            ['D', 'Toggle debug panel'],
            ['?', 'Toggle shortcuts'],
            ['Escape', 'Close shortcuts'],
            ['L', 'Toggle loop'],
            ['F', 'Toggle fullscreen'],
          ].map(([shortcut, action]) => (
            <div key={shortcut} className="grid grid-cols-[180px_1fr] gap-4 border-b border-gray-800 pb-2">
              <span className="text-cyan-300">{shortcut}</span>
              <span className="text-gray-300">{action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
