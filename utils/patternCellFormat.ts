import type { PatternCell } from '../types';
import { NOTE_NAMES } from './patternEdit';

// Text of one pattern cell column as the pattern editor prints it. DOM-free so the column
// mapping (volume column ← volCmd/volVal, effect column ← effCmd/effVal; #523) is unit-testable.
// The effect command is printed as the hex of libopenmpt's internal EffectCommand
// (utils/openmptCommands.ts), not as the XM/MOD effect letter.

export function formatNote(cell: PatternCell): string {
  const n = cell.note;
  if (n === undefined || n === 0) return '...';
  const noteIndex = (n - 1) % 12;
  const octave = Math.floor((n - 1) / 12);
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

export function formatInstrument(cell: PatternCell): string {
  const i = cell.inst;
  if (i === undefined || i === 0) return '..';
  return i.toString(16).toUpperCase().padStart(2, '0');
}

export function formatVolume(cell: PatternCell): string {
  if (cell.volCmd === undefined || (cell.volCmd === 0 && (cell.volVal === undefined || cell.volVal === 0))) {
    return '..';
  }
  const val = cell.volVal ?? 0;
  return val.toString(16).toUpperCase().padStart(2, '0');
}

export function formatEffect(cell: PatternCell): string {
  if (cell.effCmd === undefined || (cell.effCmd === 0 && (cell.effVal === undefined || cell.effVal === 0))) {
    return '...';
  }
  const cmd = cell.effCmd.toString(16).toUpperCase();
  const val = (cell.effVal ?? 0).toString(16).toUpperCase().padStart(2, '0');
  return `${cmd}${val}`;
}

