/**
 * Accessible rotary knob (#453): `role="slider"` with the physical value in
 * aria-valuenow and a formatted aria-valuetext. Arrows / Page / Home / End /
 * Delete from the keyboard (Shift = fine), vertical pointer drag with pointer
 * capture (Shift = fine), double-click resets. Handled keys stop propagating
 * so the player's global shortcuts (arrows seek) don't fire.
 */
import React, { useCallback, useRef } from 'react';
import { denormalize, normalize, type NumberParamSpec } from '../audio/fx/spec/paramSpecs';
import { cn } from '../utils/cn';
import {
  KNOB_START_DEG,
  KNOB_SWEEP_DEG,
  arcPath,
  dragToNormalized,
  formatParamValue,
  keyToValue,
  normalizedToAngle,
} from '../utils/knobMath';

interface KnobProps {
  spec: NumberParamSpec;
  value: number;
  onChange: (value: number) => void;
  /** Accessible name; defaults to the spec label. */
  label?: string;
  disabled?: boolean;
  size?: number;
  reducedMotion?: boolean;
}

export const Knob: React.FC<KnobProps> = ({ spec, value, onChange, label, disabled = false, size = 44, reducedMotion = false }) => {
  const drag = useRef<{ startY: number; startNormalized: number; pointerId: number } | null>(null);
  const normalized = normalize(spec, value);
  const name = label ?? spec.label;
  const text = formatParamValue(spec, value);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const next = keyToValue(spec, value, e.key, e.shiftKey);
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (next !== value) onChange(next);
    },
    [disabled, onChange, spec, value],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { startY: e.clientY, startNormalized: normalized, pointerId: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const next = denormalize(spec, dragToNormalized(d.startNormalized, e.clientY - d.startY, e.shiftKey));
    if (next !== value) onChange(next);
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  };

  const c = size / 2;
  const r = c - 4;
  const angle = normalizedToAngle(normalized);
  const rad = ((angle - 90) * Math.PI) / 180;

  return (
    <div className="flex flex-col items-center gap-0.5 select-none" style={{ width: size + 16 }}>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={name}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={Number(value.toFixed(4))}
        aria-valuetext={text}
        aria-orientation="vertical"
        aria-disabled={disabled || undefined}
        title={`${name}: ${text} — drag, arrow keys (Shift = fine), double-click to reset`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => !disabled && onChange(spec.default)}
        className={cn(
          'rounded-full outline-none touch-none',
          'focus-visible:ring-2 focus-visible:ring-[var(--text-accent)]',
          disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-ns-resize',
        )}
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={c} cy={c} r={r - 3} fill="var(--panel-inset)" stroke="var(--edge-highlight)" strokeWidth={1} />
          <path
            d={arcPath(c, c, r, KNOB_START_DEG, KNOB_START_DEG + KNOB_SWEEP_DEG)}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeWidth={3}
            strokeLinecap="round"
          />
          {normalized > 0.001 && (
            <path
              d={arcPath(c, c, r, KNOB_START_DEG, angle)}
              fill="none"
              stroke="var(--text-accent)"
              strokeWidth={3}
              strokeLinecap="round"
              style={reducedMotion ? undefined : { transition: 'd 60ms linear' }}
            />
          )}
          <line
            x1={c}
            y1={c}
            x2={c + (r - 7) * Math.cos(rad)}
            y2={c + (r - 7) * Math.sin(rad)}
            stroke="var(--text-accent)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <span className="text-[9px] uppercase tracking-wider text-[var(--text-secondary)] leading-none">{name}</span>
      <span className="text-[10px] font-mono text-[var(--text-primary,inherit)] leading-none">{text}</span>
    </div>
  );
};

export default Knob;
