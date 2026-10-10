import { z } from 'zod';
import type { FxModuleId } from '../audio/fx/types';
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
  /** FX rack target (#453) for fx.* commands: which module / param, or preset step. */
  fxTarget?: MidiFxTarget;
}

export interface MidiFxTarget {
  module: FxModuleId | 'rack';
  /** fx.setParam: the param a CC drives (0…127 → 0…1 along its scale). */
  param?: string;
  /** fx.preset on a note: step direction (default +1). */
  step?: 1 | -1;
}

const MidiMappingSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['noteOn', 'cc', 'programChange']),
  channel: z.number().int().min(1).max(16).optional(),
  note: z.number().int().min(0).max(127).optional(),
  controller: z.number().int().min(0).max(127).optional(),
  command: z.string(),
  noteOnOnly: z.boolean().optional(),
  fxTarget: z
    .object({
      module: z.enum(['character', 'eq', 'comp', 'room', 'rack']),
      param: z.string().optional(),
      step: z.union([z.literal(1), z.literal(-1)]).optional(),
    })
    .optional(),
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
  // FX rack (#453) on the GM controllers for reverb send, brightness and timbre
  { id: 'cc-fx-room', kind: 'cc', controller: 91, command: 'fx.setParam', fxTarget: { module: 'room', param: 'mix' } },
  { id: 'cc-fx-bright', kind: 'cc', controller: 74, command: 'fx.setParam', fxTarget: { module: 'eq', param: 'highGain' } },
  { id: 'cc-fx-drive', kind: 'cc', controller: 71, command: 'fx.setParam', fxTarget: { module: 'character', param: 'drive' } },
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

/** First mapping on this exact channel, else the first any-channel one. */
function findMapping(
  mappings: MidiMapping[],
  channel: number,
  matches: (m: MidiMapping) => boolean,
): MidiMapping | undefined {
  return (
    mappings.find((m) => matches(m) && m.channel === channel)
    ?? mappings.find((m) => matches(m) && m.channel === undefined)
  );
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
    const mapping = findMapping(mappings, channel, (m) => m.kind === 'cc' && m.controller === data1);
    if (!mapping) return null;
    if (mapping.command === 'volume.set') {
      return { mapping, payload: { value: data2 / 127 } };
    }
    if (mapping.command === 'pan.set') {
      return { mapping, payload: { value: (data2 / 127) * 2 - 1 } };
    }
    const fx = mapping.fxTarget;
    if (mapping.command === 'fx.setParam' && fx?.param && fx.module !== 'rack') {
      return { mapping, payload: { module: fx.module, param: fx.param, value: data2 / 127, normalized: true } };
    }
    if (mapping.command === 'fx.toggle' && fx) {
      return { mapping, payload: { module: fx.module, enabled: data2 >= 64 } };
    }
    return { mapping };
  }

  if (type === 0xc0) {
    const mapping = findMapping(mappings, channel, (m) => m.kind === 'programChange');
    if (!mapping) return null;
    if (mapping.command === 'shader.selectByIndex') {
      return { mapping, payload: { index: data1 } };
    }
    if (mapping.command === 'fx.preset') {
      return { mapping, payload: { index: data1 } };
    }
    return { mapping };
  }

  const isNoteOn = type === 0x90 && data2 > 0;
  const isNoteOff = type === 0x80 || (type === 0x90 && data2 === 0);
  if (!isNoteOn && !isNoteOff) return null;

  const note = data1;
  const mapping = findMapping(mappings, channel, (m) => m.kind === 'noteOn' && m.note === note);
  if (!mapping) return null;
  if (mapping.noteOnOnly !== false && isNoteOff) return null;

  if (mapping.command === 'seek.jumpToOrder' && mapping.id.startsWith('order-')) {
    const order = Number.parseInt(mapping.id.replace('order-', ''), 10);
    if (Number.isFinite(order)) {
      return { mapping, payload: { order } };
    }
  }
  if (mapping.command === 'fx.toggle' && mapping.fxTarget) {
    return { mapping, payload: { module: mapping.fxTarget.module } };
  }
  if (mapping.command === 'fx.preset') {
    return { mapping, payload: { step: mapping.fxTarget?.step ?? 1 } };
  }

  return { mapping };
}

export function isWebMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}
