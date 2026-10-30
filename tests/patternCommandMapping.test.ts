/**
 * #523: libopenmpt's openmpt_module_get_pattern_row_channel_command indices are
 *   0 NOTE, 1 INSTRUMENT, 2 VOLUMEEFFECT, 3 EFFECT, 4 VOLUME, 5 PARAMETER
 * and the value of 2 / 3 are the internal VolumeCommand / EffectCommand enums of
 * soundlib/modcommand.h (not the XM/MOD letters). This boots the committed real-WASM libopenmpt,
 * loads modules synthesized at test time (scripts/lib/synth-xm.mjs) and pins:
 *   - what libopenmpt hands back for known cells (so the reader's index map cannot drift),
 *   - every PatternCell field the reader produces for them,
 *   - the exact u32s from all three GPU packers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LibOpenMPT, PatternMatrix } from '../types';
import { synthCommandTestS3m, synthCommandTestXm } from '../scripts/lib/synth-xm.mjs';
import { calculateNoteDurations, packPatternMatrix, packPatternMatrixComputeInput, packPatternMatrixHighPrecision } from '../utils/gpuPacking';
import { parseModuleWithLib } from '../utils/parseModuleWithLib';
import { loadLibOpenMPTNode } from './helpers/libopenmptNode';

const IDX = { NOTE: 0, INSTRUMENT: 1, VOLUMEEFFECT: 2, EFFECT: 3, VOLUME: 4, PARAMETER: 5 } as const;

let lib: LibOpenMPT;
let restore = () => {};
let xm: PatternMatrix;
let s3m: PatternMatrix;

/** Raw `[note, instrument, volumeEffect, effect, volume, parameter]` straight from the wasm. */
function rawCell(bytes: Uint8Array, row: number, ch: number): number[] {
  const ptr = lib._malloc(bytes.length);
  lib.HEAPU8.set(bytes, ptr);
  const mod = lib._openmpt_module_create_from_memory2(ptr, bytes.length, 0, 0, 0, 0, 0, 0, 0);
  lib._free(ptr);
  try {
    return [IDX.NOTE, IDX.INSTRUMENT, IDX.VOLUMEEFFECT, IDX.EFFECT, IDX.VOLUME, IDX.PARAMETER].map(
      (i) => lib._openmpt_module_get_pattern_row_channel_command(mod, 0, row, ch, i),
    );
  } finally {
    lib._openmpt_module_destroy(mod);
  }
}

beforeAll(async () => {
  ({ lib, restore } = await loadLibOpenMPTNode());
  xm = parseModuleWithLib(lib, synthCommandTestXm(), 'command-test.xm').patternMatrices[0]!;
  s3m = parseModuleWithLib(lib, synthCommandTestS3m(), 'command-test.s3m').patternMatrices[0]!;
}, 30_000);

afterAll(() => restore());

describe('what libopenmpt returns for the synthesized fixtures (no app code involved)', () => {
  const XM = synthCommandTestXm();

  // [row, channel, [note, instrument, volumeEffect, effect, volume, parameter]]
  it.each<[string, number, number, number[]]>([
    ['C-4 01 v40 A0F: set volume 64 + volume slide', 0, 0, [61, 1, 1, 11, 64, 0x0f]],
    ['--- -- p?? 037: panning + arpeggio', 1, 0, [0, 0, 2, 1, 32, 0x37]],
    ['E-4 02 --- C20: set volume effect', 2, 0, [65, 2, 0, 13, 0, 0x20]],
    ['--- -- --- EC2: note cut', 3, 0, [0, 0, 0, 19, 0, 0xc2]],
    ['--- -- v00 ---: set volume 0', 4, 0, [0, 0, 1, 0, 0, 0]],
    ['--- -- volslide-up 5', 5, 0, [0, 0, 3, 0, 5, 0]],
    ['=== key off', 6, 0, [255, 0, 0, 0, 0, 0]],
    ['--- -- --- ?37: effect byte with no XM meaning', 7, 0, [0, 0, 0, 0, 0, 0x37]],
    ['empty channel 1 row 3', 3, 1, [0, 0, 0, 0, 0, 0]],
  ])('%s', (_label, row, ch, expected) => {
    expect(rawCell(XM, row, ch)).toEqual(expected);
  });

  it('S3M: A07 is CMD_SPEED and SC3 is CMD_S3MCMDEX with parameter 0xC3', () => {
    const S3M = synthCommandTestS3m();
    expect(rawCell(S3M, 0, 0)).toEqual([61, 1, 1, 16, 32, 0x07]);
    expect(rawCell(S3M, 1, 0)).toEqual([0, 0, 0, 20, 0, 0xc3]);
  });
});

describe('getPatternMatrix cells (reader)', () => {
  const cell = (m: PatternMatrix, row: number, ch: number) => {
    const { type, note, inst, volCmd, volVal, effCmd, effVal } = m.rows[row]![ch]!;
    return { type, note, inst, volCmd, volVal, effCmd, effVal };
  };

  it('volume column: set volume 64 with a volume-slide effect', () => {
    expect(cell(xm, 0, 0)).toEqual({ type: 'note', note: 61, inst: 1, volCmd: 1, volVal: 64, effCmd: 11, effVal: 0x0f });
  });

  it('panning column + arpeggio', () => {
    expect(cell(xm, 1, 0)).toEqual({ type: 'effect', note: 0, inst: 0, volCmd: 2, volVal: 32, effCmd: 1, effVal: 0x37 });
  });

  it('set-volume effect', () => {
    expect(cell(xm, 2, 0)).toEqual({ type: 'note', note: 65, inst: 2, volCmd: 0, volVal: 0, effCmd: 13, effVal: 0x20 });
  });

  it('ECx note cut', () => {
    expect(cell(xm, 3, 0)).toEqual({ type: 'effect', note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 19, effVal: 0xc2 });
  });

  it('v00 and the volume-column slide', () => {
    expect(cell(xm, 4, 0)).toEqual({ type: 'effect', note: 0, inst: 0, volCmd: 1, volVal: 0, effCmd: 0, effVal: 0 });
    expect(cell(xm, 5, 0)).toEqual({ type: 'effect', note: 0, inst: 0, volCmd: 3, volVal: 5, effCmd: 0, effVal: 0 });
  });

  it('a command libopenmpt dropped (CMD_NONE) does not leak its leftover parameter', () => {
    expect(cell(xm, 7, 0)).toEqual({ type: 'empty', note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 });
  });

  it('untouched cells stay empty', () => {
    expect(cell(xm, 3, 1)).toEqual({ type: 'empty', note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 });
  });

  it('S3M SCx', () => {
    expect(cell(s3m, 1, 0)).toEqual({ type: 'effect', note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 20, effVal: 0xc3 });
  });
});

describe('note durations read the right columns', () => {
  it('ECx cuts the note on its row (CMD_MODCMDEX 0xCx); v00 with no active note does nothing', () => {
    const d = calculateNoteDurations(xm);
    // C-4 on row 0 runs until the E-4 on row 2; E-4 is cut by ECx on row 3
    expect(d[0]![0]).toMatchObject({ duration: 2, rowOffset: 0, isTrigger: true, isNoteOff: false });
    expect(d[2]![0]).toMatchObject({ duration: 2, rowOffset: 0, isTrigger: true });
    expect(d[3]![0]).toMatchObject({ duration: 2, rowOffset: 1, isNoteOff: true });
    // the last C-5 (row 8) is not cut by anything and sustains to the end of the 16-row pattern
    expect(d[8]![0]).toMatchObject({ duration: 8 });
  });

  it('S3M SCx cuts the note too', () => {
    const d = calculateNoteDurations(s3m);
    expect(d[0]![0]).toMatchObject({ duration: 2, isTrigger: true });
    expect(d[1]![0]).toMatchObject({ duration: 2, rowOffset: 1, isNoteOff: true });
  });
});

describe('exact packed u32s for the fixture (channel 0, 2 channels)', () => {
  // word index of (row, ch) in a 2-word-per-cell buffer with 2 channels
  const at = (data: Uint32Array, row: number, ch: number) => [data[(row * 2 + ch) * 2]!, data[(row * 2 + ch) * 2 + 1]!];
  const hex = (w: number[]) => w.map((x) => '0x' + (x >>> 0).toString(16).padStart(8, '0'));

  it('packPatternMatrix: [note|inst|volCmd|volVal] [0|effCmd|effVal] on note cells', () => {
    const { packedData } = packPatternMatrix(xm);
    expect(hex(at(packedData, 0, 0))).toEqual(['0x3d010140', '0x00000b0f']);
    expect(hex(at(packedData, 2, 0))).toEqual(['0x41020000', '0x00000d20']);
  });

  it('packPatternMatrixComputeInput: same layout, expression-only cells included', () => {
    const { packedData } = packPatternMatrixComputeInput(xm);
    expect(hex(at(packedData, 0, 0))).toEqual(['0x3d010140', '0x00000b0f']);
    expect(hex(at(packedData, 1, 0))).toEqual(['0x00000220', '0x00000137']);
    expect(hex(at(packedData, 2, 0))).toEqual(['0x41020000', '0x00000d20']);
    expect(hex(at(packedData, 3, 0))).toEqual(['0x00000000', '0x000013c2']);
    expect(hex(at(packedData, 4, 0))).toEqual(['0x00000100', '0x00000000']);
    expect(hex(at(packedData, 5, 0))).toEqual(['0x00000305', '0x00000000']);
  });

  it('packPatternMatrixHighPrecision: [note|inst|duration|volPacked] [effCmd|effVal|durFlags+trigger|volCmd]', () => {
    const { packedData } = packPatternMatrixHighPrecision(xm);
    // volPacked = (volCmd << 4) | volume intensity 0..15 (64 -> 15, 32 -> 8, slides 0..15 as is)
    expect(hex(at(packedData, 0, 0))).toEqual(['0x3d01021f', '0x0b0f8001']);
    expect(hex(at(packedData, 1, 0))).toEqual(['0x3d010228', '0x01370202']);
    expect(hex(at(packedData, 2, 0))).toEqual(['0x41020200', '0x0d208000']);
    expect(hex(at(packedData, 3, 0))).toEqual(['0x00800200', '0x13c20300']);
    expect(hex(at(packedData, 4, 0))).toEqual(['0x00800110', '0x00000001']);
    expect(hex(at(packedData, 5, 0))).toEqual(['0x00800135', '0x00000003']);
  });
});
