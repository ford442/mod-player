/**
 * Per-shader bloom profiles for the layered BloomPostProcessor.
 *
 * Each profile has exactly 3 BloomLayer entries (required by BloomPostProcessor).
 * Layer order is always [trigger, sustain, expression/trace] — the composite shader
 * reads them by index, so order is semantically significant.
 *
 * Threshold calibration notes
 * ───────────────────────────
 * Values are read from the ACES-tonemapped framebuffer (range 0–1).
 * ACES compresses HDR values: an emitter writing intensity=1.0+bloom will land
 * around 0.85–0.95 in the framebuffer after tonemapping.
 *
 * Three-emitter LED brightness reference (calculateSustainBrightness):
 *   Note-on trigger row : intensity = 0.8 + bloom*2.0 → ~0.88–0.95 post-ACES
 *   Sustain middle rows : intensity = 0.40–0.60 of base → ~0.40–0.55 post-ACES
 *   Sustain fade-out    : intensity = 0.30–0.60 of base → ~0.30–0.52 post-ACES
 *   Expression-only     : intensity = 1.0 + bloom*2.0 (amber emitter) → ~0.88–0.95
 *
 * Oscilloscope trace (v0.55):
 *   Trace center        : traceIntensity * 1.5, green-tinted → ~0.55–0.95 post-ACES
 *   Trace edge falloff  : smoothstep → ~0.10–0.55
 */

import type { BloomLayer } from './bloomPostProcessor';

// ─── Profile: circular-led ───────────────────────────────────────────────────
// For simpler circular shaders (v0.45, v0.46, v0.45b, v0.47, v0.48, v0.49).
// Single-emitter per cell; lower internal scattering than three-emitter shaders.
// • trigger    : threshold 0.82 → catches note-on bright flash reliably
// • sustain    : threshold 0.42 → catches 45% sustain intensity (was 0.50, causing
//                missed bloom on most sustain rows — the primary reported bug)
// • expression : threshold 0.72 → amber expression tint on vol/effect cells
export const BLOOM_CIRCULAR_LED: readonly BloomLayer[] = [
  { label: 'trigger',    threshold: 0.82, blurRadius: 0.8, tint: [0.4, 0.6, 1.0], weight: 1.4 },
  { label: 'sustain',    threshold: 0.42, blurRadius: 2.0, tint: [0.2, 0.4, 0.8], weight: 0.7 },
  { label: 'expression', threshold: 0.72, blurRadius: 1.0, tint: [1.0, 0.5, 0.1], weight: 1.0 },
];

// ─── Profile: three-emitter ──────────────────────────────────────────────────
// For three-emitter LED shaders (v0.50, v0.51).
// These run internal multi-emitter scattering + ACES tonemapping, so the
// framebuffer already has a partial glow baked in before the post-process pass.
// • trigger    : weight reduced (1.2 vs 1.4) to prevent double-halo on bright
//                note-on rows that are already strongly lit by internal scatter
// • sustain    : threshold 0.40 → consistently catches the 40–45% sustain rows
//                (the 0.50 default was the main source of inconsistent sustain glow)
// • expression : amber tint kept — expression-only amber emitter is semantically
//                distinct and intentionally warm
export const BLOOM_THREE_EMITTER: readonly BloomLayer[] = [
  { label: 'trigger',    threshold: 0.78, blurRadius: 0.8, tint: [0.4, 0.6, 1.0], weight: 1.2 },
  { label: 'sustain',    threshold: 0.40, blurRadius: 2.0, tint: [0.2, 0.4, 0.8], weight: 0.65 },
  { label: 'expression', threshold: 0.72, blurRadius: 1.0, tint: [1.0, 0.5, 0.1], weight: 0.9 },
];

// ─── Profile: three-emitter-osc ──────────────────────────────────────────────
// For v0.55 (three-emitter LEDs + inner oscilloscope waveform trace).
// The oscilloscope trace emits vec3(0.3, 1.0, 0.5)*intensity*1.5 (green).
// With DEFAULT_LAYERS the amber expression tint was applied to trace pixels because
// trace luminance (~0.55–0.95) exceeds the expression threshold (0.75), tinting
// the green trace warm-orange. This profile replaces expression with a trace-specific
// layer:
// • trigger    : same as three-emitter (LED note-on flash)
// • sustain    : same as three-emitter (LED sustain tail)
// • trace      : threshold 0.50 → catches trace body; green tint [0.3,1.0,0.5]
//                matches the trace's own emission color so bloom is coherent
export const BLOOM_THREE_EMITTER_OSC: readonly BloomLayer[] = [
  { label: 'trigger',    threshold: 0.78, blurRadius: 0.8, tint: [0.4, 0.6, 1.0], weight: 1.2 },
  { label: 'sustain',    threshold: 0.40, blurRadius: 2.0, tint: [0.2, 0.4, 0.8], weight: 0.65 },
  { label: 'trace',      threshold: 0.50, blurRadius: 1.2, tint: [0.3, 1.0, 0.5], weight: 0.9 },
];

// Registry: maps profile id string → layer array
export const BLOOM_PROFILES: Record<string, readonly BloomLayer[]> = {
  'circular-led':        BLOOM_CIRCULAR_LED,
  'three-emitter':       BLOOM_THREE_EMITTER,
  'three-emitter-osc':   BLOOM_THREE_EMITTER_OSC,
};

export type BloomProfileId = keyof typeof BLOOM_PROFILES;

/** Look up a bloom profile by id. Falls back to BLOOM_CIRCULAR_LED for unknown ids. */
export function getBloomProfile(id: string): readonly BloomLayer[] {
  return BLOOM_PROFILES[id] ?? BLOOM_CIRCULAR_LED;
}
