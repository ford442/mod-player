/**
 * Interpolation filter length for the JS AudioWorklet engine.
 *
 * Default is Sinc+LP (8): with real WebAssembly libopenmpt it costs a few percent of the
 * worklet quantum budget even at 64 channels (docs/planning/native-engine-bench-notes.md,
 * "JS engine: real WASM"). Cubic (4) — the only length the old wasm2js glue could afford — stays
 * available as an explicit opt-down for weak devices:
 *
 *   ?interp=4                       one session
 *   localStorage xasm1_js_interp=4  sticky (URL param wins)
 *
 * Accepts the libopenmpt-meaningful lengths only (1 nearest, 2 linear, 4 cubic, 8 sinc+LP);
 * anything else falls back to the default rather than silently picking a nearby filter.
 */
import {
  INTERPOLATION_SINC_LP,
  type OpenMPTInterpolationLength,
} from './openmptRenderParams';

export const JS_INTERPOLATION_STORAGE_KEY = 'xasm1_js_interp';

const VALID: readonly OpenMPTInterpolationLength[] = [1, 2, 4, 8];

export function parseInterpolationLength(raw: string | null | undefined): OpenMPTInterpolationLength | null {
  if (raw == null) return null;
  const n = Number(raw.trim());
  return (VALID as readonly number[]).includes(n) ? (n as OpenMPTInterpolationLength) : null;
}

export function resolveJsInterpolationLength(): OpenMPTInterpolationLength {
  try {
    const fromUrl = parseInterpolationLength(new URLSearchParams(window.location.search).get('interp'));
    if (fromUrl) return fromUrl;
    const fromStorage = parseInterpolationLength(localStorage.getItem(JS_INTERPOLATION_STORAGE_KEY));
    if (fromStorage) return fromStorage;
  } catch {
    /* no window / storage blocked — fall through to the default */
  }
  return INTERPOLATION_SINC_LP;
}
