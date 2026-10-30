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
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LibOpenMPT, PatternMatrix } from '../types';
import { synthCommandTestS3m, synthCommandTestXm } from '../scripts/lib/synth-xm.mjs';
import { calculateNoteDurations, packPatternMatrix, packPatternMatrixComputeInput, packPatternMatrixHighPrecision } from '../utils/gpuPacking';
import {
  EffectCommand as CMD,
  PatternCommand,
  VolumeCommand as VOL,
  isNoteCutEffect,
  isVolumeColumnOff,
  packVolNibbles,
} from '../utils/openmptCommands';
import { parseModuleWithLib } from '../utils/parseModuleWithLib';
import { loadLibOpenMPTNode } from './helpers/libopenmptNode';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

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
    const { NOTE, INSTRUMENT, VOLUMEEFFECT, EFFECT, VOLUME, PARAMETER } = PatternCommand;
    return [NOTE, INSTRUMENT, VOLUMEEFFECT, EFFECT, VOLUME, PARAMETER].map(
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

  // [label, row, channel, [note, instrument, volumeEffect, effect, volume, parameter]] — the
  // commands are named, so these also pin utils/openmptCommands.ts to what the wasm returns.
  it.each<[string, number, number, number[]]>([
    ['C-4 01 v40 A0F: set volume 64 + volume slide', 0, 0, [61, 1, VOL.VOLCMD_VOLUME, CMD.CMD_VOLUMESLIDE, 64, 0x0f]],
    ['--- -- p?? 037: panning + arpeggio', 1, 0, [0, 0, VOL.VOLCMD_PANNING, CMD.CMD_ARPEGGIO, 32, 0x37]],
    ['E-4 02 --- C20: set volume effect', 2, 0, [65, 2, VOL.VOLCMD_NONE, CMD.CMD_VOLUME, 0, 0x20]],
    ['--- -- --- EC2: note cut', 3, 0, [0, 0, VOL.VOLCMD_NONE, CMD.CMD_MODCMDEX, 0, 0xc2]],
    ['--- -- v00 ---: set volume 0', 4, 0, [0, 0, VOL.VOLCMD_VOLUME, CMD.CMD_NONE, 0, 0]],
    ['--- -- volslide-up 5', 5, 0, [0, 0, VOL.VOLCMD_VOLSLIDEUP, CMD.CMD_NONE, 5, 0]],
    ['=== key off', 6, 0, [255, 0, VOL.VOLCMD_NONE, CMD.CMD_NONE, 0, 0]],
    // Open question of #523: libopenmpt CAN hand back CMD_NONE together with a non-zero parameter
    // (a command it has no mapping for keeps its parameter byte). The reader must not treat that
    // as an effect — see the reader tests below.
    ['--- -- --- ?37: effect byte with no XM meaning keeps its parameter', 7, 0, [0, 0, VOL.VOLCMD_NONE, CMD.CMD_NONE, 0, 0x37]],
    ['empty channel 1 row 3', 3, 1, [0, 0, 0, 0, 0, 0]],
  ])('%s', (_label, row, ch, expected) => {
    expect(rawCell(XM, row, ch)).toEqual(expected);
  });

  it('S3M: A07 is CMD_SPEED and SC3 is CMD_S3MCMDEX with parameter 0xC3', () => {
    const S3M = synthCommandTestS3m();
    expect(rawCell(S3M, 0, 0)).toEqual([61, 1, VOL.VOLCMD_VOLUME, CMD.CMD_SPEED, 32, 0x07]);
    expect(rawCell(S3M, 1, 0)).toEqual([0, 0, VOL.VOLCMD_NONE, CMD.CMD_S3MCMDEX, 0, 0xc3]);
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
    // v00 with no sounding note is a standalone cut, flagged isNoteOff (durFlags bit 0) like a note-off
    expect(hex(at(packedData, 4, 0))).toEqual(['0x00800110', '0x00000101']);
    expect(hex(at(packedData, 5, 0))).toEqual(['0x00800135', '0x00000003']);
  });
});

describe('utils/openmptCommands', () => {
  it('PatternCommand indices are libopenmpt\'s (volume column = 4, effect command = 3)', () => {
    expect(PatternCommand).toEqual({ NOTE: 0, INSTRUMENT: 1, VOLUMEEFFECT: 2, EFFECT: 3, VOLUME: 4, PARAMETER: 5 });
  });

  it('keeps the values the packers and shaders rely on (modcommand.h 0.8.9)', () => {
    expect(VOL).toMatchObject({ VOLCMD_NONE: 0, VOLCMD_VOLUME: 1, VOLCMD_PANNING: 2, VOLCMD_OFFSET: 15 });
    expect(CMD).toMatchObject({ CMD_NONE: 0, CMD_ARPEGGIO: 1, CMD_VOLUME: 13, CMD_MODCMDEX: 19, CMD_S3MCMDEX: 20, CMD_VOLUMEDOWN_ETX: 57 });
    // no two commands share a value, and every value is a byte
    for (const table of [VOL, CMD]) {
      const values = Object.values(table);
      expect(new Set(values).size).toBe(values.length);
      expect(values.every((v) => v >= 0 && v < 256)).toBe(true);
    }
  });

  it('isNoteCutEffect: ECx and SCx only', () => {
    expect(isNoteCutEffect(CMD.CMD_MODCMDEX, 0xc0)).toBe(true);
    expect(isNoteCutEffect(CMD.CMD_MODCMDEX, 0xc2)).toBe(true);
    expect(isNoteCutEffect(CMD.CMD_S3MCMDEX, 0xc3)).toBe(true);
    expect(isNoteCutEffect(CMD.CMD_MODCMDEX, 0xd2)).toBe(false); // EDx note delay
    expect(isNoteCutEffect(CMD.CMD_PATTERNBREAK, 0xc2)).toBe(false);
    expect(isNoteCutEffect(14, 0xc2)).toBe(false); // the old "E = 14" guess is CMD_PATTERNBREAK
    expect(isNoteCutEffect(CMD.CMD_NONE, 0xc2)).toBe(false);
  });

  it('isVolumeColumnOff: only "set volume 0"', () => {
    expect(isVolumeColumnOff(VOL.VOLCMD_VOLUME, 0)).toBe(true);
    expect(isVolumeColumnOff(VOL.VOLCMD_VOLUME, 1)).toBe(false);
    expect(isVolumeColumnOff(VOL.VOLCMD_PANNING, 0)).toBe(false);
    expect(isVolumeColumnOff(VOL.VOLCMD_NONE, 0)).toBe(false);
  });

  it('packVolNibbles: exact command high nibble, 0..15 intensity low nibble', () => {
    expect(packVolNibbles(VOL.VOLCMD_VOLUME, 64)).toBe(0x1f);
    expect(packVolNibbles(VOL.VOLCMD_VOLUME, 32)).toBe(0x18);
    expect(packVolNibbles(VOL.VOLCMD_VOLUME, 0)).toBe(0x10);
    expect(packVolNibbles(VOL.VOLCMD_PANNING, 64)).toBe(0x2f);
    expect(packVolNibbles(VOL.VOLCMD_VOLSLIDEUP, 5)).toBe(0x35);
    expect(packVolNibbles(VOL.VOLCMD_VIBRATODEPTH, 200)).toBe(0x8f); // saturates
    expect(packVolNibbles(VOL.VOLCMD_NONE, 0)).toBe(0x00);
    // monotonic over the whole 0..64 volume range, and 0 / 64 hit the ends
    let prev = -1;
    for (let v = 0; v <= 64; v++) {
      const low = packVolNibbles(VOL.VOLCMD_VOLUME, v) & 0x0f;
      expect(low).toBeGreaterThanOrEqual(prev);
      prev = low;
    }
  });
});

describe('shaders/lib/openmpt_commands.wgsl mirrors utils/openmptCommands.ts', () => {
  const wgsl = readFileSync(join(ROOT, 'shaders/lib/openmpt_commands.wgsl'), 'utf8');
  const wgslConst = (name: string) => {
    const m = wgsl.match(new RegExp(`const\\s+${name}\\s*:\\s*u32\\s*=\\s*(\\d+)u`));
    if (!m?.[1]) throw new Error(`WGSL const ${name} not found`);
    return Number(m[1]);
  };

  it.each([
    ['VOLCMD_VOLUME', VOL.VOLCMD_VOLUME],
    ['VOLCMD_PANNING', VOL.VOLCMD_PANNING],
    ['CMD_MODCMDEX', CMD.CMD_MODCMDEX],
    ['CMD_S3MCMDEX', CMD.CMD_S3MCMDEX],
  ])('%s', (name, value) => {
    expect(wgslConst(name)).toBe(value);
  });
});
