/**
 * #491 Phase 3: the 64-channel IT the engine benchmarks use (scripts/lib/synth-it.mjs) must be
 * what it claims — a valid IT with every channel live — or the "glitch count under a 64-channel
 * IT" numbers would be measuring something lighter.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { synthIt } from '../scripts/lib/synth-it.mjs';
import type { LibOpenMPT } from '../types';
import { loadLibOpenMPTNode } from './helpers/libopenmptNode';

describe('synthetic 64-channel IT benchmark fixture', () => {
  let lib: LibOpenMPT;
  let restore = () => {};

  beforeAll(async () => {
    ({ lib, restore } = await loadLibOpenMPTNode());
  }, 60_000);
  afterAll(() => restore());

  it('is deterministic', () => {
    expect(synthIt(64)).toEqual(synthIt(64));
    expect(synthIt(63)).not.toEqual(synthIt(64));
    expect(() => synthIt(65)).toThrow();
  });

  it('loads as a 64-channel IT and keeps every channel sounding', () => {
    const bytes = synthIt(64);
    const ptr = lib._malloc(bytes.length);
    lib.HEAPU8.set(bytes, ptr);
    const mod = lib._openmpt_module_create_from_memory2(ptr, bytes.length, 0, 0, 0, 0, 0, 0, 0);
    lib._free(ptr);
    expect(mod).not.toBe(0);
    expect(lib._openmpt_module_get_num_channels(mod)).toBe(64);
    expect(lib._openmpt_module_get_duration_seconds(mod)).toBeCloseTo(30.72, 1);
    const l = lib._malloc(4 * 128);
    const r = lib._malloc(4 * 128);
    // Part of the full C API the glue exports; the app's LibOpenMPT type lists only what it uses.
    const playingChannels = (lib as unknown as { _openmpt_module_get_current_playing_channels: (m: number) => number })
      ._openmpt_module_get_current_playing_channels;
    let playing = 0;
    for (let q = 0; q < 400; q++) {
      lib._openmpt_module_read_float_stereo(mod, 48000, 128, l, r);
      playing = Math.max(playing, playingChannels(mod));
    }
    lib._free(l);
    lib._free(r);
    lib._openmpt_module_destroy(mod);
    expect(playing).toBeGreaterThanOrEqual(64);
  });
});
