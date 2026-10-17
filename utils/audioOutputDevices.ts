/**
 * Audio output devices (#492 Phase 3): the saved choice, and the browser APIs that list and grant
 * output devices. Framework-free — the PlayerEngine (audio/engine/outputDevice.ts) owns the choice and
 * applies it; the picker (components/OutputDevicePicker.tsx) lists what it can offer.
 *
 * What a page can see differs by browser:
 *  - Chromium: `AudioContext.setSinkId` exists, `selectAudioOutput()` does not, and
 *    `enumerateDevices()` returns one anonymous `audiooutput` (empty id and label) until the page has
 *    microphone permission. With it, every output is listed with a label, plus a `default` entry that
 *    follows the OS default (the same thing as the spec's empty sink id).
 *  - Firefox: `selectAudioOutput()` grants one device (and its label) per call; no
 *    `AudioContext.setSinkId` yet, so the picker is hidden there.
 *  - Safari: neither.
 */
import { readLocalStorage } from './localStorageIO';

/** localStorage key of the chosen output (per browser profile; device ids are origin-scoped). */
export const OUTPUT_DEVICE_STORAGE_KEY = 'xasm1_audio_output_device';

/** The system default output — the spec's empty sink id. */
export const DEFAULT_OUTPUT_DEVICE_ID = '';

export interface StoredOutputDevice {
  deviceId: string;
  /** The label when it was chosen, for display while the device is not enumerable or not connected. */
  label: string;
}

/** Chromium's `default` entry follows the OS default output, exactly like the empty id: store one id for both. */
export function normalizeOutputDeviceId(deviceId: string): string {
  return deviceId === 'default' ? DEFAULT_OUTPUT_DEVICE_ID : deviceId;
}

/** The saved non-default output, or null (default output, nothing saved, or an unreadable entry). */
export function readStoredOutputDevice(): StoredOutputDevice | null {
  const raw = readLocalStorage<unknown>(OUTPUT_DEVICE_STORAGE_KEY, null);
  if (typeof raw !== 'object' || raw === null) return null;
  const { deviceId, label } = raw as Record<string, unknown>;
  if (typeof deviceId !== 'string') return null;
  const id = normalizeOutputDeviceId(deviceId);
  if (id === DEFAULT_OUTPUT_DEVICE_ID) return null;
  return { deviceId: id, label: typeof label === 'string' ? label : '' };
}

/** Save the choice; null (or the default id) forgets it. */
export function writeStoredOutputDevice(device: StoredOutputDevice | null): void {
  const id = device ? normalizeOutputDeviceId(device.deviceId) : DEFAULT_OUTPUT_DEVICE_ID;
  try {
    if (id === DEFAULT_OUTPUT_DEVICE_ID) window.localStorage.removeItem(OUTPUT_DEVICE_STORAGE_KEY);
    else window.localStorage.setItem(OUTPUT_DEVICE_STORAGE_KEY, JSON.stringify({ deviceId: id, label: device?.label ?? '' }));
  } catch {
    // quota / private mode / no storage: the choice lasts for this page session only
  }
}

export interface AudioOutputOption {
  deviceId: string;
  label: string;
}

export interface AudioOutputList {
  /** Selectable non-default outputs (ids are never empty). */
  devices: AudioOutputOption[];
  /** The OS default's label when the browser names it (Chromium's `default` entry), else ''. */
  defaultLabel: string;
  /** The browser is withholding devices (anonymous entries): a permission would reveal more. */
  hidden: boolean;
}

type MediaDevicesLike = Pick<MediaDevices, 'enumerateDevices'>;

function mediaDevices(): MediaDevices | null {
  return typeof navigator !== 'undefined' && navigator.mediaDevices ? navigator.mediaDevices : null;
}

/**
 * The outputs the page may address. Unlabelled entries with an id are numbered ("Output 2"), so a
 * browser that exposes ids without labels still gets a usable list.
 */
export async function listAudioOutputDevices(
  devices: MediaDevicesLike | null = mediaDevices(),
): Promise<AudioOutputList> {
  const empty: AudioOutputList = { devices: [], defaultLabel: '', hidden: false };
  if (!devices || typeof devices.enumerateDevices !== 'function') return empty;
  let infos: MediaDeviceInfo[];
  try {
    infos = await devices.enumerateDevices();
  } catch {
    return empty;
  }
  const list: AudioOutputList = { devices: [], defaultLabel: '', hidden: false };
  const seen = new Set<string>();
  for (const info of infos) {
    if (info.kind !== 'audiooutput') continue;
    if (!info.deviceId) {
      list.hidden = true;
      continue;
    }
    if (normalizeOutputDeviceId(info.deviceId) === DEFAULT_OUTPUT_DEVICE_ID) {
      list.defaultLabel = info.label;
      continue;
    }
    if (seen.has(info.deviceId)) continue;
    seen.add(info.deviceId);
    list.devices.push({ deviceId: info.deviceId, label: info.label || `Output ${list.devices.length + 1}` });
  }
  return list;
}

/** `navigator.mediaDevices.selectAudioOutput()` exists (Firefox): the browser's own device chooser. */
export function canRequestAudioOutput(): boolean {
  const md = mediaDevices() as (MediaDevices & { selectAudioOutput?: unknown }) | null;
  return typeof md?.selectAudioOutput === 'function';
}

/** Ask the browser's chooser for one output (grants its id and label). Null when dismissed or unavailable. */
export async function requestAudioOutputDevice(): Promise<AudioOutputOption | null> {
  const md = mediaDevices() as (MediaDevices & {
    selectAudioOutput?: () => Promise<MediaDeviceInfo>;
  }) | null;
  if (typeof md?.selectAudioOutput !== 'function') return null;
  try {
    const info = await md.selectAudioOutput();
    return info.deviceId ? { deviceId: info.deviceId, label: info.label } : null;
  } catch {
    return null; // dismissed (NotAllowedError) or no device
  }
}

/**
 * Chromium lists output devices only to pages with microphone permission, and has no
 * `selectAudioOutput()`. This asks for that permission on the user's explicit request (the picker's
 * "Show all outputs…") and closes the stream at once — nothing is recorded. True when granted.
 */
export async function revealAudioOutputDevices(): Promise<boolean> {
  const md = mediaDevices();
  if (typeof md?.getUserMedia !== 'function') return false;
  try {
    const stream = await md.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch {
    return false;
  }
}
