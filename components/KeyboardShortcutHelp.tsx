import React, { useEffect, useRef } from 'react';

interface KeyboardShortcutHelpProps {
  onClose: () => void;
}

const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play / pause'],
  ['ArrowLeft', 'Seek −1 row'],
  ['ArrowRight', 'Seek +1 row'],
  ['Shift + ArrowLeft', 'Previous order'],
  ['Shift + ArrowRight', 'Next order'],
  ['ArrowUp', 'Previous order (no modifier)'],
  ['ArrowDown', 'Next order (no modifier)'],
  ['Shift + ArrowUp', 'Volume +5%'],
  ['Shift + ArrowDown', 'Volume −5%'],
  ['1 – 9', 'Jump to order 0–8'],
  ['L', 'Toggle loop'],
  ['M', 'Mute / unmute'],
  ['F', 'Toggle fullscreen'],
  ['D', 'Toggle debug panel'],
  ['?', 'Toggle this help overlay'],
  ['Escape', 'Close this help overlay'],
];

export const KeyboardShortcutHelp: React.FC<KeyboardShortcutHelpProps> = ({ onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const getFocusable = () =>
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) ?? [];

    const focusable = getFocusable();
    if (focusable[0]) {
      focusable[0].focus();
    } else {
      dialogRef.current?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(getFocusable());
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
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
        tabIndex={-1}
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
          {SHORTCUTS.map(([shortcut, action]) => (
            <div
              key={shortcut}
              className="grid grid-cols-[200px_1fr] gap-4 border-b border-gray-800 pb-2"
            >
              <span className="text-cyan-300">{shortcut}</span>
              <span className="text-gray-300">{action}</span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-[10px] text-gray-600">
          Shortcuts are disabled when focus is inside a text input.
        </p>
      </div>
    </div>
  );
};
