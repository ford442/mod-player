/**
 * The xasm_* module-inspection shim (wasm/xasm_inspect.cpp → utils/moduleInspect.ts) against the
 * committed shared wasm:
 *   - sample headers, loops, PCM peaks, envelopes and keymaps equal what the synth fixtures wrote
 *     (scripts/lib/synth-inspect.mjs: MOD / XM / S3M; synth-it.mjs: IT);
 *   - `xasm_pattern_dump` equals the 6-call `openmpt_module_get_pattern_row_channel_command` path,
 *     cell for cell (the old path stays as the oracle);
 *   - `xasm_song_timeline` equals the `set_position_order_row` walk, and a 250-order 64-channel IT
 *     finishes under 200 ms;
 *   - a corrupt / truncated file is a 0 handle, not an abort.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LibOpenMPT } from '../../types';
import {
  MOD_SPEC,
  S3M_SPEC,
  XM_SPEC,
  synthInspectMod,
  synthInstrumentXm,
  synthSampleS3m,
} from '../../scripts/lib/synth-inspect.mjs';
import { synthCommandTestS3m, synthCommandTestXm, synthJumpXm, synthSongMapXm } from '../../scripts/lib/synth-xm.mjs';
import { synthIt } from '../../scripts/lib/synth-it.mjs';
import { corruptIt215Sample } from '../../scripts/lib/corrupt-it.mjs';
import {
  firstVisitSeconds,
  hasModuleInspect,
  ModuleInspector,
  XASM_INSPECT_ABI_VERSION,
  type InspectLib,
} from '../../utils/moduleInspect';
import { readInstrumentTable } from '../../utils/instrumentTable';
import { getPatternMatrix, patternMatrixFromDump } from '../../utils/patternExtractor';
import { parseModuleWithLib } from '../../utils/parseModuleWithLib';
import { readSongStructure, readSongStructureFromBytes } from '../../utils/readSongStructure';
import { readOpenMPTNameList } from '../../utils/parseModuleWithLib';
import { loadLibOpenMPTNode } from '../helpers/libopenmptNode';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const publicFile = (name: string) => new Uint8Array(readFileSync(join(ROOT, 'public', name)));

let lib: LibOpenMPT & InspectLib;
let restore = () => {};

beforeAll(async () => {
  const loaded = await loadLibOpenMPTNode();
  restore = loaded.restore;
  if (!hasModuleInspect(loaded.lib)) throw new Error('committed shared glue has no xasm_* inspection shim at this ABI');
  lib = loaded.lib as LibOpenMPT & InspectLib;
}, 30_000);

afterAll(() => restore());

function withInspector<T>(bytes: Uint8Array, run: (i: ModuleInspector) => T, skipSamples = false): T {
  const inspector = ModuleInspector.open(lib, bytes, { skipSamples });
  expect(inspector).not.toBeNull();
  try {
    return run(inspector!);
  } finally {
    inspector!.destroy();
  }
}

function withModule<T>(bytes: Uint8Array, run: (mod: number) => T): T {
  const ptr = lib._malloc(bytes.length);
  lib.HEAPU8.set(bytes, ptr);
  const mod = lib._openmpt_module_create_from_memory2(ptr, bytes.length, 0, 0, 0, 0, 0, 0, 0);
  lib._free(ptr);
  expect(mod).not.toBe(0);
  try {
    return run(mod);
  } finally {
    lib._openmpt_module_destroy(mod);
  }
}

function namesOf(bytes: Uint8Array) {
  return withModule(bytes, (mod) => ({
    format: '',
    instrumentNames: readOpenMPTNameList(lib, mod, lib._openmpt_module_get_num_instruments(mod), lib._openmpt_module_get_instrument_name),
    sampleNames: readOpenMPTNameList(lib, mod, lib._openmpt_module_get_num_samples(mod), lib._openmpt_module_get_sample_name),
  }));
}

describe('ABI', () => {
  it('the committed shared wasm reports the wrapper\'s ABI version', () => {
    expect(lib._xasm_inspect_abi_version()).toBe(XASM_INSPECT_ABI_VERSION);
  });

  it('a corrupt file is a 0 handle (exceptions caught inside), and the runtime lives on', () => {
    const junk = new Uint8Array(4096).map((_, i) => (i * 2654435761) >>> 24);
    expect(ModuleInspector.open(lib, junk)).toBeNull();
    // Just the magic: nothing libopenmpt can load.
    expect(ModuleInspector.open(lib, corruptIt215Sample().subarray(0, 8))).toBeNull();
    // A recoverable malformed IT (truncated IT215 block, caught by type) still opens.
    withInspector(corruptIt215Sample(), (i) => expect(i.sampleCount()).toBe(1));
    withInspector(synthInspectMod(), (i) => expect(i.sampleCount()).toBe(31));
  });

  it('bad indices are null / empty, and a destroyed handle throws', () => {
    const i = ModuleInspector.open(lib, synthInspectMod())!;
    expect(i.sampleInfo(0)).toBeNull();
    expect(i.sampleInfo(32)).toBeNull();
    expect(i.samplePeaks(3)).toHaveLength(0); // name-only sample
    expect(i.envelope(1, 'volume')).toBeNull(); // MOD: no instruments
    expect(i.keymap(1)).toBeNull();
    expect(i.dumpPattern(99).rows).toBe(0);
    i.destroy();
    i.destroy();
    expect(() => i.info()).toThrow(/after destroy/);
  });

  it('frees every heap block it allocates', () => {
    const bytes = synthInstrumentXm();
    const probe = () => {
      const p = lib._malloc(16);
      lib._free(p);
      return p;
    };
    // Warm up allocator bins, then a full read must leave the next small allocation where it was.
    withInspector(bytes, (i) => readInstrumentTable(i, namesOf(bytes)));
    const before = probe();
    withInspector(bytes, (i) => {
      readInstrumentTable(i, namesOf(bytes));
      i.dumpPattern(0);
      i.songTimeline(0);
    });
    expect(probe()).toBe(before);
  });
});

describe('samples — ProTracker MOD', () => {
  const bytes = synthInspectMod();

  it('lengths, loops, volume and finetune are what the synth wrote', () => {
    withInspector(bytes, (i) => {
      expect(i.info()).toMatchObject({ numChannels: 4, numSamples: 31, numInstruments: 0 });
      MOD_SPEC.samples.forEach((spec, k) => {
        const s = i.sampleInfo(k + 1)!;
        expect(s.length).toBe(spec.frames);
        expect(s.flags.hasPcm).toBe(spec.frames > 0);
        expect(s.flags.is16Bit).toBe(false);
        expect(s.flags.loop).toBe(spec.loopLength > 0);
        if (spec.loopLength > 0) {
          expect(s.loopStart).toBe(spec.loopStart);
          expect(s.loopEnd).toBe(spec.loopStart + spec.loopLength);
        }
        if (spec.frames > 0) {
          expect(s.volume).toBe(spec.volume * 4);
          // MOD finetune nibbles are 1/8 semitone; libopenmpt stores 1/128.
          expect(s.finetune).toBe(spec.finetune * 16);
        }
      });
    });
  });

  it('peaks are min/max per bucket of the synth\'s full-scale sine', () => {
    withInspector(bytes, (i) => {
      const peaks = i.samplePeaks(1, 16);
      expect(peaks).toHaveLength(32);
      for (let b = 0; b < 16; b++) {
        expect(peaks[2 * b]).toBeCloseTo(-127 / 128, 5);
        expect(peaks[2 * b + 1]).toBeCloseTo(127 / 128, 5);
      }
      const pcm = i.samplePcm(1);
      expect(pcm).toHaveLength(MOD_SPEC.samples[0]!.frames);
      expect(pcm[16]).toBeCloseTo(127 / 128, 5); // sin(π/2), period 64
    });
  });

  it('the table lists one instrument per sample (no instruments in MOD), with C API names', () => {
    const table = withInspector(bytes, (i) => readInstrumentTable(i, { ...namesOf(bytes), format: 'mod' }));
    expect(table.format).toBe('mod');
    expect(table.samples).toHaveLength(31);
    expect(table.instruments).toHaveLength(31);
    expect(table.samples[0]).toMatchObject({ name: 'mod sine looped', length: 2048, bytes: 2048, loopStart: 512, loopEnd: 1536, volume: 48, hasPcm: true });
    expect(table.samples[1]).toMatchObject({ name: 'mod one-shot', loopStart: 0, loopEnd: 0 });
    expect(table.samples[2]).toMatchObject({ name: 'mod name only', length: 0, hasPcm: false });
    expect(table.samples[0]!.waveform).toHaveLength(256);
    expect(table.instruments[0]).toMatchObject({ index: 1, sampleIndices: [1] });
  });
});

describe('instruments — XM (multi-sample instrument, envelopes, keymap)', () => {
  const bytes = synthInstrumentXm();
  const [ins1, ins2] = XM_SPEC.instruments;

  it('samples are numbered globally in instrument order, with their own headers', () => {
    withInspector(bytes, (i) => {
      expect(i.info()).toMatchObject({ numSamples: 3, numInstruments: 2 });
      const all = XM_SPEC.instruments.flatMap((ins) => ins.samples);
      all.forEach((spec, k) => {
        const s = i.sampleInfo(k + 1)!;
        expect(s.length).toBe(spec.frames);
        expect(s.flags.is16Bit).toBe(spec.is16Bit);
        expect(s.flags.loop).toBe(spec.loopType !== 0);
        expect(s.flags.pingPongLoop).toBe(spec.loopType === 2);
        if (spec.loopType) {
          expect(s.loopStart).toBe(spec.loopStart);
          expect(s.loopEnd).toBe(spec.loopStart + spec.loopLength);
        }
        expect(s.volume).toBe(spec.volume * 4);
        expect(s.finetune).toBe(spec.finetune);
        expect(s.relativeTone).toBe(spec.relativeNote);
        expect(s.pan).toBe(spec.pan);
      });
    });
  });

  it('a 16-bit ramp peaks where the ramp is', () => {
    withInspector(bytes, (i) => {
      const peaks = i.samplePeaks(2, 2); // first half −0.5..0, second half 0..0.5
      expect(peaks[0]).toBeCloseTo(-0.5, 3);
      expect(peaks[1]).toBeLessThanOrEqual(0.001);
      expect(peaks[2]).toBeGreaterThanOrEqual(-0.001);
      expect(peaks[3]).toBeCloseTo(0.5, 3);
    });
  });

  it('envelopes: points, sustain, loop and flags as written', () => {
    withInspector(bytes, (i) => {
      const vol = i.envelope(1, 'volume')!;
      const spec = ins1!.volumeEnvelope!;
      expect(vol.points).toEqual(spec.points.map(([tick, value]) => ({ tick, value })));
      expect(vol).toMatchObject({ enabled: true, sustain: true, loop: true, sustainStart: spec.sustain, sustainEnd: spec.sustain, loopStart: spec.loopStart, loopEnd: spec.loopEnd, releaseNode: null });
      const pan = i.envelope(1, 'panning')!;
      expect(pan.points).toEqual(ins1!.panningEnvelope!.points.map(([tick, value]) => ({ tick, value })));
      expect(pan).toMatchObject({ enabled: true, sustain: false, loop: false });
      expect(i.envelope(1, 'pitch')!.points).toEqual([]);
      expect(i.envelope(2, 'volume')).toMatchObject({ enabled: false, points: [] });
      expect(i.instrumentInfo(1)).toMatchObject({ fadeOut: ins1!.fadeOut });
    });
  });

  it('keymap: the split plays sample 1 below it and sample 2 above (XM key k = note k + 12)', () => {
    withInspector(bytes, (i) => {
      const km = i.keymap(1)!.samples;
      for (let k = 0; k < 96; k++) expect(km[k + 12]).toBe(k < ins1!.splitNote ? 1 : 2);
      const km2 = i.keymap(2)!.samples;
      for (let k = 0; k < 96; k++) expect(km2[k + 12]).toBe(3);
    });
  });

  it('the table names every sample by ITSELF, not by its instrument (the old index fill-in bug)', () => {
    const table = withInspector(bytes, (i) => readInstrumentTable(i, { ...namesOf(bytes), format: 'xm' }));
    expect(table.samples.map((s) => s.name)).toEqual(XM_SPEC.instruments.flatMap((ins) => ins.samples.map((s) => s.name)));
    expect(table.instruments.map((ins) => [ins.name, ins.sampleIndices])).toEqual([
      [ins1!.name, [1, 2]],
      [ins2!.name, [3]],
    ]);
    expect(table.instruments[0]!.samples.map((s) => s.name)).toEqual(ins1!.samples.map((s) => s.name));
    expect(table.instruments[0]!.envelopes!.volume.points).toHaveLength(4);
    expect(table.samples[1]).toMatchObject({ bytes: 6000, is16Bit: true, pingPongLoop: true });
  });
});

describe('samples — S3M and IT (formats the old TS parsers missed or half-covered)', () => {
  it('S3M: two samples with loops and C2 speed (#528)', () => {
    const bytes = synthSampleS3m();
    const table = withInspector(bytes, (i) => readInstrumentTable(i, { ...namesOf(bytes), format: 's3m' }));
    expect(table.samples).toHaveLength(2);
    S3M_SPEC.samples.forEach((spec, k) => {
      expect(table.samples[k]).toMatchObject({
        name: spec.name,
        length: spec.frames,
        loopStart: spec.loop ? spec.loopStart : 0,
        loopEnd: spec.loop ? spec.loopEnd : 0,
        volume: spec.volume,
        sampleRate: spec.c2spd,
        hasPcm: true,
      });
      expect(Math.max(...table.samples[k]!.waveform)).toBeGreaterThan(0.9);
    });
  });

  it('IT (sample mode): four 16-bit looped samples with their C5 speeds', () => {
    const bytes = synthIt(4, { sampleFrames: 2048 });
    withInspector(bytes, (i) => {
      expect(i.sampleCount()).toBe(4);
      for (let s = 1; s <= 4; s++) {
        const info = i.sampleInfo(s)!;
        expect(info).toMatchObject({ length: 2048, loopStart: 0, loopEnd: 2048, sampleRate: 8363 * s });
        expect(info.flags).toMatchObject({ is16Bit: true, loop: true, hasPcm: true });
      }
    });
  });

  it('a structure-only handle (skipSamples) keeps headers but no PCM', () => {
    withInspector(synthInspectMod(), (i) => {
      expect(i.sampleInfo(1)!.flags.hasPcm).toBe(false);
      expect(i.samplePeaks(1)).toHaveLength(0);
    }, true);
  });
});

describe('xasm_pattern_dump equals the 6-call path, cell for cell', () => {
  const fixtures: Array<[string, Uint8Array]> = [
    ['4-mat_madness.mod', publicFile('4-mat_madness.mod')],
    ['libopenmpt-test.mod', publicFile('libopenmpt-test.mod')],
    ['test.xm', publicFile('test.xm')],
    ['command test XM', synthCommandTestXm()],
    ['command test S3M', synthCommandTestS3m()],
    ['instrument XM', synthInstrumentXm()],
    ['64-channel IT', synthIt(64, { patterns: 3 })],
  ];
  for (const [name, bytes] of fixtures) {
    it(name, () => {
      withModule(bytes, (mod) => withInspector(bytes, (i) => {
        const patterns = i.info().numPatterns;
        expect(patterns).toBeGreaterThan(0);
        for (let p = 0; p < patterns; p++) {
          const oracle = getPatternMatrix(lib, mod, p, 7);
          const fast = patternMatrixFromDump(i.dumpPattern(p), 7);
          expect(fast).toEqual(oracle);
        }
      }));
    });
  }
});

describe('xasm_song_timeline equals the set_position_order_row walk', () => {
  const fixtures: Array<[string, Uint8Array]> = [
    ['4-mat_madness.mod', publicFile('4-mat_madness.mod')],
    ['libopenmpt-test.mod (pattern loops + jumps)', publicFile('libopenmpt-test.mod')],
    ['test.xm', publicFile('test.xm')],
    ['song-map XM (tempo / speed changes)', synthSongMapXm()],
    ['jump XM', synthJumpXm()],
  ];
  for (const [name, bytes] of fixtures) {
    it(name, () => {
      const timeline = withInspector(bytes, (i) => i.songTimeline(0));
      const everyTick = withInspector(bytes, (i) => i.songTimeline(0, { everyTick: true }));
      expect(timeline.capped).toBe(false);
      // The fast walk (first tick per row, unless the row moves the tempo) is the every-tick walk.
      expect(timeline.visits.map((v) => [v.order, v.entryRow, v.exitRow])).toEqual(everyTick.visits.map((v) => [v.order, v.entryRow, v.exitRow]));
      timeline.visits.forEach((v, k) => expect(Math.abs(v.startSeconds - everyTick.visits[k]!.startSeconds)).toBeLessThan(0.001));
      withModule(bytes, (mod) => {
        // First visit of every order on libopenmpt's own clock (the oracle seeks to the first time).
        for (const v of firstVisitSeconds(timeline).values()) {
          lib._openmpt_module_set_position_order_row(mod, v.order, v.entryRow);
          expect(Math.abs(lib._openmpt_module_get_position_seconds(mod) - v.startSeconds)).toBeLessThan(0.001);
        }
        expect(Math.abs(timeline.durationSeconds - lib._openmpt_module_get_duration_seconds(mod))).toBeLessThan(0.001);
      });
    });
  }

  it('the song structure from the timeline equals the quadratic one', () => {
    for (const bytes of [synthSongMapXm(), synthJumpXm(), publicFile('4-mat_madness.mod')]) {
      const quadratic = withModule(bytes, (mod) => readSongStructure(lib, mod));
      const linear = readSongStructureFromBytes(lib, bytes);
      expect(linear.approximate).toBe(false);
      expect(linear.playOrder).toEqual(quadratic.playOrder);
      expect(linear.jumps).toEqual(quadratic.jumps);
      linear.orders.forEach((o, k) => {
        const q = quadratic.orders[k]!;
        expect({ ...o, startSeconds: 0, durationSeconds: 0 }).toEqual({ ...q, startSeconds: 0, durationSeconds: 0 });
        expect(Math.abs(o.startSeconds - q.startSeconds)).toBeLessThan(0.001);
        expect(Math.abs(o.durationSeconds - q.durationSeconds)).toBeLessThan(0.001);
      });
      // Tempo events: the same changes (libopenmpt's own, at the row they happen).
      expect(linear.tempoEvents.map((e) => [e.order, e.row, e.bpm, e.speed])).toEqual(quadratic.tempoEvents.map((e) => [e.order, e.row, e.bpm, e.speed]));
    }
  });

  it('a 250-order 64-channel IT walks in under 200 ms (the quadratic walk needs seconds)', () => {
    const orders = Array.from({ length: 250 }, (_, k) => k % 16);
    const bytes = synthIt(64, { patterns: 16, orders, sampleFrames: 4096 });
    withInspector(bytes, (i) => {
      i.songTimeline(0); // JIT warm-up
      // Best of three: the bound is about the algorithm (linear), not a loaded CI runner's noise.
      let ms = Number.POSITIVE_INFINITY;
      let timeline = i.songTimeline(0);
      for (let run = 0; run < 3; run++) {
        const t0 = performance.now();
        timeline = i.songTimeline(0);
        ms = Math.min(ms, performance.now() - t0);
      }
      expect(timeline.visits).toHaveLength(250);
      expect(timeline.durationSeconds).toBeCloseTo(250 * 64 * 0.12, 6);
      expect(ms).toBeLessThan(200);
    }, true);
  });
});

describe('the parse path (utils/parseModuleWithLib.ts) on the shim', () => {
  it('patterns, metadata and the instrument table from one inspection handle + a skip-samples metadata module', () => {
    const bytes = synthInstrumentXm();
    const parsed = parseModuleWithLib(lib, bytes, 'x.xm');
    expect(parsed.metadata).toMatchObject({ format: 'xm', numInstruments: 2, numSamples: 3, numChannels: 2 });
    expect(parsed.metadata.samples).toEqual(XM_SPEC.instruments.flatMap((ins) => ins.samples.map((s) => s.name)));
    expect(parsed.instrumentTable.samples[0]!.hasPcm).toBe(true); // the inspection handle has the PCM
    expect(parsed.instrumentTable.instruments.map((i) => i.sampleIndices)).toEqual([[1, 2], [3]]);
    withModule(bytes, (mod) => expect(parsed.patternMatrices[0]).toEqual(getPatternMatrix(lib, mod, 0, 0)));
  });

  it('the skip-samples metadata equals a full load\'s (names, duration, orders)', () => {
    for (const bytes of [publicFile('4-mat_madness.mod'), synthInstrumentXm(), synthSongMapXm()]) {
      const parsed = parseModuleWithLib(lib, bytes, 'f');
      withModule(bytes, (mod) => {
        expect(parsed.metadata.durationSeconds).toBeCloseTo(lib._openmpt_module_get_duration_seconds(mod), 9);
        expect(parsed.metadata.numOrders).toBe(lib._openmpt_module_get_num_orders(mod));
        expect(parsed.metadata.samples).toEqual(readOpenMPTNameList(lib, mod, lib._openmpt_module_get_num_samples(mod), lib._openmpt_module_get_sample_name));
      });
    }
  });
});
