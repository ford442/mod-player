/**
 * #523: the pattern editor's volume column prints the volume value and its effect column prints
 * the effect command + parameter, for the cells libopenmpt actually returns for the synthesized
 * command fixture (not hand-built cells whose columns could agree with a wrong reader).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LibOpenMPT, PatternMatrix } from '../types';
import { synthCommandTestXm } from '../scripts/lib/synth-xm.mjs';
import { formatEffect, formatInstrument, formatNote, formatVolume } from '../utils/patternCellFormat';
import { parseModuleWithLib } from '../utils/parseModuleWithLib';
import { loadLibOpenMPTNode } from './helpers/libopenmptNode';

let lib: LibOpenMPT;
let restore = () => {};
let xm: PatternMatrix;

beforeAll(async () => {
  ({ lib, restore } = await loadLibOpenMPTNode());
  xm = parseModuleWithLib(lib, synthCommandTestXm(), 'command-test.xm').patternMatrices[0]!;
}, 30_000);

afterAll(() => restore());

const cell = (row: number, ch = 0) => xm.rows[row]![ch]!;

describe('pattern editor column text for the fixture cells', () => {
  it('row 0 "C-4 01 v40 A0F": volume column shows the volume (0x40), effect column the volume-slide command', () => {
    expect(formatNote(cell(0))).toBe('C-5'); // libopenmpt note 61
    expect(formatInstrument(cell(0))).toBe('01');
    expect(formatVolume(cell(0))).toBe('40');
    // CMD_VOLUMESLIDE = 11 → 'B', parameter 0F — not the volume value 40 printed as an effect
    expect(formatEffect(cell(0))).toBe('B0F');
  });

  it('row 1 panning + arpeggio', () => {
    expect(formatVolume(cell(1))).toBe('20'); // pan 32
    expect(formatEffect(cell(1))).toBe('137'); // CMD_ARPEGGIO = 1, parameter 0x37
  });

  it('row 2 set-volume effect: the volume column stays empty', () => {
    expect(formatVolume(cell(2))).toBe('..');
    expect(formatEffect(cell(2))).toBe('D20'); // CMD_VOLUME = 13
  });

  it('row 3 ECx and row 4 v00', () => {
    expect(formatEffect(cell(3))).toBe('13C2'); // CMD_MODCMDEX = 19 = 0x13
    expect(formatVolume(cell(3))).toBe('..');
    expect(formatVolume(cell(4))).toBe('00'); // set volume 0 is a real command, not an empty column
    expect(formatEffect(cell(4))).toBe('...');
  });

  it('empty cells', () => {
    expect(formatVolume(cell(3, 1))).toBe('..');
    expect(formatEffect(cell(3, 1))).toBe('...');
    expect(formatEffect(cell(7))).toBe('...'); // the dropped CMD_NONE+param effect byte
  });
});
