/**
 * MIDI out (#538): pick an output, choose what goes to it — Timing Clock + transport, and
 * (opt-in) the pattern's notes. Mirrors the audio output picker: the choice is engine-side state
 * (audio/midi/midiOutController.ts) saved per browser; this only lists and shows. Renders nothing where
 * Web MIDI does not exist (Safari, stock Firefox) — MidiControlsPanel already says so for MIDI in.
 */
import React from 'react';
import { cn } from '../utils/cn';
import { useMidiOutController, useMidiOutState } from '../hooks/useMidiOut';

const NO_OUTPUT = '';

interface MidiOutPanelProps {
  isDarkMode: boolean;
}

export const MidiOutPanel: React.FC<MidiOutPanelProps> = ({ isDarkMode }) => {
  const controller = useMidiOutController();
  const midi = useMidiOutState((s) => s);

  if (!midi.supported) return null;

  const { settings, stats } = midi;
  const granted = midi.access === 'granted';
  const listed = settings.outputId === null || midi.outputs.some((o) => o.id === settings.outputId);
  const field = cn(
    'px-2 py-1 rounded border outline-none cursor-pointer',
    isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-black border-gray-300',
  );

  return (
    <div className="space-y-2 text-xs font-mono" data-testid="midi-out-panel">
      <div className={cn('text-[10px] uppercase tracking-wide', isDarkMode ? 'text-gray-500' : 'text-gray-600')}>
        MIDI out — clock &amp; notes
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!granted && (
          <button
            type="button"
            disabled={midi.access === 'requesting'}
            onClick={() => { void controller.enableAccess(); }}
            className="px-3 py-1.5 rounded border transition-colors bg-cyan-900/40 text-cyan-200 border-cyan-600 hover:bg-cyan-800/50 disabled:opacity-60 disabled:cursor-wait"
          >
            Enable MIDI out
          </button>
        )}
        {granted && (
          <select
            aria-label="MIDI output"
            value={settings.outputId ?? NO_OUTPUT}
            onChange={(e) => controller.selectOutput(e.target.value === NO_OUTPUT ? null : e.target.value)}
            className={cn(field, 'max-w-[14rem] truncate')}
            title="Send the clock / notes to this MIDI output"
          >
            <option value={NO_OUTPUT}>MIDI out: none</option>
            {midi.outputs.map((o) => (
              <option key={o.id} value={o.id}>{`MIDI out: ${o.name}`}</option>
            ))}
            {!listed && (
              <option value={settings.outputId ?? NO_OUTPUT}>
                {`MIDI out: ${settings.outputName || 'saved output'} (not connected)`}
              </option>
            )}
          </select>
        )}
      </div>

      {granted && midi.outputs.length === 0 && (
        <p className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
          No MIDI outputs found — connect a device or a virtual port (IAC, loopMIDI) to send the clock to a DAW.
        </p>
      )}

      {granted && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-gray-400" title="Timing Clock at the module's BPM; Start / Stop / Continue follow the transport; Song Position Pointer follows seeks">
            <input
              type="checkbox"
              checked={settings.clock}
              onChange={(e) => controller.setClockEnabled(e.target.checked)}
              className="accent-cyan-500"
            />
            Clock &amp; transport
          </label>
          <label className="flex items-center gap-2 text-gray-400" title="Note-on / note-off from the pattern, per tracker channel">
            <input
              type="checkbox"
              checked={settings.noteOut}
              onChange={(e) => controller.setNoteOutEnabled(e.target.checked)}
              className="accent-cyan-500"
            />
            Pattern notes
          </label>
          {settings.noteOut && (
            <div className="flex flex-wrap items-center gap-2 pl-5 text-gray-400">
              <select
                aria-label="MIDI channel mapping"
                value={settings.channelMode}
                onChange={(e) => controller.setChannelMode(e.target.value === 'single' ? 'single' : 'perChannel')}
                className={field}
              >
                <option value="perChannel">Tracker channel n → MIDI channel n</option>
                <option value="single">All tracker channels on one MIDI channel</option>
              </select>
              {settings.channelMode === 'single' && (
                <select
                  aria-label="MIDI channel"
                  value={settings.singleChannel}
                  onChange={(e) => controller.setSingleChannel(Number(e.target.value))}
                  className={field}
                >
                  {Array.from({ length: 16 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>{`Channel ${i + 1}`}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          {settings.noteOut && (
            <p className="pl-5 text-[10px] text-gray-500">
              Don&apos;t route this output back into a controller this player listens to: the notes would trigger
              its transport mappings (notes 36–44, 60, 91–94).
            </p>
          )}
        </div>
      )}

      {midi.error && <p className="text-amber-400" role="status">{midi.error}</p>}

      {midi.connected && (settings.clock || settings.noteOut) && (
        <p className="text-[10px] text-gray-500" data-testid="midi-out-stats">
          {`sent ${stats.pulses} clocks${settings.noteOut ? `, ${stats.notes} notes` : ''}`}
          {stats.late > 0 ? ` · ${stats.late} late` : ''}
          {stats.skipped > 0 ? ` · ${stats.skipped} dropped` : ''}
        </p>
      )}
    </div>
  );
};
