/**
 * Rotary knob math (#453) — pure, so it's unit-tested without a DOM.
 * Knobs work in normalized space (0…1 along the spec's lin/log scale), so a
 * keyboard step or a drag covers the same share of every range.
 */
import {
  clampToSpec,
  denormalize,
  normalize,
  type NumberParamSpec,
} from '../audio/fx/spec/paramSpecs';

/** 270° sweep, 7:30 → 4:30 o'clock. */
export const KNOB_SWEEP_DEG = 270;
export const KNOB_START_DEG = -135;
/** A vertical drag of this many pixels sweeps the full range. */
export const KNOB_DRAG_PX = 200;
/** Arrow-key step and Page step, as a share of the range. */
export const KNOB_STEP = 0.01;
export const KNOB_PAGE = 0.1;
/** Shift makes steps and drags ten times finer. */
export const KNOB_FINE = 0.1;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export function normalizedToAngle(normalized: number): number {
  return KNOB_START_DEG + KNOB_SWEEP_DEG * clamp01(normalized);
}

/** New normalized value after dragging `dyPx` (screen y; up = negative = more). */
export function dragToNormalized(startNormalized: number, dyPx: number, fine: boolean): number {
  const scale = fine ? KNOB_FINE : 1;
  return clamp01(startNormalized - (dyPx / KNOB_DRAG_PX) * scale);
}

/**
 * Physical value after a key press, or null when the key isn't a knob key.
 * Arrows step 1 %, Page Up/Down 10 %, Shift is ×0.1, Home/End jump to the
 * ends, Delete/Backspace restores the default.
 */
export function keyToValue(spec: NumberParamSpec, value: number, key: string, shift: boolean): number | null {
  const n = normalize(spec, value);
  const fine = shift ? KNOB_FINE : 1;
  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight':
      return denormalize(spec, clamp01(n + KNOB_STEP * fine));
    case 'ArrowDown':
    case 'ArrowLeft':
      return denormalize(spec, clamp01(n - KNOB_STEP * fine));
    case 'PageUp':
      return denormalize(spec, clamp01(n + KNOB_PAGE * fine));
    case 'PageDown':
      return denormalize(spec, clamp01(n - KNOB_PAGE * fine));
    case 'Home':
      return spec.min;
    case 'End':
      return spec.max;
    case 'Delete':
    case 'Backspace':
      return spec.default;
    default:
      return null;
  }
}

/** Human-readable value with its unit ("−3.0 dB", "1.2 kHz", "250 ms", "20 %"). */
export function formatParamValue(spec: NumberParamSpec, value: number): string {
  const v = clampToSpec(spec, value);
  const minus = (s: string) => s.replace('-', '−');
  switch (spec.unit) {
    case 'dB':
      return `${minus(v.toFixed(1))} dB`;
    case 'Hz':
      return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`;
    case 'ms':
      return `${Math.round(v)} ms`;
    case 's':
      return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
    case 'bits':
      return `${v.toFixed(Number.isInteger(v) ? 0 : 1)} bits`;
    case ':1':
      return `${v.toFixed(1)}:1`;
    case '%':
      return `${Math.round(v * 100)} %`;
    default:
      return v.toFixed(2);
  }
}

/** SVG arc path on a circle (angles in degrees, 0 = 12 o'clock, clockwise). */
export function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };
  const [x1, y1] = point(fromDeg);
  const [x2, y2] = point(toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  const sweep = toDeg >= fromDeg ? 1 : 0;
  return `M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${large} ${sweep} ${x2.toFixed(3)} ${y2.toFixed(3)}`;
}
