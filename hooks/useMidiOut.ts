/**
 * React binding for MIDI out (#538), the same shape as `usePlayerEngine`: the controller
 * (audio/midi/midiOutController.ts) is framework-free and owns the state; components select slices.
 *
 * Imported only by the lazy panel (components/MidiOutPanel.tsx): it imports the controller statically,
 * so the eager code must not import this file — see hooks/useMidiOutRestore.ts.
 */
import { useRef, useSyncExternalStore } from 'react';
import { getMidiOutController, type MidiOutController, type MidiOutState } from '../audio/midi/midiOutController';
import { usePlayerEngineInstance } from './usePlayerEngine';

/** The page's MIDI-out controller for the engine in context (created on first use). */
export function useMidiOutController(): MidiOutController {
  return getMidiOutController(usePlayerEngineInstance());
}

/** Subscribe to a slice of the controller's state; `isEqual` decides when a new selection is "the same". */
export function useMidiOutState<T>(
  selector: (state: MidiOutState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const controller = useMidiOutController();
  const memo = useRef<{ value: T } | null>(null);
  const getSelection = (): T => {
    const next = selector(controller.getSnapshot());
    const previous = memo.current;
    if (previous && isEqual(previous.value, next)) return previous.value;
    memo.current = { value: next };
    return next;
  };
  return useSyncExternalStore(controller.subscribe, getSelection, getSelection);
}
