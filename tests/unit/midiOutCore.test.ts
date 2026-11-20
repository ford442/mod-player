/**
 * #538 MIDI out — the pure pieces: message bytes, the audio→performance time map, the pulse grid and
 * the note planner. The controller that wires them to the engine is tested in midiOutController.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { PatternCell } from '../../types';
import { AudioPerfClock } from '../../audio/midi/audioPerfClock';
import {
  allNotesOffBytes,
  midiNoteForPatternNote,
  noteOffBytes,
  noteOnBytes,
  songPositionBytes,
} from '../../audio/midi/midiMessages';
import { DEFAULT_NOTE_VELOCITY, NoteOutPlanner, velocityForVolume } from '../../audio/midi/noteOutPlanner';
import { MAX_CLOCK_BPM, MIN_CLOCK_BPM, PulseGrid, pulseIntervalSec } from '../../audio/midi/pulseGrid';
import { EffectCommand as CMD, VolumeCommand as VOL } from '../../utils/openmptCommands';
import { DEFAULT_MIDI_OUT_SETTINGS, sanitizeMidiOutSettings } from '../../utils/midiOut';

describe('midiMessages', () => {
  it('encodes Song Position Pointer as two 7-bit bytes, LSB first', () => {
    expect(songPositionBytes(0)).toEqual([0xf2, 0, 0]);
    expect(songPositionBytes(1)).toEqual([0xf2, 1, 0]);
    expect(songPositionBytes(128)).toEqual([0xf2, 0, 1]);
    expect(songPositionBytes(0x3fff)).toEqual([0xf2, 0x7f, 0x7f]);
  });

  it('clamps Song Position Pointer to its 14 bits and ignores junk', () => {
    expect(songPositionBytes(1e9)).toEqual([0xf2, 0x7f, 0x7f]);
    expect(songPositionBytes(-5)).toEqual([0xf2, 0, 0]);
    expect(songPositionBytes(Number.NaN)).toEqual([0xf2, 0, 0]);
    expect(songPositionBytes(10.9)).toEqual([0xf2, 10, 0]);
  });

  it('builds channel messages on the right status byte', () => {
    expect(noteOnBytes(0, 60, 100)).toEqual([0x90, 60, 100]);
    expect(noteOnBytes(15, 60, 100)).toEqual([0x9f, 60, 100]);
    expect(noteOffBytes(9, 36)).toEqual([0x89, 36, 0]);
    expect(allNotesOffBytes(2)).toEqual([0xb2, 123, 0]);
  });

  it('never sends a note-on with velocity 0 (that is a note-off)', () => {
    expect(noteOnBytes(0, 60, 0)[2]).toBe(1);
  });

  it('maps libopenmpt pattern notes to MIDI: middle C (C-5, value 61) is 60', () => {
    expect(midiNoteForPatternNote(61)).toBe(60);
    expect(midiNoteForPatternNote(1)).toBe(0);
    expect(midiNoteForPatternNote(119)).toBe(118);
    expect(midiNoteForPatternNote(0)).toBeNull();
    expect(midiNoteForPatternNote(120)).toBeNull();
    expect(midiNoteForPatternNote(255)).toBeNull();
  });
});

describe('AudioPerfClock', () => {
  /** Deterministic noise in [-1, 1). */
  function noise(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return (s / 0x100000000) * 2 - 1;
    };
  }

  it('has no answer before the first reading', () => {
    const clock = new AudioPerfClock();
    expect(clock.ready).toBe(false);
    expect(clock.toPerformanceMs(1)).toBeNull();
  });

  it('maps audio seconds to performance ms with the offset it was given', () => {
    const clock = new AudioPerfClock();
    clock.observe(10, 5000);
    expect(clock.toPerformanceMs(10)).toBe(5000);
    expect(clock.toPerformanceMs(10.5)).toBe(5500);
  });

  it('averages ±3 ms of timestamp jitter down to well under a millisecond', () => {
    const clock = new AudioPerfClock();
    const rand = noise(7);
    const TRUE_OFFSET_MS = 250_000;
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      const perfMs = 1000 + i * 20;
      const audioSec = (perfMs - TRUE_OFFSET_MS) / 1000;
      clock.observe(audioSec + (rand() * 3) / 1000, perfMs);
      if (i >= 150) {
        const mapped = clock.toPerformanceMs(audioSec)!;
        worst = Math.max(worst, Math.abs(mapped - perfMs));
      }
    }
    expect(worst).toBeLessThan(0.6);
  });

  it('ignores a lone stale reading', () => {
    const clock = new AudioPerfClock();
    for (let i = 0; i < 20; i++) clock.observe(i * 0.02, 1000 + i * 20);
    const before = clock.toPerformanceMs(1);
    clock.observe(0.5, 1000 + 500 + 80); // 80 ms off, once
    clock.observe(0.52, 1000 + 520);
    expect(Math.abs(clock.toPerformanceMs(1)! - before!)).toBeLessThan(0.5);
  });

  it('follows a sustained step (the output moved to another device)', () => {
    const clock = new AudioPerfClock();
    for (let i = 0; i < 50; i++) clock.observe(i * 0.02, 1000 + i * 20);
    for (let i = 50; i < 70; i++) clock.observe(i * 0.02, 1000 + i * 20 + 120);
    expect(clock.toPerformanceMs(70 * 0.02)).toBeCloseTo(1000 + 70 * 20 + 120, 0);
  });

  it('reset() forgets the offset', () => {
    const clock = new AudioPerfClock();
    clock.observe(1, 2000);
    clock.reset();
    expect(clock.ready).toBe(false);
    clock.observe(1, 9000);
    expect(clock.toPerformanceMs(1)).toBe(9000);
  });
});

describe('PulseGrid', () => {
  it('pulses 24 times per beat: 20 ms apart at 125 BPM', () => {
    expect(pulseIntervalSec(125)).toBeCloseTo(0.02, 12);
    expect(pulseIntervalSec(60)).toBeCloseTo(1 / 24, 12);
  });

  it('hands out every pulse up to the horizon, once', () => {
    const grid = new PulseGrid();
    grid.setBpm(125);
    grid.anchor(10);
    const seen: number[] = [];
    grid.advance(10.1, 9, (t) => seen.push(t));
    expect(seen).toHaveLength(6); // 10.00 … 10.10
    expect(seen[0]).toBe(10);
    const more: number[] = [];
    grid.advance(10.2, 9, (t) => more.push(t));
    expect(more[0]).toBeCloseTo(10.12, 9);
    expect(grid.lastPulseSec).toBeCloseTo(more[more.length - 1]!, 12);
  });

  it('keeps the pulse spacing within a microsecond over a long run', () => {
    const grid = new PulseGrid();
    grid.setBpm(137.5);
    grid.anchor(0);
    const times: number[] = [];
    for (let h = 0.1; h <= 600; h += 0.1) grid.advance(h, -1, (t) => times.push(t));
    const interval = pulseIntervalSec(137.5);
    let worst = 0;
    for (let i = 1; i < times.length; i++) worst = Math.max(worst, Math.abs(times[i]! - times[i - 1]! - interval));
    expect(worst).toBeLessThan(1e-6);
  });

  it('uses the new interval from the next pulse that has not been handed out', () => {
    const grid = new PulseGrid();
    grid.setBpm(125);
    grid.anchor(0);
    const seen: number[] = [];
    grid.advance(0.1, -1, (t) => seen.push(t));
    grid.setBpm(250); // speed change: twice as fast
    grid.advance(0.2, -1, (t) => seen.push(t));
    expect(seen[5]! - seen[4]!).toBeCloseTo(0.02, 9); // already handed out, unchanged
    expect(seen[7]! - seen[6]!).toBeCloseTo(0.01, 9);
  });

  it('drops pulses more than the floor late but keeps the phase', () => {
    const grid = new PulseGrid();
    grid.setBpm(125);
    grid.anchor(0);
    const seen: number[] = [];
    // The main thread was away for 2 s: only pulses from the floor on go out, on the original grid.
    const result = grid.advance(2.1, 2, (t) => seen.push(t));
    expect(result.skipped).toBe(100);
    expect(seen[0]).toBeCloseTo(2, 9);
    expect(seen[0]! / 0.02).toBeCloseTo(Math.round(seen[0]! / 0.02), 6);
  });

  it('re-anchoring never puts two pulses on top of each other', () => {
    const grid = new PulseGrid();
    grid.setBpm(125);
    grid.anchor(0);
    grid.advance(0.1, -1, () => {}); // last pulse handed out: 0.10
    const first = grid.anchor(0.03); // a seek landed inside the span already sent
    expect(first).toBeGreaterThanOrEqual(0.1 + 0.01 - 1e-9);
    expect(first).toBeLessThan(0.1 + 0.03 + 1e-9);
    // A landing after the last pulse is taken as it is.
    expect(grid.anchor(5)).toBe(5);
  });

  it('reports where in the beat a pause happened', () => {
    const grid = new PulseGrid();
    grid.setBpm(125);
    grid.anchor(0);
    grid.advance(0.1, -1, () => {}); // handed out up to 0.10; next is 0.12
    expect(grid.untilNextPulse(0.05)).toBeCloseTo(0.01, 9); // pulses at 0.04 (past) → next 0.06
    expect(grid.untilNextPulse(0.1)).toBeCloseTo(0, 9);
    expect(grid.untilNextPulse(0.105)).toBeCloseTo(0.015, 9);
    grid.stop();
    expect(grid.untilNextPulse(0.05)).toBeNull();
  });

  it('ignores an unusable BPM', () => {
    const grid = new PulseGrid();
    grid.setBpm(100);
    const interval = grid.intervalSec;
    for (const bad of [Number.NaN, 0, -5, MIN_CLOCK_BPM - 1, MAX_CLOCK_BPM + 1, Infinity]) {
      grid.setBpm(bad);
      expect(grid.intervalSec).toBe(interval);
    }
  });
});

describe('NoteOutPlanner', () => {
  const cell = (c: Partial<PatternCell>): PatternCell => ({ type: 'note', text: '', ...c });
  const perChannel = (c: number) => c % 16;
  const TICK = 0.02;
  const TIMING = { tickSec: TICK, ticksPerRow: 6 };

  it('plays a note at the row start with a default velocity', () => {
    const planner = new NoteOutPlanner(perChannel);
    expect(planner.planRow([cell({ note: 61 })], TIMING)).toEqual([
      { atSec: 0, bytes: noteOnBytes(0, 60, DEFAULT_NOTE_VELOCITY) },
    ]);
    expect(planner.soundingCount).toBe(1);
  });

  it('takes the velocity from the volume column or Cxx', () => {
    const planner = new NoteOutPlanner(perChannel);
    const [a] = planner.planRow([cell({ note: 61, volCmd: VOL.VOLCMD_VOLUME, volVal: 64 })], TIMING);
    expect(a!.bytes[2]).toBe(127);
    const [off, b] = planner.planRow([cell({ note: 62, effCmd: CMD.CMD_VOLUME, effVal: 0x20 })], TIMING);
    expect(off!.bytes[0]).toBe(0x80); // the previous note ends first
    expect(b!.bytes[2]).toBe(velocityForVolume(0x20));
  });

  it('ends the previous note when the next one starts (legato: off, then on)', () => {
    const planner = new NoteOutPlanner(perChannel);
    planner.planRow([cell({ note: 61 })], TIMING);
    expect(planner.planRow([cell({ note: 65 })], TIMING)).toEqual([
      { atSec: 0, bytes: noteOffBytes(0, 60) },
      { atSec: 0, bytes: noteOnBytes(0, 64, DEFAULT_NOTE_VELOCITY) },
    ]);
  });

  it.each([254, 255, 253])('ends the note on a key-off / cut / fade cell (note %i)', (note) => {
    const planner = new NoteOutPlanner(perChannel);
    planner.planRow([cell({ note: 61 })], TIMING);
    expect(planner.planRow([cell({ note })], TIMING)).toEqual([{ atSec: 0, bytes: noteOffBytes(0, 60) }]);
    expect(planner.soundingCount).toBe(0);
  });

  it('cuts at tick x for ECx / SCx, delays with EDx / SDx', () => {
    const planner = new NoteOutPlanner(perChannel);
    planner.planRow([cell({ note: 61 })], TIMING);
    expect(planner.planRow([cell({ effCmd: CMD.CMD_MODCMDEX, effVal: 0xc3 })], TIMING)).toEqual([
      { atSec: 3 * TICK, bytes: noteOffBytes(0, 60) },
    ]);
    const delayed = planner.planRow([cell({ note: 62, effCmd: CMD.CMD_S3MCMDEX, effVal: 0xd2 })], TIMING);
    expect(delayed).toEqual([{ atSec: 2 * TICK, bytes: noteOnBytes(0, 61, DEFAULT_NOTE_VELOCITY) }]);
  });

  it('ignores a cut or delay at or past the end of the row: a tracker never fires it', () => {
    const planner = new NoteOutPlanner(perChannel);
    planner.planRow([cell({ note: 61 })], TIMING);
    // EC6 at speed 6: the note is never cut, so nothing is sent.
    expect(planner.planRow([cell({ effCmd: CMD.CMD_MODCMDEX, effVal: 0xc6 })], TIMING)).toEqual([]);
    expect(planner.soundingCount).toBe(1);
    // ED7 at speed 6: the new note never starts, and the old one keeps sounding.
    expect(planner.planRow([cell({ note: 65, effCmd: CMD.CMD_MODCMDEX, effVal: 0xd7 })], TIMING)).toEqual([]);
    expect(planner.soundingCount).toBe(1);
    // A faster song fires them: the same cells at speed 8.
    expect(planner.planRow([cell({ effCmd: CMD.CMD_MODCMDEX, effVal: 0xc6 })], { tickSec: TICK, ticksPerRow: 8 })).toEqual([
      { atSec: 6 * TICK, bytes: noteOffBytes(0, 60) },
    ]);
  });

  it('plays then cuts a note in one row (note + EC2)', () => {
    const planner = new NoteOutPlanner(perChannel);
    expect(planner.planRow([cell({ note: 61, effCmd: CMD.CMD_MODCMDEX, effVal: 0xc2 })], TIMING)).toEqual([
      { atSec: 0, bytes: noteOnBytes(0, 60, DEFAULT_NOTE_VELOCITY) },
      { atSec: 2 * TICK, bytes: noteOffBytes(0, 60) },
    ]);
  });

  it('treats a set-volume of 0 as the end of the note', () => {
    const planner = new NoteOutPlanner(perChannel);
    planner.planRow([cell({ note: 61 })], TIMING);
    expect(planner.planRow([cell({ volCmd: VOL.VOLCMD_VOLUME, volVal: 0 })], TIMING)).toEqual([
      { atSec: 0, bytes: noteOffBytes(0, 60) },
    ]);
    // …and a note that starts silent plays nothing.
    expect(planner.planRow([cell({ note: 63, effCmd: CMD.CMD_VOLUME, effVal: 0 })], TIMING)).toEqual([]);
    expect(planner.soundingCount).toBe(0);
  });

  it('does not retrigger on a tone portamento (a slide to the cell note is not a new note)', () => {
    const planner = new NoteOutPlanner(perChannel);
    planner.planRow([cell({ note: 61 })], TIMING);
    expect(planner.planRow([cell({ note: 65, effCmd: CMD.CMD_TONEPORTAMENTO, effVal: 0x10 })], TIMING)).toEqual([]);
    expect(planner.planRow([cell({ note: 65, volCmd: VOL.VOLCMD_TONEPORTAMENTO, volVal: 3 })], TIMING)).toEqual([]);
    expect(planner.soundingCount).toBe(1);
  });

  it('ignores empty cells and notes out of range', () => {
    const planner = new NoteOutPlanner(perChannel);
    expect(planner.planRow([cell({}), undefined], TIMING)).toEqual([]);
    expect(planner.planRow([cell({ note: 0 })], TIMING)).toEqual([]);
  });

  it('maps tracker channels to MIDI channels (wrapping at 16) and tracks each separately', () => {
    const planner = new NoteOutPlanner(perChannel);
    const cells = Array.from({ length: 18 }, (_, i) => cell({ note: 61 + i }));
    const msgs = planner.planRow(cells, TIMING);
    expect(msgs).toHaveLength(18);
    expect(msgs[0]!.bytes[0]).toBe(0x90);
    expect(msgs[15]!.bytes[0]).toBe(0x9f);
    expect(msgs[16]!.bytes[0]).toBe(0x90); // tracker channel 16 wraps to MIDI channel 1
    expect(planner.soundingCount).toBe(18);
  });

  it('sends everything on one channel in single mode', () => {
    const planner = new NoteOutPlanner(() => 4);
    const msgs = planner.planRow([cell({ note: 61 }), cell({ note: 64 })], TIMING);
    expect(msgs.map((m) => m.bytes[0])).toEqual([0x94, 0x94]);
  });

  it('keeps sounding notes on the channel they were started on when the map changes', () => {
    const planner = new NoteOutPlanner(() => 0);
    planner.planRow([cell({ note: 61 })], TIMING);
    planner.setChannelMap(() => 7);
    expect(planner.planRow([cell({ note: 255 })], TIMING)).toEqual([{ atSec: 0, bytes: noteOffBytes(0, 60) }]);
  });

  it('releases a muted channel and plays nothing on it', () => {
    const planner = new NoteOutPlanner(perChannel);
    planner.planRow([cell({ note: 61 }), cell({ note: 64 })], TIMING);
    const msgs = planner.planRow([cell({ note: 62 }), cell({ note: 65 })], TIMING, (c) => c === 0);
    expect(msgs).toEqual([
      { atSec: 0, bytes: noteOffBytes(0, 60) },
      { atSec: 0, bytes: noteOffBytes(1, 63) },
      { atSec: 0, bytes: noteOnBytes(1, 64, DEFAULT_NOTE_VELOCITY) },
    ]);
  });

  it('releaseAll ends every held note once', () => {
    const planner = new NoteOutPlanner(perChannel);
    planner.planRow([cell({ note: 61 }), cell({ note: 64 })], TIMING);
    expect(planner.releaseAll()).toEqual([noteOffBytes(0, 60), noteOffBytes(1, 63)]);
    expect(planner.releaseAll()).toEqual([]);
  });
});

describe('MIDI out settings', () => {
  it('round-trips defaults and survives junk', () => {
    expect(sanitizeMidiOutSettings(null)).toEqual(DEFAULT_MIDI_OUT_SETTINGS);
    expect(sanitizeMidiOutSettings('nope')).toEqual(DEFAULT_MIDI_OUT_SETTINGS);
    expect(sanitizeMidiOutSettings({ outputId: 5, clock: 'yes', singleChannel: 99, channelMode: 'x' })).toEqual({
      ...DEFAULT_MIDI_OUT_SETTINGS,
      singleChannel: 16,
    });
  });

  it('keeps valid values', () => {
    const stored = { outputId: 'abc', outputName: 'IAC', clock: false, noteOut: true, channelMode: 'single', singleChannel: 3 };
    expect(sanitizeMidiOutSettings(stored)).toEqual(stored);
  });

  it('is off by default: no output, notes opt-in', () => {
    expect(DEFAULT_MIDI_OUT_SETTINGS.outputId).toBeNull();
    expect(DEFAULT_MIDI_OUT_SETTINGS.noteOut).toBe(false);
  });
});
