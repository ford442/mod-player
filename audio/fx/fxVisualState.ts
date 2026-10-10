/**
 * FX rack → chassis shader values (#453). Main chunk, allocation-free reads.
 *
 * The rack's *settings* (not audio analysis) drive the v0.61 chassis: tape
 * drive, EQ tilt, room mix, and which modules are on. The store writes targets
 * when the effective state changes; the render loop reads them every frame,
 * smoothed so a preset change eases in rather than snapping.
 *
 * Bezel uniform slots (bezel_fx.wgsl / lib/fx_chassis.wgsl):
 *   24 drive 0…1 · 25 tone 0…1 (0.5 neutral) · 26 room 0…1 · 27 module bitmask
 */
import { isModuleActive, type FxRackState } from './types';

export const FX_UNIFORM_SLOTS = { drive: 24, tone: 25, room: 26, modules: 27 } as const;
/** Bytes of the bezel uniform the host writes for an fxUniforms background. */
export const FX_BEZEL_UNIFORM_BYTES = (FX_UNIFORM_SLOTS.modules + 1) * 4;
export const FX_MODULE_BITS = { character: 1, eq: 2, comp: 4, room: 8 } as const;
/** Visual smoothing time constant. */
const SMOOTH_MS = 120;
const NEUTRAL_TONE = 0.5;

const target = new Float32Array([0, NEUTRAL_TONE, 0, 0]);
const current = new Float32Array([0, NEUTRAL_TONE, 0, 0]);
let lastMs = -1;

/** Compute the shader targets for a rack state. `roomAvailable`: false when the room can't load here. */
export function fxVisualTargets(state: FxRackState, roomAvailable = true, out = new Float32Array(4)): Float32Array {
  const character = state.modules.character.params;
  const eq = state.modules.eq.params;
  const roomOn = isModuleActive(state, 'room') && roomAvailable;
  out[0] = isModuleActive(state, 'character') && character.tapeOn ? character.drive : 0;
  out[1] = isModuleActive(state, 'eq')
    ? Math.min(1, Math.max(0, NEUTRAL_TONE + (eq.highGain - eq.lowGain) / 48))
    : NEUTRAL_TONE;
  out[2] = roomOn ? state.modules.room.params.mix : 0;
  out[3] =
    (isModuleActive(state, 'character') ? FX_MODULE_BITS.character : 0) |
    (isModuleActive(state, 'eq') ? FX_MODULE_BITS.eq : 0) |
    (isModuleActive(state, 'comp') ? FX_MODULE_BITS.comp : 0) |
    (roomOn ? FX_MODULE_BITS.room : 0);
  return out;
}

export function setFxVisualTargets(state: FxRackState, roomAvailable = true): void {
  fxVisualTargets(state, roomAvailable, target);
}

/**
 * Smoothed values into `out[offset … offset + 3]` (drive, tone, room, mask).
 * Called per frame by the renderer — no allocation.
 */
export function readFxVisual(nowMs: number, out: Float32Array, offset = 0): void {
  const dt = lastMs < 0 ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - lastMs);
  lastMs = nowMs;
  const k = dt === Number.POSITIVE_INFINITY ? 1 : 1 - Math.exp(-dt / SMOOTH_MS);
  for (let i = 0; i < 3; i++) {
    current[i] = current[i]! + (target[i]! - current[i]!) * k;
    out[offset + i] = current[i]!;
  }
  // The LED mask switches, it doesn't fade.
  current[3] = target[3]!;
  out[offset + 3] = current[3]!;
}

/** Tests. */
export function resetFxVisualState(): void {
  target.set([0, NEUTRAL_TONE, 0, 0]);
  current.set([0, NEUTRAL_TONE, 0, 0]);
  lastMs = -1;
}
