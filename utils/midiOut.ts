/**
 * Web MIDI *output* plumbing (#538): feature detection, the permission query, access, the stored
 * choice. MIDI input and its mappings live in utils/midiMappings.ts / hooks/useMidiControls.ts and are
 * untouched; the controller that drives an output is audio/midi/midiOutController.ts. This file belongs to
 * the lazy MIDI-out chunk: eager code uses utils/midiOutSaved.ts and `isWebMidiSupported` instead.
 *
 * Access is requested without SysEx (`{ sysex: false }`) and, normally, from a click — Chromium asks
 * the user then. A page that was already granted can be re-opened silently on load; that is checked
 * with the Permissions API first so a restore never raises a prompt out of the blue.
 */
import { isWebMidiSupported } from './midiMappings';
import { MIDI_OUT_STORAGE_KEY } from './midiOutSaved';

export { MIDI_OUT_STORAGE_KEY };

export type MidiChannelMode = 'perChannel' | 'single';

/** What survives a reload. Everything but the device id is a preference of this browser profile. */
export interface MidiOutSettings {
  /** The chosen output's id (Chromium ids are stable per origin), or null for none. */
  outputId: string | null;
  /** Its name when it was chosen — shown while the device is unplugged. */
  outputName: string;
  /** Send Timing Clock, Start / Stop / Continue and Song Position Pointer. */
  clock: boolean;
  /** Send the pattern's notes (opt-in). */
  noteOut: boolean;
  /** `perChannel`: tracker channel n → MIDI channel ((n mod 16) + 1). `single`: all on `singleChannel`. */
  channelMode: MidiChannelMode;
  /** MIDI channel 1–16 for `single`. */
  singleChannel: number;
}

export const DEFAULT_MIDI_OUT_SETTINGS: MidiOutSettings = {
  outputId: null,
  outputName: '',
  clock: true,
  noteOut: false,
  channelMode: 'perChannel',
  singleChannel: 1,
};

/** Coerce whatever was stored into valid settings (a hand-edited or older value never throws). */
export function sanitizeMidiOutSettings(raw: unknown): MidiOutSettings {
  const d = DEFAULT_MIDI_OUT_SETTINGS;
  if (typeof raw !== 'object' || raw === null) return { ...d };
  const r = raw as Record<string, unknown>;
  const channel = typeof r.singleChannel === 'number' && Number.isFinite(r.singleChannel)
    ? Math.min(16, Math.max(1, Math.round(r.singleChannel)))
    : d.singleChannel;
  return {
    outputId: typeof r.outputId === 'string' && r.outputId ? r.outputId : null,
    outputName: typeof r.outputName === 'string' ? r.outputName.slice(0, 200) : d.outputName,
    clock: typeof r.clock === 'boolean' ? r.clock : d.clock,
    noteOut: typeof r.noteOut === 'boolean' ? r.noteOut : d.noteOut,
    channelMode: r.channelMode === 'single' ? 'single' : 'perChannel',
    singleChannel: channel,
  };
}

export function readStoredMidiOutSettings(): MidiOutSettings {
  try {
    const raw = window.localStorage.getItem(MIDI_OUT_STORAGE_KEY);
    return sanitizeMidiOutSettings(raw === null ? null : JSON.parse(raw));
  } catch {
    return { ...DEFAULT_MIDI_OUT_SETTINGS };
  }
}

export function writeStoredMidiOutSettings(settings: MidiOutSettings): void {
  try {
    window.localStorage.setItem(MIDI_OUT_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // quota / private mode: the choice just does not persist
  }
}

/** Web MIDI exists (Chromium, Edge; Safari and stock Firefox have no `requestMIDIAccess`). */
export function isWebMidiOutSupported(): boolean {
  return isWebMidiSupported();
}

export type MidiPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

/** The page's MIDI permission without asking for it. `unknown` where the Permissions API cannot say. */
export async function queryMidiPermission(): Promise<MidiPermission> {
  try {
    const permissions = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (!permissions) return 'unknown';
    const status = await permissions.query({ name: 'midi', sysex: false } as unknown as PermissionDescriptor);
    return status.state;
  } catch {
    return 'unknown';
  }
}

/** Ask for MIDI access (no SysEx). Raises the browser's prompt unless already granted. */
export function requestMidiOutAccess(): Promise<MIDIAccess> {
  return navigator.requestMIDIAccess({ sysex: false });
}

/** One line for the UI from a rejected `requestMIDIAccess()`. */
export function describeMidiAccessError(error: unknown): string {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  if (name === 'SecurityError' || name === 'NotAllowedError') {
    return 'MIDI access was blocked — allow it for this site in the browser, then try again';
  }
  if (name === 'NotSupportedError') return 'This browser has no Web MIDI';
  const detail = error instanceof Error ? error.message : String(error);
  return `Could not open MIDI: ${detail}`;
}
