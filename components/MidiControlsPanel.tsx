import React from 'react';
import { cn } from '../utils/cn';
import type { useMidiControls } from '../hooks/useMidiControls';
import { COMMAND_LABELS } from '../utils/playerCommands';
import { DEFAULT_MIDI_MAPPINGS } from '../utils/midiMappings';

type MidiControls = ReturnType<typeof useMidiControls>;

interface MidiControlsPanelProps {
  midi: MidiControls;
  isDarkMode: boolean;
}

export const MidiControlsPanel: React.FC<MidiControlsPanelProps> = ({ midi, isDarkMode }) => {
  if (!midi.supported) {
    return (
      <p className="text-xs text-gray-500 font-mono">
        Web MIDI is not available in this browser. Use Chrome or Edge for controller support.
      </p>
    );
  }

  return (
    <div className="space-y-3 text-xs font-mono">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void midi.requestAccess()}
          className={cn(
            'px-3 py-1.5 rounded border transition-colors',
            midi.accessGranted
              ? 'bg-green-900/40 text-green-300 border-green-700'
              : 'bg-cyan-900/40 text-cyan-200 border-cyan-600 hover:bg-cyan-800/50',
          )}
        >
          {midi.accessGranted ? '✓ MIDI Connected' : 'Enable MIDI'}
        </button>
        <label className="flex items-center gap-2 text-gray-400">
          <input
            type="checkbox"
            checked={midi.enabled}
            onChange={(e) => midi.setEnabled(e.target.checked)}
            className="accent-cyan-500"
          />
          Active
        </label>
        <button
          type="button"
          onClick={() => midi.restoreDefaultMappings()}
          className="px-2 py-1 rounded border border-gray-600 text-gray-400 hover:text-gray-200"
        >
          Reset mappings
        </button>
      </div>

      {midi.error && (
        <p className="text-amber-400">{midi.error}</p>
      )}

      {midi.accessGranted && (
        <p className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
          {midi.inputCount > 0
            ? `Inputs: ${midi.inputNames.join(', ')}`
            : 'No MIDI inputs detected — plug in a controller and refresh.'}
        </p>
      )}

      {midi.lastEvent && (
        <p className="text-[10px] text-gray-500 truncate" title={midi.lastEvent}>
          Last: {midi.lastEvent}
        </p>
      )}

      <details className={cn('rounded border p-2', isDarkMode ? 'border-gray-700' : 'border-gray-300')}>
        <summary className="cursor-pointer text-gray-400">Default mapping table</summary>
        <ul className="mt-2 space-y-1 text-[10px] text-gray-500 max-h-40 overflow-y-auto">
          {DEFAULT_MIDI_MAPPINGS.map((m) => (
            <li key={m.id}>
              {m.kind === 'noteOn' && `Note ${m.note}`}
              {m.kind === 'cc' && `CC ${m.controller}`}
              {m.kind === 'programChange' && 'Program Change'}
              {' → '}
              {COMMAND_LABELS[m.command]}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] text-gray-600">
          Full reference: <code>docs/MIDI_CONTROLS.md</code>
        </p>
      </details>
    </div>
  );
};
