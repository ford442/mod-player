import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadMidiEnabled,
  loadMidiMappings,
  matchMidiMapping,
  saveMidiEnabled,
  saveMidiMappings,
  resetMidiMappings,
  isWebMidiSupported,
  type MidiMapping,
} from '../utils/midiMappings';
import { playerCommands } from '../utils/playerCommands';

export interface MidiControlsState {
  supported: boolean;
  enabled: boolean;
  accessGranted: boolean;
  inputCount: number;
  inputNames: string[];
  lastEvent: string | null;
  error: string | null;
}

export function useMidiControls() {
  const [state, setState] = useState<MidiControlsState>({
    supported: isWebMidiSupported(),
    enabled: loadMidiEnabled(),
    accessGranted: false,
    inputCount: 0,
    inputNames: [],
    lastEvent: null,
    error: null,
  });

  const mappingsRef = useRef<MidiMapping[]>(loadMidiMappings());
  const accessRef = useRef<MIDIAccess | null>(null);
  const listenersRef = useRef<Map<MIDIInput, (event: MIDIMessageEvent) => void>>(new Map());

  const refreshInputs = useCallback(() => {
    const access = accessRef.current;
    if (!access) {
      setState((prev) => ({ ...prev, inputCount: 0, inputNames: [] }));
      return;
    }
    const names: string[] = [];
    for (const input of access.inputs.values()) {
      if (input.state === 'connected') {
        names.push(input.name || 'MIDI Input');
      }
    }
    setState((prev) => ({
      ...prev,
      inputCount: names.length,
      inputNames: names,
    }));
  }, []);

  const detachInputs = useCallback(() => {
    for (const [input, listener] of listenersRef.current) {
      input.onmidimessage = null;
      listenersRef.current.delete(input);
      void input;
      void listener;
    }
    listenersRef.current.clear();
  }, []);

  const handleMidiMessage = useCallback((event: MIDIMessageEvent) => {
    const data = event.data;
    if (!data || data.length < 1) return;
    const status = data[0] ?? 0;
    const data1 = data[1] ?? 0;
    const data2 = data[2] ?? 0;

    const matched = matchMidiMapping(mappingsRef.current, status, data1, data2);
    if (!matched) return;

    const result = playerCommands.dispatch(
      matched.mapping.command,
      'midi',
      matched.payload as never,
    );

    if (result.handled) {
      setState((prev) => ({
        ...prev,
        lastEvent: `${matched.mapping.command} ← ch${(status & 0x0f) + 1} ${status.toString(16)} ${data1} ${data2}`,
      }));
    }
  }, []);

  const attachInputs = useCallback((access: MIDIAccess) => {
    detachInputs();
    for (const input of access.inputs.values()) {
      const listener = (event: MIDIMessageEvent) => handleMidiMessage(event);
      input.onmidimessage = listener;
      listenersRef.current.set(input, listener);
    }
    refreshInputs();
  }, [detachInputs, handleMidiMessage, refreshInputs]);

  const requestAccess = useCallback(async () => {
    if (!isWebMidiSupported()) {
      setState((prev) => ({ ...prev, error: 'Web MIDI API not supported in this browser' }));
      return false;
    }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      accessRef.current = access;
      access.onstatechange = () => {
        attachInputs(access);
        refreshInputs();
      };
      attachInputs(access);
      setState((prev) => ({
        ...prev,
        accessGranted: true,
        error: null,
      }));
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'MIDI permission denied';
      setState((prev) => ({ ...prev, accessGranted: false, error: message }));
      return false;
    }
  }, [attachInputs, refreshInputs]);

  const setEnabled = useCallback((enabled: boolean) => {
    saveMidiEnabled(enabled);
    playerCommands.setState({ midiEnabled: enabled });
    setState((prev) => ({ ...prev, enabled }));
  }, []);

  const setMappings = useCallback((mappings: MidiMapping[]) => {
    mappingsRef.current = mappings;
    saveMidiMappings(mappings);
  }, []);

  const restoreDefaultMappings = useCallback(() => {
    const defaults = resetMidiMappings();
    mappingsRef.current = defaults;
    return defaults;
  }, []);

  useEffect(() => {
    playerCommands.setState({ midiEnabled: state.enabled });
  }, [state.enabled]);

  useEffect(() => {
    if (!state.supported || !state.enabled) {
      detachInputs();
      return;
    }
    if (accessRef.current) {
      attachInputs(accessRef.current);
    }
    return detachInputs;
  }, [state.supported, state.enabled, attachInputs, detachInputs]);

  useEffect(() => () => {
    detachInputs();
    accessRef.current = null;
  }, [detachInputs]);

  return {
    ...state,
    mappings: mappingsRef.current,
    requestAccess,
    setEnabled,
    setMappings,
    restoreDefaultMappings,
  };
}
