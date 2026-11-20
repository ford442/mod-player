/**
 * The one piece of MIDI-out settings the eager bundle needs (#538): is there a saved output to reopen?
 * Everything else (utils/midiOut.ts) ships in the lazy MIDI-out chunk.
 */
export const MIDI_OUT_STORAGE_KEY = 'xasm1_midi_out';

export function hasSavedMidiOutput(): boolean {
  try {
    const raw = window.localStorage.getItem(MIDI_OUT_STORAGE_KEY);
    return raw !== null && typeof (JSON.parse(raw) as { outputId?: unknown } | null)?.outputId === 'string';
  } catch {
    return false;
  }
}
