import { z } from 'zod';
import type { PlayerCommandId } from './playerCommands';

export type MidiMappingKind = 'noteOn' | 'cc' | 'programChange';

export interface MidiMapping {
  id: string;
  kind: MidiMappingKind;
  /** MIDI channel 1–16; omit for any channel */
  channel?: number;
  /** Note number 0–127 (noteOn) */
  note?: number;
  /** Controller number 0–127 (cc) */
  controller?: number;
  command: PlayerCommandId;
  /** For noteOn: only fire when velocity > 0 (default true) */
  noteOnOnly?: boolean;
}

const MidiMappingSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['noteOn', 'cc', 'programChange']),
  channel: z.number().int().min(1).max(16).optional(),
  note: z.number().int().min(0).max(127).optional(),
  controller: z.number().int().min(0).max(127).optional(),
  command: z.string(),
  noteOnOnly: z.boolean().optional(),
});

const MidiMappingListSchema = z.array(MidiMappingSchema);

export const MIDI_MAPPINGS_STORAGE_KEY = 'xasm1_midi_mappings';
export const MIDI_ENABLED_STORAGE_KEY = 'xasm1_midi_enabled';

/**
 * Default mappings — MMC-style transport notes + GM CCs.
 * See docs/MIDI_CONTROLS.md for full table.
 */
export const DEFAULT_MIDI_MAPPINGS: MidiMapping[] = [
  // Transport (MIDI Machine Control style, any channel)
  { id: 'mmc-play', kind: 'noteOn', note: 94, command: 'transport.play', noteOnOnly: true },
  { id: 'mmc-stop', kind: 'noteOn', note: 93, command: 'transport.pause', noteOnOnly: true },
  { id: 'mmc-rewind', kind: 'noteOn', note: 91, command: 'seek.prevOrder', noteOnOnly: true },
  { id: 'mmc-forward', kind: 'noteOn', note: 92, command: 'seek.nextOrder', noteOnOnly: true },
  // Simple keyboard / pad fallback
  { id: 'middle-c-toggle', kind: 'noteOn', note: 60, command: 'transport.playPause', noteOnOnly: true },
  // Order jumps (C2–C3 pad, like digit keys 1–9)
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `order-${i}`,
    kind: 'noteOn' as const,
    note: 36 + i,
    command: 'seek.jumpToOrder' as const,
    noteOnOnly: true,
  })),
  // Expression
  { id: 'cc-volume', kind: 'cc', controller: 7, command: 'volume.set' },
  { id: 'cc-pan', kind: 'cc', controller: 10, command: 'pan.set' },
  // Shader program change
  { id: 'program-shader', kind: 'programChange', command: 'shader.selectByIndex' },
];

export function loadMidiMappings(): MidiMapping[] {
  try {
    const raw = localStorage.getItem(MIDI_MAPPINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_MIDI_MAPPINGS;
    const parsed = MidiMappingListSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_MIDI_MAPPINGS;
    return parsed.data as MidiMapping[];
  } catch {
    return DEFAULT_MIDI_MAPPINGS;
  }
}

export function saveMidiMappings(mappings: MidiMapping[]): void {
  try {
    localStorage.setItem(MIDI_MAPPINGS_STORAGE_KEY, JSON.stringify(mappings));
  } catch {
    /* quota */
  }
}

export function loadMidiEnabled(): boolean {
  try {
    const raw = localStorage.getItem(MIDI_ENABLED_STORAGE_KEY);
    if (raw === '0') return false;
    if (raw === '1') return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function saveMidiEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(MIDI_ENABLED_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* quota */
  }
}

export function resetMidiMappings(): MidiMapping[] {
  saveMidiMappings(DEFAULT_MIDI_MAPPINGS);
  return DEFAULT_MIDI_MAPPINGS;
}

export function midiChannelFromStatus(status: number): number {
  return (status & 0x0f) + 1;
}

export function midiMessageType(status: number): number {
  return status & 0xf0;
}

export function matchMidiMapping(
  mappings: MidiMapping[],
  status: number,
  data1: number,
  data2: number,
): { mapping: MidiMapping; payload?: unknown } | null {
  const type = midiMessageType(status);
  const channel = midiChannelFromStatus(status);

  if (type === 0xb0) {
    const mapping = mappings.find(
      (m) => m.kind === 'cc'
        && m.controller === data1
        && (m.channel === undefined || m.channel === channel),
    );
    if (!mapping) return null;
    if (mapping.command === 'volume.set') {
      return { mapping, payload: { value: data2 / 127 } };
    }
    if (mapping.command === 'pan.set') {
      return { mapping, payload: { value: (data2 / 127) * 2 - 1 } };
    }
    return { mapping };
  }

  if (type === 0xc0) {
    const mapping = mappings.find(
      (m) => m.kind === 'programChange'
        && (m.channel === undefined || m.channel === channel),
    );
    if (!mapping) return null;
    if (mapping.command === 'shader.selectByIndex') {
      return { mapping, payload: { index: data1 } };
    }
    return { mapping };
  }

  const isNoteOn = type === 0x90 && data2 > 0;
  const isNoteOff = type === 0x80 || (type === 0x90 && data2 === 0);
  if (!isNoteOn && !isNoteOff) return null;

  const note = data1;
  const mapping = mappings.find(
    (m) => m.kind === 'noteOn'
      && m.note === note
      && (m.channel === undefined || m.channel === channel),
  );
  if (!mapping) return null;
  if (mapping.noteOnOnly !== false && isNoteOff) return null;

  if (mapping.command === 'seek.jumpToOrder' && mapping.id.startsWith('order-')) {
    const order = Number.parseInt(mapping.id.replace('order-', ''), 10);
    if (Number.isFinite(order)) {
      return { mapping, payload: { order } };
    }
  }

  return { mapping };
}

export function isWebMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}
