import { describe, expect, it, vi } from 'vitest';
import { packPatternMatrixHighPrecision } from '../utils/gpuPacking';
import { EffectCommand, VolumeCommand, isNoteCutEffect, isVolumeColumnOff, packVolNibbles } from '../utils/openmptCommands';
import { getCell, makeMatrix } from './helpers/patternMatrix';
import { readShaderSource, wgslFnToJs, wgslU32Consts } from './helpers/wgslSubset';

vi.stubEnv('DEV', true);

describe('duration parity (DURA-001 CPU path)', () => {
  it('T1: note sustains to end of pattern', () => {
    const mat = makeMatrix(8, [[
      { note: 60 },
      ...Array(7).fill({}),
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(8);
    expect(c.rowOffset).toBe(0);
    expect(c.isNoteOff).toBe(0);

    c = getCell(packedData, 4, 0, 1);
    expect(c.duration).toBe(8);
    expect(c.rowOffset).toBe(4);
    expect(c.isNoteOff).toBe(0);

    c = getCell(packedData, 7, 0, 1);
    expect(c.duration).toBe(8);
    expect(c.rowOffset).toBe(7);
  });

  it('T2: note cut by following note', () => {
    const mat = makeMatrix(8, [[
      { note: 60 },
      {}, {}, {},
      { note: 64 },
      {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(4);
    expect(c.rowOffset).toBe(0);

    c = getCell(packedData, 3, 0, 1);
    expect(c.duration).toBe(4);
    expect(c.rowOffset).toBe(3);
    expect(c.isNoteOff).toBe(0);

    c = getCell(packedData, 4, 0, 1);
    expect(c.duration).toBe(4);
    expect(c.rowOffset).toBe(0);
  });

  it('T3: explicit note-off', () => {
    const NOTE_OFF = 255;
    const mat = makeMatrix(8, [[
      { note: 60 },
      {}, {},
      { note: NOTE_OFF },
      {}, {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(4);
    expect(c.isNoteOff).toBe(0);

    c = getCell(packedData, 3, 0, 1);
    expect(c.duration).toBe(4);
    expect(c.rowOffset).toBe(3);
    expect(c.isNoteOff).toBe(1);

    c = getCell(packedData, 4, 0, 1);
    expect(c.duration).toBe(1);
    expect(c.rowOffset).toBe(0);
  });

  it('T4: ECx terminates note', () => {
    const ECx = { effCmd: EffectCommand.CMD_MODCMDEX, effVal: 0xc3 };
    const mat = makeMatrix(8, [[
      { note: 60 },
      {}, {},
      { ...ECx },
      {}, {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(4);

    c = getCell(packedData, 3, 0, 1);
    expect(c.duration).toBe(4);
    expect(c.rowOffset).toBe(3);
    expect(c.isNoteOff).toBe(1);

    c = getCell(packedData, 4, 0, 1);
    expect(c.duration).toBe(1);
    expect(c.rowOffset).toBe(0);
  });

  it('T4b: SCx (CMD_S3MCMDEX) cuts the note; a pattern break with an 0xCx parameter does not', () => {
    const run = (cut: { effCmd: number; effVal: number }) => {
      const mat = makeMatrix(8, [[{ note: 60 }, {}, { ...cut }, {}, {}, {}, {}, {}]]);
      return getCell(packPatternMatrixHighPrecision(mat).packedData, 2, 0, 1);
    };
    expect(run({ effCmd: EffectCommand.CMD_S3MCMDEX, effVal: 0xc3 })).toMatchObject({ duration: 3, isNoteOff: 1 });
    // 14 is what the old code took for "E"; in libopenmpt it is CMD_PATTERNBREAK
    expect(run({ effCmd: EffectCommand.CMD_PATTERNBREAK, effVal: 0xc3 })).toMatchObject({ duration: 8, isNoteOff: 0 });
  });

  it('T4c: v00 in the volume column ends the note; a set-volume effect of 0 does not', () => {
    const volOff = makeMatrix(8, [[{ note: 60 }, {}, { volCmd: VolumeCommand.VOLCMD_VOLUME, volVal: 0 }, {}, {}, {}, {}, {}]]);
    expect(getCell(packPatternMatrixHighPrecision(volOff).packedData, 2, 0, 1)).toMatchObject({ duration: 3, isNoteOff: 1 });
    const panZero = makeMatrix(8, [[{ note: 60 }, {}, { volCmd: VolumeCommand.VOLCMD_PANNING, volVal: 0 }, {}, {}, {}, {}, {}]]);
    expect(getCell(packPatternMatrixHighPrecision(panZero).packedData, 2, 0, 1)).toMatchObject({ duration: 8, isNoteOff: 0 });
  });

  it('T5: ECx on note-on row = no tail', () => {
    const mat = makeMatrix(8, [[
      { note: 60, effCmd: EffectCommand.CMD_MODCMDEX, effVal: 0xc2 },
      {}, {}, {}, {}, {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(1);
    expect(c.rowOffset).toBe(0);

    c = getCell(packedData, 1, 0, 1);
    expect(c.duration).toBe(1);
    expect(c.rowOffset).toBe(0);
  });

  it('T6: volume-off (Set Volume 0, VOLCMD_VOLUME=1) terminates note', () => {
    // libopenmpt's VolumeCommand enum: VOLCMD_VOLUME = 1 (modcommand.h) — a
    // real "Set Volume 0" cell, not the old (unreachable) 0xC0 byte value.
    const mat = makeMatrix(8, [[
      { note: 60 },
      {}, {},
      { volCmd: 1, volVal: 0 },
      {}, {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(4);

    c = getCell(packedData, 3, 0, 1);
    expect(c.isNoteOff).toBe(1);

    c = getCell(packedData, 4, 0, 1);
    expect(c.duration).toBe(1);
  });

  it('T7: standalone note-off', () => {
    const mat = makeMatrix(8, [[
      {}, {}, {},
      { note: 255 },
      {}, {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    const c = getCell(packedData, 3, 0, 1);
    expect(c.isNoteOff).toBe(1);
    expect(c.duration).toBe(1);
    expect(c.rowOffset).toBe(0);
  });

  it('T8: short pattern, duration clamped to pattern length', () => {
    const mat = makeMatrix(16, [[
      { note: 60 },
      ...Array(15).fill({}),
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(16);

    c = getCell(packedData, 15, 0, 1);
    expect(c.rowOffset).toBe(15);
    expect(c.duration).toBe(16);
  });

  it('T9: sustain duration clamped to 255, offset clamped to 63', () => {
    const NUM_ROWS = 300;
    const channelRows = [{ note: 60 }, ...Array(NUM_ROWS - 1).fill({})];
    const mat = makeMatrix(NUM_ROWS, [channelRows]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.duration).toBe(255);

    c = getCell(packedData, 63, 0, 1);
    expect(c.rowOffset).toBe(63);

    c = getCell(packedData, 100, 0, 1);
    expect(c.rowOffset).toBe(63);
  });

  it('T10: multi-channel independence', () => {
    const NUM_ROWS = 8;
    const ch0Rows = [{ note: 60 }, {}, {}, {}, { note: 62 }, {}, {}, {}];
    const ch1Rows = [{}, {}, { note: 64 }, {}, {}, {}, {}, {}];

    const mat = makeMatrix(NUM_ROWS, [ch0Rows, ch1Rows]);
    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 2);
    expect(c.duration).toBe(4);

    c = getCell(packedData, 3, 0, 2);
    expect(c.rowOffset).toBe(3);

    c = getCell(packedData, 2, 1, 2);
    expect(c.duration).toBe(6);
    expect(c.rowOffset).toBe(0);

    c = getCell(packedData, 5, 1, 2);
    expect(c.rowOffset).toBe(3);
  });

  it('T11: DURA-003 note pitch propagated to sustain tail', () => {
    const mat = makeMatrix(4, [[
      { note: 60, inst: 5 },
      {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    let c = getCell(packedData, 0, 0, 1);
    expect(c.note).toBe(60);

    c = getCell(packedData, 1, 0, 1);
    expect(c.note).toBe(60);

    c = getCell(packedData, 2, 0, 1);
    expect(c.note).toBe(60);
  });

  it('T12: expression-only flag', () => {
    const mat = makeMatrix(4, [[
      { effCmd: EffectCommand.CMD_TONEPORTAMENTO, effVal: 0x50 },
      {}, {}, {},
    ]]);

    const { packedData } = packPatternMatrixHighPrecision(mat);

    const c = getCell(packedData, 0, 0, 1);
    expect(c.inst & 0x80).not.toBe(0);
    expect(c.duration).toBe(1);
  });

  it('T13: padTopChannel inserts empty channel 0', () => {
    const mat = makeMatrix(4, [[
      { note: 60 }, {}, {}, {},
    ]]);

    const { packedData: unpadded } = packPatternMatrixHighPrecision(mat, false);
    const { packedData: padded } = packPatternMatrixHighPrecision(mat, true);

    for (let r = 0; r < 4; r++) {
      const idx = (r * 2 + 0) * 2;
      expect(padded[idx]).toBe(0);
      expect(padded[idx + 1]).toBe(0);
    }

    for (let r = 0; r < 4; r++) {
      const paddedIdx = (r * 2 + 1) * 2;
      const unpaddedIdx = (r * 1 + 0) * 2;
      expect(padded[paddedIdx]).toBe(unpadded[unpaddedIdx]);
      expect(padded[paddedIdx + 1]).toBe(unpadded[unpaddedIdx + 1]);
    }
  });
});

describe('duration parity (DURA-001 compute shader vs CPU packer, #523 volume/effect helpers)', () => {
  const lib = readShaderSource('lib/openmpt_commands.wgsl');
  const compute = readShaderSource('compute_note_duration.wgsl');
  const consts = wgslU32Consts(lib);
  const wgslPackVol = wgslFnToJs(lib, 'packVolNibbles', consts) as (c: number, v: number) => number;
  const wgslCut = wgslFnToJs(lib, 'isEffectCut', consts) as (c: number, v: number) => boolean;
  const wgslVolOff = wgslFnToJs(lib, 'isVolumeOff', consts) as (c: number, v: number) => boolean;

  it('the compute shader packs volPacked and detects cuts through exactly these helpers', () => {
    expect(compute).toContain('//#include "lib/openmpt_commands.wgsl"');
    expect(compute).toContain('let volPacked = packVolNibbles(outVolCmd, outVolVal);');
    expect(compute).toContain('isVolumeOff(volCmd, volVal)');
    expect(compute).toContain('isEffectCut(effCmd, effVal)');
    expect(compute).not.toMatch(/EFFECT_E_|>> 4u\) & 0x0Fu/);
  });

  it('volPacked: WGSL packVolNibbles === TS packVolNibbles for every command/value byte pair', () => {
    for (let cmd = 0; cmd < 256; cmd++) {
      for (let val = 0; val < 256; val++) {
        const expected = packVolNibbles(cmd, val);
        if (wgslPackVol(cmd, val) !== expected) {
          throw new Error(`volCmd=${cmd} volVal=${val}: WGSL ${wgslPackVol(cmd, val)} vs TS ${expected}`);
        }
      }
    }
  });

  it('note cut and v00: WGSL isEffectCut / isVolumeOff === TS for every command/value byte pair', () => {
    for (let cmd = 0; cmd < 256; cmd++) {
      for (let val = 0; val < 256; val++) {
        if (wgslCut(cmd, val) !== isNoteCutEffect(cmd, val)) throw new Error(`isEffectCut(${cmd}, ${val}) differs`);
        if (wgslVolOff(cmd, val) !== isVolumeColumnOff(cmd, val)) throw new Error(`isVolumeOff(${cmd}, ${val}) differs`);
      }
    }
  });

  it('the translated helpers really compute (guards the translator itself)', () => {
    expect(wgslPackVol(VolumeCommand.VOLCMD_VOLUME, 64)).toBe(0x1f);
    expect(wgslPackVol(VolumeCommand.VOLCMD_PANNING, 32)).toBe(0x28);
    expect(wgslPackVol(VolumeCommand.VOLCMD_VOLSLIDEUP, 5)).toBe(0x35);
    expect(wgslCut(EffectCommand.CMD_MODCMDEX, 0xc2)).toBe(true);
    expect(wgslCut(14, 0xc2)).toBe(false);
    expect(wgslVolOff(VolumeCommand.VOLCMD_VOLUME, 0)).toBe(true);
  });

  it('the CPU packer emits the same volPacked the helpers describe', () => {
    const mat = makeMatrix(2, [[{ note: 60, volCmd: VolumeCommand.VOLCMD_VOLUME, volVal: 64 }, {}]]);
    expect(getCell(packPatternMatrixHighPrecision(mat).packedData, 0, 0, 1).volPacked).toBe(wgslPackVol(VolumeCommand.VOLCMD_VOLUME, 64));
  });
});
