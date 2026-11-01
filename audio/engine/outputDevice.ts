/**
 * Output-device selection (#492 Phase 3): which device the one AudioContext renders to.
 *
 * The choice is player state: it lives in the PlayerEngine snapshot (`outputDeviceId`, `sinkError`, …)
 * and is applied with `AudioContext.setSinkId()` on the existing context (`switchPlayerAudioSink`).
 * The context is never suspended, closed or recreated to change device (pitfall 12).
 *
 * The context does not exist before the first play (the start path creates it lazily). Until then the
 * choice is only remembered; when the start path acquires the context it calls `attach(ctx)` — after
 * resume, before any engine is connected — and the context moves to the chosen device before it
 * renders a sample of the song.
 *
 * Persistence is per browser profile (localStorage; Chromium device ids are origin-scoped and stable).
 * A saved id that no longer resolves — device unplugged, ids rotated after clearing site data — leaves
 * the default output playing with a notice in `sinkError`, and stays saved: a `devicechange` (the
 * device is plugged back in) retries it, and so does the next session.
 *
 * The browser can move the output too (`sinkchange`), and a device can vanish mid-song (`error` on the
 * context, `devicechange`): the snapshot follows what the context really renders to, falling back to
 * the default output when the chosen device is gone. Every move re-anchors the playhead clock through
 * `onSinkMoved` — output latency belongs to the device.
 */
import {
  isAudioSinkSelectionSupported,
  readAudioSinkId,
  SILENT_SINK_ID,
  switchPlayerAudioSink,
} from '../../utils/audioContextFactory';
import {
  DEFAULT_OUTPUT_DEVICE_ID,
  listAudioOutputDevices,
  normalizeOutputDeviceId,
  readStoredOutputDevice,
  writeStoredOutputDevice,
  type AudioOutputList,
  type StoredOutputDevice,
} from '../../utils/audioOutputDevices';
import { createLogger } from '../../utils/log';

const log = createLogger('Engine');

/** The output-device part of the PlayerEngine snapshot. */
export interface OutputDeviceState {
  /** `AudioContext.setSinkId` exists; the picker is hidden otherwise. */
  readonly outputDeviceSupported: boolean;
  /** The device the context renders to — or will open on, before the first play. `''` = system default. */
  readonly outputDeviceId: string;
  /** Its label when known ('' for the default output or an unnamed device). */
  readonly outputDeviceLabel: string;
  /** A `setSinkId()` is in flight. */
  readonly outputDeviceSwitching: boolean;
  /** Why the output is not (or not yet) what was asked for, for the UI; null when it is. */
  readonly sinkError: string | null;
}

export interface OutputDeviceStorage {
  read(): StoredOutputDevice | null;
  write(device: StoredOutputDevice | null): void;
}

/** The environment the controller talks to; tests substitute each piece. */
export interface OutputDeviceEnv {
  supported: boolean;
  storage: OutputDeviceStorage;
  /** `devicechange` source (`navigator.mediaDevices`), or null. */
  deviceEvents: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  listOutputs: () => Promise<AudioOutputList>;
}

export function browserOutputDeviceEnv(): OutputDeviceEnv {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices ?? null : null;
  return {
    supported: isAudioSinkSelectionSupported(),
    storage: { read: readStoredOutputDevice, write: writeStoredOutputDevice },
    deviceEvents: md && typeof md.addEventListener === 'function' ? md : null,
    listOutputs: () => listAudioOutputDevices(md),
  };
}

export const SINK_UNSUPPORTED_MESSAGE = 'This browser cannot route web audio to another output device';

/** Why a switch was made: the user's pick, the saved choice, or recovery from a vanished device. */
export type SinkSwitchReason = 'select' | 'restore' | 'lost';

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** One line for the UI from a rejected `setSinkId()`; `name` is a quoted label or a description. */
export function describeSinkError(error: unknown, name: string, reason: SinkSwitchReason): string {
  const errorName = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  switch (errorName) {
    case 'NotFoundError':
      return reason === 'select'
        ? capitalize(`${name} is not available`)
        : capitalize(`${name} is not connected — playing on the default output`);
    case 'NotAllowedError':
      return capitalize(`not allowed to play on ${name}`);
    case 'NotSupportedError':
      return SINK_UNSUPPORTED_MESSAGE;
    default: {
      const detail = error instanceof Error ? error.message : String(error);
      return capitalize(`could not switch to ${name}: ${detail}`);
    }
  }
}

type SwitchOutcome = 'ok' | 'failed' | 'superseded';

function listen(target: unknown, type: string, handler: () => void): () => void {
  const t = target as Partial<Pick<EventTarget, 'addEventListener' | 'removeEventListener'>> | null;
  if (typeof t?.addEventListener !== 'function') return () => {};
  t.addEventListener(type, handler);
  return () => t.removeEventListener?.(type, handler);
}

export class OutputDeviceController {
  /** The choice in effect, optimistically updated by a switch in flight; null = the system default. */
  private preferred: StoredOutputDevice | null;
  /** The last confirmed (persisted) choice — what a refused switch falls back to. */
  private saved: StoredOutputDevice | null;
  /** The context whose events we follow (the one the start path handed over). */
  private ctx: AudioContext | null = null;
  private unlisten: (() => void) | null = null;
  /** Bumped by every switch request; a switch that settles under a newer one does not report. */
  private requestSeq = 0;
  /** Sequence number of the switch in flight, or null. */
  private pending: number | null = null;
  /** The sink the snapshot last reported: a `sinkchange` that lands on it is old news (ours, or a repeat). */
  private reportedSink: string | null = null;
  private readonly labels = new Map<string, string>();

  constructor(
    private readonly patch: (state: Partial<OutputDeviceState>) => void,
    private readonly onSinkMoved: (ctx: AudioContext) => void,
    private readonly env: OutputDeviceEnv,
  ) {
    this.preferred = env.supported ? env.storage.read() : null;
    this.saved = this.preferred;
    if (this.preferred) this.labels.set(this.preferred.deviceId, this.preferred.label);
  }

  /** The state before any context exists: the device the context will open on. */
  idleState(): OutputDeviceState {
    const id = this.preferredId();
    return {
      outputDeviceSupported: this.env.supported,
      outputDeviceId: id,
      outputDeviceLabel: this.labelOf(id),
      outputDeviceSwitching: false,
      sinkError: null,
    };
  }

  /**
   * The start path acquired `ctx` (it calls this on every play; idempotent per context). Follows the
   * context's `sinkchange` / `error` and the system's `devicechange`, then moves the context to the
   * chosen device. Returns a promise only when there is a switch to wait for.
   */
  attach(ctx: AudioContext): Promise<void> | undefined {
    if (ctx === this.ctx) return undefined;
    this.detach();
    this.ctx = ctx;
    const offs = [
      listen(ctx, 'sinkchange', () => this.handleSinkChange(ctx)),
      listen(ctx, 'error', () => this.handleContextError(ctx)),
      listen(this.env.deviceEvents, 'devicechange', () => { void this.handleDeviceChange(ctx); }),
    ];
    this.unlisten = () => { for (const off of offs) off(); };
    if (!this.env.supported) return undefined;
    const want = this.preferredId();
    if (want === readAudioSinkId(ctx)) {
      this.report(ctx, null);
      return undefined;
    }
    return this.switchTo(ctx, want, 'restore').then(() => undefined);
  }

  /** Stop following the context (teardown). A later `attach` starts over on the new context. */
  detach(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.ctx = null;
    this.requestSeq += 1;
    this.pending = null;
    this.reportedSink = null;
  }

  /**
   * Route the output to `deviceId` (`''` / `'default'` = the system default) and remember it. With a
   * context: `setSinkId()` on it — resolves true once the context renders there, false (previous
   * device kept, `sinkError` set) when the browser refuses. Without one: remembered for `attach`.
   */
  async select(deviceId: string, label = ''): Promise<boolean> {
    if (!this.env.supported) {
      this.patch({ sinkError: SINK_UNSUPPORTED_MESSAGE });
      return false;
    }
    const id = normalizeOutputDeviceId(deviceId);
    if (id !== DEFAULT_OUTPUT_DEVICE_ID && label) this.labels.set(id, label);
    const ctx = this.ctx && this.ctx.state !== 'closed' ? this.ctx : null;
    if (!ctx) {
      this.requestSeq += 1; // a switch still settling on a closed context must not report over this
      this.remember(id);
      this.patch(this.idleState());
      return true;
    }
    // Remember first, so a `sinkchange` fired before setSinkId's promise settles reads as ours.
    this.preferred = id === DEFAULT_OUTPUT_DEVICE_ID ? null : { deviceId: id, label: this.labelOf(id) };
    const outcome = await this.switchTo(ctx, id, 'select');
    if (outcome === 'ok') this.remember(id);
    else if (outcome === 'failed') this.preferred = this.saved;
    return outcome === 'ok';
  }

  private preferredId(): string {
    return this.preferred?.deviceId ?? DEFAULT_OUTPUT_DEVICE_ID;
  }

  private labelOf(id: string): string {
    return id === DEFAULT_OUTPUT_DEVICE_ID ? '' : this.labels.get(id) ?? '';
  }

  /** How the UI names a device in a message. */
  private nameOf(id: string): string {
    if (id === DEFAULT_OUTPUT_DEVICE_ID) return 'the default output';
    const label = this.labelOf(id);
    return label ? `“${label}”` : 'the saved output device';
  }

  private remember(id: string): void {
    this.preferred = id === DEFAULT_OUTPUT_DEVICE_ID ? null : { deviceId: id, label: this.labelOf(id) };
    this.saved = this.preferred;
    this.env.storage.write(this.preferred);
  }

  private async switchTo(
    ctx: AudioContext,
    id: string,
    reason: SinkSwitchReason,
    lostName = '',
  ): Promise<SwitchOutcome> {
    const seq = ++this.requestSeq;
    this.pending = seq;
    this.patch({ outputDeviceSwitching: true });
    let error: unknown = null;
    try {
      await switchPlayerAudioSink(ctx, id);
    } catch (e) {
      error = e ?? new Error('setSinkId rejected');
    }
    if (seq !== this.requestSeq || ctx !== this.ctx) return 'superseded';
    this.pending = null;
    if (error === null) {
      this.onSinkMoved(ctx);
      this.report(ctx, reason === 'lost'
        ? capitalize(`${lostName} disconnected — playing on the default output`)
        : null);
      return 'ok';
    }
    console.warn(`[Engine] output device switch (${reason}) failed`, error);
    this.report(ctx, describeSinkError(error, this.nameOf(id), reason));
    return 'failed';
  }

  /** Publish what `ctx` really renders to. */
  private report(ctx: AudioContext, sinkError: string | null): void {
    const actual = readAudioSinkId(ctx);
    this.reportedSink = actual;
    this.patch({
      outputDeviceId: actual,
      outputDeviceLabel: this.labelOf(actual),
      outputDeviceSwitching: this.pending !== null,
      sinkError,
    });
  }

  private handleSinkChange(ctx: AudioContext): void {
    if (ctx !== this.ctx) return;
    this.onSinkMoved(ctx);
    const actual = readAudioSinkId(ctx);
    // Our own switch reports when its promise settles — whether this event fires before that
    // (Chromium) or after (then the snapshot already shows `actual`).
    if (this.pending !== null || actual === this.reportedSink) return;
    log.log('the browser moved the output', { sinkId: actual });
    const moved = actual === SILENT_SINK_ID ? 'no output device' : this.nameOf(actual);
    this.report(ctx, actual === this.preferredId() ? null : `The browser moved the output to ${moved}`);
  }

  /** The render device failed (Chromium fires `error` on the context): fall back to the default output. */
  private handleContextError(ctx: AudioContext): void {
    if (ctx !== this.ctx || this.pending !== null) return;
    const current = readAudioSinkId(ctx);
    console.warn('[Engine] AudioContext reported an output device error', { sinkId: current });
    if (current !== DEFAULT_OUTPUT_DEVICE_ID) {
      void this.switchTo(ctx, DEFAULT_OUTPUT_DEVICE_ID, 'lost', this.nameOf(current));
    } else {
      this.report(ctx, 'The audio output device reported an error');
    }
  }

  /**
   * Devices came or went. The device we render to vanished → the default output; the saved device is
   * back → return to it. Only decidable when the browser lists device ids (Chromium: with permission).
   */
  private async handleDeviceChange(ctx: AudioContext): Promise<void> {
    if (ctx !== this.ctx || this.pending !== null || !this.env.supported) return;
    const list = await this.env.listOutputs();
    if (ctx !== this.ctx || this.pending !== null) return;
    if (list.hidden && list.devices.length === 0) return;
    const present = new Set(list.devices.map((d) => d.deviceId));
    for (const d of list.devices) if (!this.labels.has(d.deviceId)) this.labels.set(d.deviceId, d.label);
    const current = readAudioSinkId(ctx);
    const want = this.preferredId();
    if (current !== DEFAULT_OUTPUT_DEVICE_ID && current !== SILENT_SINK_ID && !present.has(current)) {
      await this.switchTo(ctx, DEFAULT_OUTPUT_DEVICE_ID, 'lost', this.nameOf(current));
      return;
    }
    if (want !== current && (want === DEFAULT_OUTPUT_DEVICE_ID || present.has(want))) {
      await this.switchTo(ctx, want, 'restore');
    }
  }
}
