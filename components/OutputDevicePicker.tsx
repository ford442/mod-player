/**
 * Output-device picker (#492 Phase 3). The choice is engine state — `PlayerEngine.setOutputDevice`
 * moves the one AudioContext with `setSinkId()`, no new context, no restart — so this component only
 * lists what the browser lets the page address and shows what the engine reports (`sinkError`).
 *
 * Hidden where `AudioContext.setSinkId` does not exist (Firefox, Safari). Chromium names its outputs
 * only to pages with microphone permission and has no `selectAudioOutput()`, so until then the list is
 * just the default output plus "Show all outputs…", which asks for that permission on request (the
 * stream is closed at once); where `selectAudioOutput()` exists, that entry opens the browser chooser.
 */
import { useCallback, useEffect, useState } from 'react';
import { cn } from '../utils/cn';
import { shallowEqual, usePlayerEngine } from '../hooks/usePlayerEngine';
import { usePlayerActions } from '../hooks/usePlayerView';
import {
  canRequestAudioOutput,
  DEFAULT_OUTPUT_DEVICE_ID,
  listAudioOutputDevices,
  requestAudioOutputDevice,
  revealAudioOutputDevices,
  type AudioOutputList,
} from '../utils/audioOutputDevices';

const MORE_OUTPUTS = '__xasm1_more_outputs__';

function useAudioOutputList(enabled: boolean): [AudioOutputList | null, () => Promise<void>] {
  const [list, setList] = useState<AudioOutputList | null>(null);
  const refresh = useCallback(async () => {
    setList(await listAudioOutputDevices());
  }, []);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const update = () => {
      void listAudioOutputDevices().then((next) => {
        if (alive) setList(next);
      });
    };
    update();
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    md?.addEventListener('devicechange', update);
    return () => {
      alive = false;
      md?.removeEventListener('devicechange', update);
    };
  }, [enabled]);
  return [list, refresh];
}

export function OutputDevicePicker({ isDarkMode }: { isDarkMode: boolean }) {
  const output = usePlayerEngine(
    (s) => ({
      supported: s.outputDeviceSupported,
      deviceId: s.outputDeviceId,
      label: s.outputDeviceLabel,
      switching: s.outputDeviceSwitching,
      error: s.sinkError,
    }),
    shallowEqual,
  );
  const { setOutputDevice } = usePlayerActions();
  const [list, refresh] = useAudioOutputList(output.supported);
  const [asking, setAsking] = useState(false);

  if (!output.supported) return null;

  const devices = list?.devices ?? [];
  const listed =
    output.deviceId === DEFAULT_OUTPUT_DEVICE_ID || devices.some((d) => d.deviceId === output.deviceId);
  const canChooser = canRequestAudioOutput();
  const offerMore = canChooser || (list?.hidden ?? false);
  // Chromium labels its `default` entry "Default - <device>"; the option already says default.
  const defaultName = list?.defaultLabel.replace(/^default\s*-\s*/i, '') ?? '';

  const choose = async (value: string) => {
    if (value === MORE_OUTPUTS) {
      setAsking(true);
      try {
        if (canChooser) {
          const picked = await requestAudioOutputDevice();
          if (picked) await setOutputDevice(picked.deviceId, picked.label);
        } else {
          await revealAudioOutputDevices();
        }
        await refresh();
      } finally {
        setAsking(false);
      }
      return;
    }
    await setOutputDevice(value, devices.find((d) => d.deviceId === value)?.label ?? '');
  };

  return (
    <div className="flex items-center gap-2" data-testid="output-device-picker">
      <select
        aria-label="Audio output device"
        value={output.deviceId}
        disabled={output.switching || asking}
        onChange={(e) => { void choose(e.target.value); }}
        className={cn(
          'max-w-[14rem] truncate px-3 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border outline-none cursor-pointer disabled:cursor-wait disabled:opacity-60',
          isDarkMode
            ? 'bg-gray-800 text-white border-gray-700 hover:bg-gray-700'
            : 'bg-white text-black border-gray-300 hover:bg-gray-50',
        )}
        title={output.error ?? 'Audio output device — switches without restarting playback'}
      >
        <option value={DEFAULT_OUTPUT_DEVICE_ID}>
          {defaultName ? `Output: default (${defaultName})` : 'Output: default'}
        </option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>{`Output: ${d.label}`}</option>
        ))}
        {!listed && (
          <option value={output.deviceId}>
            {`Output: ${output.label || 'saved device'}${list && !list.hidden ? ' (not connected)' : ''}`}
          </option>
        )}
        {offerMore && (
          <option
            value={MORE_OUTPUTS}
            title={canChooser
              ? 'Pick an output in the browser’s device chooser'
              : 'The browser names output devices only to pages with microphone access; this asks for it and closes the microphone at once'}
          >
            {canChooser ? 'Choose output…' : 'Show all outputs…'}
          </option>
        )}
      </select>
      {output.error && (
        <span
          role="status"
          className="max-w-[16rem] truncate text-xs font-mono text-amber-400"
          title={output.error}
        >
          ⚠ {output.error}
        </span>
      )}
    </div>
  );
}
