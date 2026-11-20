/**
 * Pattern cells → MIDI notes (#538, note-out). Pure: no Web MIDI, no engine, no clock.
 *
 * `planRow` turns one pattern row into timed messages (offsets in seconds from the row's start) and
 * remembers what is sounding per tracker channel, so the next row's note ends the previous one.
 *
 * Note-off is derived, because most formats have none: a note ends at
 *   - the next note on the same channel (legato — off, then on),
 *   - a key-off / note cut / note fade cell (`===`, `^^^`, `~~~`: libopenmpt note ≥ 120),
 *   - a note-cut effect ECx / SCx, `x` ticks into the row,
 *   - a set-volume of 0 in the volume column or `C00`,
 *   - the transport stopping, pausing, seeking or note-out being switched off (`releaseAll`).
 * A sample that simply runs out (a one-shot drum hit) never announces it, so its note is held until one
 * of the above. That is the limit of what the pattern alone says; docs/MIDI_CONTROLS.md spells it out.
 *
 * Not mapped: tone portamento (a slide to the cell's note is not a new note), pitch effects,
 * instrument → program change, panning.
 */
import type { PatternCell } from '../../types';
import { EffectCommand, VolumeCommand } from '../../utils/openmptCommands';
import {
  midiNoteForPatternNote,
  noteOffBytes,
  noteOnBytes,
  PATTERN_NOTE_MAX,
  type MidiBytes,
} from './midiMessages';

/** How long a row's ticks are: what the ECx / SCx cut and EDx / SDx delay effects count in. */
export interface RowTiming {
  /** Seconds per tick (row duration ÷ speed). */
  readonly tickSec: number;
  /** Ticks in the row (the speed). A cut or delay at or past it never fires in a tracker, so it is ignored. */
  readonly ticksPerRow: number;
}

/** One message, `atSec` seconds after the start of the row it was planned from. */
export interface PlannedMessage {
  readonly atSec: number;
  readonly bytes: MidiBytes;
}

/** Velocity for a note whose cell carries no volume (a tracker plays the sample's own default). */
export const DEFAULT_NOTE_VELOCITY = 100;

/** Highest tracker channel the planner tracks. */
export const MAX_NOTE_CHANNELS = 64;

const MOD_EX_HIGH_NIBBLE_CUT = 0xc0;
const MOD_EX_HIGH_NIBBLE_DELAY = 0xd0;

const isExtendedEffect = (cmd: number): boolean =>
  cmd === EffectCommand.CMD_MODCMDEX || cmd === EffectCommand.CMD_S3MCMDEX;

const isTonePortamento = (cell: PatternCell): boolean => {
  const eff = cell.effCmd ?? 0;
  return (
    eff === EffectCommand.CMD_TONEPORTAMENTO ||
    eff === EffectCommand.CMD_TONEPORTAVOL ||
    eff === EffectCommand.CMD_TONEPORTA_DURATION ||
    cell.volCmd === VolumeCommand.VOLCMD_TONEPORTAMENTO
  );
};

/** Set-volume of the cell (0–64), from the volume column or `Cxx`; null when it sets none. */
function cellVolume(cell: PatternCell): number | null {
  if (cell.volCmd === VolumeCommand.VOLCMD_VOLUME && cell.volVal !== undefined) return cell.volVal;
  if (cell.effCmd === EffectCommand.CMD_VOLUME && cell.effVal !== undefined) return cell.effVal;
  return null;
}

/** 0–64 tracker volume → MIDI velocity 1–127. */
export function velocityForVolume(volume: number): number {
  return Math.max(1, Math.min(127, Math.round((Math.max(0, Math.min(64, volume)) / 64) * 127)));
}

/** Tick (0-based) a delay / cut effect in the cell acts on, or null when it has none of that kind. */
function extendedTick(cell: PatternCell, highNibble: number): number | null {
  if (!isExtendedEffect(cell.effCmd ?? 0)) return null;
  const value = cell.effVal ?? 0;
  return (value & 0xf0) === highNibble ? value & 0x0f : null;
}

export type MidiChannelFor = (trackerChannel: number) => number;

interface Sounding {
  channel: number;
  note: number;
}

export class NoteOutPlanner {
  private readonly sounding: (Sounding | null)[] = new Array<Sounding | null>(MAX_NOTE_CHANNELS).fill(null);

  /** `midiChannelFor` maps a tracker channel to a MIDI channel 0–15. */
  constructor(private midiChannelFor: MidiChannelFor) {}

  setChannelMap(midiChannelFor: MidiChannelFor): void {
    this.midiChannelFor = midiChannelFor;
  }

  /** How many notes are being held. */
  get soundingCount(): number {
    let n = 0;
    for (const s of this.sounding) if (s) n += 1;
    return n;
  }

  /**
   * Messages for one row, in time order. `timing` gives the tick length the cut / delay effects count in.
   * A muted channel plays nothing and lets go of what it held.
   */
  planRow(
    cells: ReadonlyArray<PatternCell | undefined>,
    timing: RowTiming,
    isMuted: (trackerChannel: number) => boolean = () => false,
  ): PlannedMessage[] {
    const out: PlannedMessage[] = [];
    const channels = Math.min(cells.length, MAX_NOTE_CHANNELS);
    for (let c = 0; c < channels; c++) {
      const cell = cells[c];
      if (isMuted(c)) {
        this.release(c, 0, out);
        continue;
      }
      if (!cell) continue;
      this.planCell(c, cell, timing, out);
    }
    out.sort((a, b) => a.atSec - b.atSec);
    return out;
  }

  /** Note-offs for everything still sounding (stop / pause / seek / note-out switched off). */
  releaseAll(): MidiBytes[] {
    const out: PlannedMessage[] = [];
    for (let c = 0; c < MAX_NOTE_CHANNELS; c++) this.release(c, 0, out);
    return out.map((m) => m.bytes);
  }

  private planCell(c: number, cell: PatternCell, timing: RowTiming, out: PlannedMessage[]): void {
    const { tickSec, ticksPerRow } = timing;
    const note = cell.note ?? 0;
    const volume = cellVolume(cell);
    const rawCut = extendedTick(cell, MOD_EX_HIGH_NIBBLE_CUT);
    const cutTick = rawCut !== null && rawCut < ticksPerRow ? rawCut : null;

    if (note > PATTERN_NOTE_MAX) {
      // key-off / note cut / note fade
      this.release(c, 0, out);
      return;
    }

    const midiNote = midiNoteForPatternNote(note);
    if (midiNote !== null && !isTonePortamento(cell)) {
      const delayTick = extendedTick(cell, MOD_EX_HIGH_NIBBLE_DELAY) ?? 0;
      if (delayTick >= ticksPerRow) return; // delayed past the end of the row: the tracker never plays it
      const at = delayTick * tickSec;
      this.release(c, at, out);
      if (volume === 0) return; // a note started silent: nothing to play, nothing to hold
      const channel = this.midiChannelFor(c);
      out.push({ atSec: at, bytes: noteOnBytes(channel, midiNote, volume === null ? DEFAULT_NOTE_VELOCITY : velocityForVolume(volume)) });
      this.sounding[c] = { channel, note: midiNote };
      if (cutTick !== null && cutTick > delayTick) this.release(c, cutTick * tickSec, out);
      return;
    }

    // No new note: a cut effect or a volume of zero ends the one that is sounding.
    if (cutTick !== null) {
      this.release(c, cutTick * tickSec, out);
      return;
    }
    if (volume === 0) this.release(c, 0, out);
  }

  private release(c: number, atSec: number, out: PlannedMessage[]): void {
    const held = this.sounding[c];
    if (!held) return;
    out.push({ atSec, bytes: noteOffBytes(held.channel, held.note) });
    this.sounding[c] = null;
  }
}
