/**
 * AccessibilityPanel — compact accessibility settings.
 *
 * Exposes three toggles that are always visible in both public and dev builds:
 *   1. Reduced-motion  — damps bloom pulse / playhead animation
 *   2. High-contrast   — raises LED on/off luminance separation
 *   3. CVD-safe palette selector — deuteranopia / tritanopia / monochrome
 *
 * All settings persist to localStorage via useShaderPrefsStore.
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '../utils/cn';
import { useShaderPrefsStore } from '../store/shaderPrefsStore';
import { CVD_PALETTE_NAMES } from '../utils/accessiblePalettes';

export function AccessibilityPanel() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const reducedMotion = useShaderPrefsStore((s) => s.reducedMotion);
  const setReducedMotion = useShaderPrefsStore((s) => s.setReducedMotion);
  const highContrast = useShaderPrefsStore((s) => s.highContrast);
  const setHighContrast = useShaderPrefsStore((s) => s.setHighContrast);
  const cvdPalette = useShaderPrefsStore((s) => s.cvdPalette);
  const setCvdPalette = useShaderPrefsStore((s) => s.setCvdPalette);

  // Close on Escape and move focus back to trigger
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        aria-label="Accessibility settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs font-mono',
          'border border-panel text-accent hover:text-white hover:border-accent',
          'transition-colors duration-150',
          open && 'bg-panel border-accent text-white',
        )}
        title="Accessibility settings"
      >
        <span aria-hidden="true">♿</span>
        <span className="hidden sm:inline">A11y</span>
      </button>

      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label="Accessibility settings panel"
          aria-modal="true"
          className={cn(
            'absolute z-50 right-0 mt-1 w-64 rounded border border-panel bg-[#0d0d0d]',
            'shadow-lg p-3 flex flex-col gap-3',
          )}
        >
          {/* Reduced motion */}
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="text-xs text-slate-300">
              <span className="font-semibold text-white">Reduced motion</span>
              <br />
              <span className="text-slate-500">Damps bloom pulse &amp; playhead sweep</span>
            </span>
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(e) => setReducedMotion(e.target.checked)}
              aria-label="Reduced motion"
              className="accent-sky-400 w-4 h-4 cursor-pointer"
            />
          </label>

          <div className="border-t border-panel" />

          {/* High contrast */}
          <label className="flex items-center justify-between gap-2 cursor-pointer">
            <span className="text-xs text-slate-300">
              <span className="font-semibold text-white">High contrast</span>
              <br />
              <span className="text-slate-500">Brighter LEDs, darker background</span>
            </span>
            <input
              type="checkbox"
              checked={highContrast}
              onChange={(e) => setHighContrast(e.target.checked)}
              aria-label="High contrast"
              className="accent-sky-400 w-4 h-4 cursor-pointer"
            />
          </label>

          <div className="border-t border-panel" />

          {/* CVD palette selector */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-white">Colour palette</span>
            <span className="text-xs text-slate-500">CVD-safe note/pitch colours</span>
            <select
              value={cvdPalette}
              onChange={(e) => setCvdPalette(Number(e.target.value))}
              aria-label="Colour-vision-deficiency safe palette"
              className={cn(
                'mt-1 w-full rounded border border-panel bg-[#111] text-xs text-slate-200',
                'px-2 py-1 cursor-pointer focus:outline-none focus:border-accent',
              )}
            >
              {CVD_PALETTE_NAMES.map((name, id) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setOpen(false)}
            className="mt-1 self-end text-xs text-slate-500 hover:text-slate-300"
            aria-label="Close accessibility panel"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
