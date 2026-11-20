/**
 * Mounted once at the app root (#538): when a MIDI output was saved, load the MIDI-out controller and
 * reopen it, so the clock is already listening to the transport at the first play. It never prompts —
 * the output is reopened only if the browser already granted MIDI.
 *
 * Without a saved output nothing is loaded: the controller (audio/midi/) is a lazy chunk the initial
 * page does not carry (scripts/verify-bundle-budget.mjs). It is a *dynamic* import on purpose; keep
 * this file free of static imports of audio/midi/, utils/midiOut.ts and hooks/useMidiOut.ts.
 */
import { useEffect } from 'react';
import { isWebMidiSupported } from '../utils/midiMappings';
import { hasSavedMidiOutput } from '../utils/midiOutSaved';
import { usePlayerEngineInstance } from './usePlayerEngine';

export function useMidiOutRestore(): void {
  const engine = usePlayerEngineInstance();
  useEffect(() => {
    if (!isWebMidiSupported() || !hasSavedMidiOutput()) return undefined;
    let cancelled = false;
    import('../audio/midi/midiOutController')
      .then(({ getMidiOutController }) => (cancelled ? undefined : getMidiOutController(engine).restore()))
      .catch((err: unknown) => console.warn('[MidiOut] could not restore the saved output:', err));
    return () => { cancelled = true; };
  }, [engine]);
}
