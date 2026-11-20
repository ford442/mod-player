/**
 * MIDI out (#538): the player as a clock master and, opt-in, a note source for a DAW or a synth.
 *
 * A framework-free observer of the PlayerEngine, like `bindMediaSession`: it reads the engine, never
 * writes it, and changes nothing in `audio-worklet/`. React reaches it through `hooks/useMidiOut.ts`.
 *
 *   transport FSM edges ──► Start / Stop / Continue        (audio time of the edge → performance time)
 *   engine seeks ─────────► Stop · Song Position Pointer · Continue, at the landing
 *   position reports ─────► Timing Clock, 24 per beat, from libopenmpt's estimated BPM
 *   pattern rows ─────────► note-on / note-off per tracker channel (opt-in)
 *
 * Everything is stamped with a `performance.now()` time (`MIDIOutput.send(data, timestamp)`) derived
 * from the audio clock, and handed to the browser up to LOOKAHEAD_SEC early, from a 10 ms timer — an
 * `setInterval` on the main thread is not throttled while the page plays audio, so the clock keeps
 * running with the tab in the background. The position reports are drained by this timer too
 * (`PlayerEngine.pollPosition`): the UI loop that normally drains them stops with the tab.
 *
 * Two facts shape the design. Messages already handed to the browser cannot be recalled (`clear()` is
 * not implemented in Chromium), so a tempo change is followed within one lookahead window, and a seek
 * re-phases the pulse grid only after the pulses already sent. And the player only knows a position
 * ~16 ms at a time (the worklet reports at 60 Hz), so notes are placed at the middle of the interval a
 * row boundary was observed in — ±8 ms worst case — while the clock, free-running between anchors,
 * keeps its pulses regular to well under a millisecond.
 */
import type { PatternMatrix } from '../../types';
import type { EnginePositionPoll, EngineSeekEvent, PlayerSnapshot } from '../engine/PlayerEngine';
import { SnapshotStore } from '../engine/store';
import type { TransportPhase, TransportTransition } from '../engine/transport';
import { resolveAudioHeardTime } from '../../utils/playheadPrediction';
import {
  DEFAULT_MIDI_OUT_SETTINGS,
  describeMidiAccessError,
  isWebMidiOutSupported,
  queryMidiPermission,
  readStoredMidiOutSettings,
  requestMidiOutAccess,
  writeStoredMidiOutSettings,
  type MidiChannelMode,
  type MidiOutSettings,
  type MidiPermission,
} from '../../utils/midiOut';
import { AudioPerfClock } from './audioPerfClock';
import {
  allNotesOffBytes,
  CLOCK_BYTES,
  CONTINUE_BYTES,
  songPositionBytes,
  START_BYTES,
  STOP_BYTES,
  type MidiBytes,
} from './midiMessages';
import { NoteOutPlanner } from './noteOutPlanner';
import { PulseGrid } from './pulseGrid';

/**
 * How often the scheduler runs. It must be shorter than the worklet's report interval (~16.7 ms):
 * `pollPosition` hands over only the newest report, so a slower timer would skip reports and widen the
 * interval a row boundary is placed in (note-out places a row at the middle of that interval).
 */
export const MIDI_TICK_MS = 10;
/** How far ahead of the heard time messages are handed to the browser. */
export const MIDI_LOOKAHEAD_SEC = 0.1;
/** Gap between consecutive transport bytes before the first pulse of a (re)start (ms). */
export const MIDI_TRANSPORT_LEAD_MS = 1;
/** A position that steps back by more than this without a seek is the song wrapping or jumping back. */
export const MIDI_DISCONTINUITY_SEC = 0.25;
/** A seek whose landing the engine never acknowledges is accepted on the next fresh report after this. */
export const MIDI_SEEK_LAND_TIMEOUT_SEC = 0.6;
/** Arming without a position report for this long (the ScriptProcessor fallback has none) free-runs. */
export const MIDI_ARM_FALLBACK_MS = 500;
/** Rows a single report may have advanced before they are treated as a jump instead of a catch-up. */
export const MIDI_MAX_CATCHUP_ROWS = 4;
const STATS_PUBLISH_MS = 500;

export interface MidiOutPortInfo {
  readonly id: string;
  readonly name: string;
}

export type MidiAccessStatus = 'unsupported' | 'idle' | 'requesting' | 'granted' | 'denied';

export interface MidiOutStats {
  /** Timing Clock pulses handed to the browser. */
  readonly pulses: number;
  /** Messages whose time had already passed when they were sent (the main thread stalled). */
  readonly late: number;
  /** Pulses dropped because they were more than one interval late; the beat phase is kept. */
  readonly skipped: number;
  /** Note-ons sent. */
  readonly notes: number;
}

/** What the UI reads. */
export interface MidiOutState {
  readonly supported: boolean;
  readonly access: MidiAccessStatus;
  /** Connected outputs, as the browser lists them. */
  readonly outputs: readonly MidiOutPortInfo[];
  readonly settings: MidiOutSettings;
  /** The chosen output is present and being driven. */
  readonly connected: boolean;
  readonly error: string | null;
  readonly stats: MidiOutStats;
}

/** The part of PlayerEngine this reads. */
export interface MidiOutEngine {
  readonly transport: {
    readonly phase: TransportPhase;
    readonly isPlaying: boolean;
    readonly isPaused: boolean;
    subscribe(listener: (transition: TransportTransition) => void): () => void;
  };
  getAudioContext(): AudioContext | null;
  pollPosition(): EnginePositionPoll;
  getPatternMatrix(order: number): PatternMatrix | null;
  isChannelMuted(channel: number): boolean;
  stepOfOrder(order: number): number;
  onSeek(listener: (event: EngineSeekEvent) => void): () => void;
  getSnapshot(): Pick<PlayerSnapshot, 'moduleInfo'>;
}

/** The browser, as the controller sees it; tests substitute each piece. */
export interface MidiOutEnv {
  supported: boolean;
  requestAccess(): Promise<MIDIAccess>;
  queryPermission(): Promise<MidiPermission>;
  storage: { read(): MidiOutSettings; write(settings: MidiOutSettings): void };
  /** `performance.now()`. */
  now(): number;
  /** The audio-clock time at the speakers at `perfNowMs`. */
  heardTime(ctx: AudioContext, perfNowMs: number): number;
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export function browserMidiOutEnv(): MidiOutEnv {
  return {
    supported: isWebMidiOutSupported(),
    requestAccess: requestMidiOutAccess,
    queryPermission: queryMidiPermission,
    storage: { read: readStoredMidiOutSettings, write: writeStoredMidiOutSettings },
    now: () => performance.now(),
    heardTime: (ctx, perfNowMs) => resolveAudioHeardTime(ctx, perfNowMs).time,
    setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
    clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
  };
}

type Mode =
  /** No transport to follow (stopped, nothing loaded), or no port. */
  | 'idle'
  /** The engine reported it is rendering; waiting for the first position report to anchor on. */
  | 'arming'
  /** Following the song. */
  | 'running'
  /** Paused: silent, the position kept. */
  | 'paused';

interface Clock {
  perf: number;
  /** Audio-clock time at the speakers right now. */
  heard: number;
  /** `ctx.currentTime`: the audio time rendering has reached (where a pause or stop takes effect). */
  ctxNow: number;
}

interface PositionView {
  order: number;
  row: number;
  rowFraction: number;
  positionSeconds: number;
  time: number;
  bpm: number;
  speed: number;
  rowsPerSecond: number;
}

export class MidiOutController {
  private readonly store: SnapshotStore<MidiOutState>;
  readonly getSnapshot = (): MidiOutState => this.store.getSnapshot();
  readonly subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener);

  private access: MIDIAccess | null = null;
  private port: MIDIOutput | null = null;
  private timer: unknown = null;
  private disposed = false;

  private readonly perfClock = new AudioPerfClock();
  private readonly grid = new PulseGrid();
  private readonly planner: NoteOutPlanner;
  private readonly offs: Array<() => void> = [];

  private mode: Mode = 'idle';
  /** The song was anchored (a Start / Continue went out, or the clock is off) in the current play. */
  private anchored = false;
  /** Seconds from the pause to the next pulse, so the resume continues the beat; null = no grid then. */
  private heldRemaining: number | null = null;
  /** Position reports older than this (audio time) describe something that no longer plays. */
  private gateCtx = 0;
  private armedAtPerf = 0;
  private relocate: { atCtx: number } | null = null;
  private lastSampleTime = -1;
  private lastPositionSeconds = -1;
  private lastRow: { order: number; row: number } | null = null;
  private lastBpm = 125;
  private heardAnySample = false;

  private pulses = 0;
  private late = 0;
  private skipped = 0;
  private notes = 0;
  private lastStatsPublish = 0;

  constructor(
    private readonly engine: MidiOutEngine,
    private readonly env: MidiOutEnv = browserMidiOutEnv(),
  ) {
    const settings = env.supported ? env.storage.read() : { ...DEFAULT_MIDI_OUT_SETTINGS };
    this.planner = new NoteOutPlanner(this.channelMapper(settings));
    this.store = new SnapshotStore<MidiOutState>({
      supported: env.supported,
      access: env.supported ? 'idle' : 'unsupported',
      outputs: [],
      settings,
      connected: false,
      error: null,
      stats: { pulses: 0, late: 0, skipped: 0, notes: 0 },
    });
    if (!env.supported) return;
    this.offs.push(engine.transport.subscribe((t) => this.onTransition(t)));
    this.offs.push(engine.onSeek((e) => this.onSeek(e)));
  }

  // ── setup ──────────────────────────────────────────────────────────────────────────────────────

  /**
   * Reopen the saved output on load — only when the browser already granted MIDI (a restore must not
   * raise a permission prompt nobody asked for).
   */
  async restore(): Promise<void> {
    const { supported, settings } = this.store.getSnapshot();
    if (!supported || !settings.outputId || this.access) return;
    if ((await this.env.queryPermission()) !== 'granted') return;
    if (this.disposed || this.access) return;
    await this.enableAccess();
  }

  /** Ask for MIDI access (call from a click). Resolves true when granted. */
  async enableAccess(): Promise<boolean> {
    if (!this.env.supported) return false;
    if (this.access) return true;
    this.store.patch({ access: 'requesting', error: null });
    try {
      const access = await this.env.requestAccess();
      if (this.disposed) return false;
      this.access = access;
      access.onstatechange = () => this.syncPorts();
      this.store.patch({ access: 'granted' });
      this.syncPorts();
      return true;
    } catch (err) {
      this.store.patch({ access: 'denied', error: describeMidiAccessError(err) });
      return false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopTimer();
    for (const off of this.offs.splice(0)) off();
    this.quiesce(this.port, false);
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.port = null;
  }

  // ── settings (the UI's verbs) ──────────────────────────────────────────────────────────────────

  /** Choose the output (null = none). Saved; takes effect at once, mid-song included. */
  selectOutput(id: string | null): void {
    const name = id ? this.store.getSnapshot().outputs.find((o) => o.id === id)?.name ?? '' : '';
    this.updateSettings({ outputId: id, outputName: name });
    this.syncPorts();
  }

  setClockEnabled(enabled: boolean): void {
    const was = this.store.getSnapshot().settings.clock;
    if (enabled === was) return;
    if (!enabled && this.port && this.anchored && this.mode !== 'idle') this.sendNow(STOP_BYTES);
    if (!enabled) this.grid.stop();
    this.updateSettings({ clock: enabled });
    if (enabled) this.resyncPort();
  }

  setNoteOutEnabled(enabled: boolean): void {
    if (enabled === this.store.getSnapshot().settings.noteOut) return;
    if (!enabled) this.releaseNotesNow();
    this.updateSettings({ noteOut: enabled });
    if (enabled) this.lastRow = null;
  }

  setChannelMode(mode: MidiChannelMode): void {
    this.releaseNotesNow();
    this.updateSettings({ channelMode: mode });
  }

  setSingleChannel(channel: number): void {
    this.releaseNotesNow();
    this.updateSettings({ singleChannel: Math.min(16, Math.max(1, Math.round(channel))) });
  }

  private updateSettings(patch: Partial<MidiOutSettings>): void {
    const settings = { ...this.store.getSnapshot().settings, ...patch };
    this.env.storage.write(settings);
    this.planner.setChannelMap(this.channelMapper(settings));
    this.store.patch({ settings });
    this.ensureTimer();
  }

  private channelMapper(settings: MidiOutSettings): (trackerChannel: number) => number {
    return settings.channelMode === 'single'
      ? () => settings.singleChannel - 1
      : (trackerChannel) => trackerChannel % 16;
  }

  // ── ports ──────────────────────────────────────────────────────────────────────────────────────

  private syncPorts(): void {
    const access = this.access;
    if (!access || this.disposed) return;
    const outputs: MidiOutPortInfo[] = [];
    for (const out of access.outputs.values()) {
      if (out.state === 'connected') outputs.push({ id: out.id, name: out.name || 'MIDI output' });
    }
    const { settings } = this.store.getSnapshot();
    const wanted = settings.outputId ? access.outputs.get(settings.outputId) ?? null : null;
    const next = wanted && wanted.state === 'connected' ? wanted : null;
    if (next !== this.port) {
      this.quiesce(this.port, true);
      this.port = next;
      if (next) {
        next.open().catch(() => { /* send() opens implicitly; a real failure surfaces there */ });
        this.resyncPort();
      }
    }
    const name = next?.name || settings.outputName;
    this.store.patch({ outputs, connected: next !== null, error: null });
    if (next && name && name !== settings.outputName) this.updateSettings({ outputName: name });
    this.ensureTimer();
  }

  /**
   * A port (re)appeared, or the clock was switched on, mid-song: bring the receiver to where the song
   * is — Stop, Song Position, Continue at the next landing — or, when paused, note the song is held.
   */
  private resyncPort(): void {
    const t = this.engine.transport;
    const clk = this.readClock();
    if (t.isPlaying) {
      if (this.mode === 'idle' || this.mode === 'paused') this.mode = 'running';
      this.anchored = true;
      this.relocate = { atCtx: clk?.ctxNow ?? 0 };
      this.gateCtx = clk?.ctxNow ?? 0;
    } else if (t.isPaused && this.mode === 'idle') {
      this.mode = 'paused';
      this.anchored = false;
      this.heldRemaining = null;
    }
  }

  /** Silence a port: a Stop if the receiver was running, every held note off. Immediate. */
  private quiesce(port: MIDIOutput | null, keepMode: boolean): void {
    if (port) {
      const bytes: MidiBytes[] = [];
      if (this.anchored && this.mode === 'running' && this.store.getSnapshot().settings.clock) bytes.push(STOP_BYTES);
      bytes.push(...this.planner.releaseAll());
      for (const b of bytes) this.rawSend(port, b, undefined);
    } else {
      this.planner.releaseAll();
    }
    this.grid.stop();
    if (!keepMode) this.mode = 'idle';
  }

  // ── timer ──────────────────────────────────────────────────────────────────────────────────────

  private ensureTimer(): void {
    const { settings } = this.store.getSnapshot();
    const wanted = this.port !== null && (settings.clock || settings.noteOut) && !this.disposed;
    if (wanted && this.timer === null) this.timer = this.env.setInterval(() => this.tick(), MIDI_TICK_MS);
    else if (!wanted && this.timer !== null) this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timer !== null) this.env.clearInterval(this.timer);
    this.timer = null;
  }

  // ── transport edges ────────────────────────────────────────────────────────────────────────────

  private onTransition(t: TransportTransition): void {
    switch (t.event) {
      case 'started':
        this.arm();
        break;
      case 'resume':
        this.resume();
        break;
      case 'pause':
        this.pause();
        break;
      case 'fault':
        // A fault under a pause is repaired in the background; the transport stays paused.
        if (t.from !== 'paused') this.halt();
        break;
      case 'stop':
      case 'load':
      case 'loadFailed':
      case 'startFailed':
        this.halt();
        break;
      default:
        break;
    }
  }

  /** The engine is rendering from the song's start (or a cued / sought position): anchor on the first report. */
  private arm(): void {
    const clk = this.readClock();
    this.releaseNotesNow();
    this.grid.stop();
    this.mode = 'arming';
    this.anchored = false;
    this.heldRemaining = null;
    this.relocate = null;
    this.gateCtx = clk?.ctxNow ?? 0;
    this.armedAtPerf = this.env.now();
    this.resetTracking();
  }

  private resume(): void {
    if (this.mode !== 'paused' || !this.anchored) {
      this.arm();
      return;
    }
    const clk = this.readClock();
    this.mode = 'running';
    this.relocate = null;
    this.gateCtx = clk?.ctxNow ?? 0;
    this.resetTracking();
    const { settings } = this.store.getSnapshot();
    if (!clk || !this.port || !settings.clock || this.heldRemaining === null) return;
    this.grid.setBpm(this.lastBpm);
    const first = this.grid.anchor(clk.ctxNow + this.heldRemaining);
    this.sendTransport([CONTINUE_BYTES], first);
  }

  private pause(): void {
    const clk = this.readClock();
    const { settings } = this.store.getSnapshot();
    if (this.mode === 'running' && this.port && clk) {
      this.heldRemaining = settings.clock ? this.grid.untilNextPulse(clk.ctxNow) : null;
      if (settings.clock && this.anchored) this.sendAt(STOP_BYTES, clk.ctxNow, clk.perf);
      this.releaseNotesAt(clk.ctxNow, clk.perf);
    }
    this.grid.stop();
    // A pause while still arming has nothing to hold: resume() arms again.
    this.mode = this.mode === 'idle' ? 'idle' : 'paused';
    if (this.mode === 'paused' && !this.anchored) this.heldRemaining = null;
  }

  /** Stopped, unloaded or faulted: tell the receiver, drop everything. */
  private halt(): void {
    const clk = this.readClock();
    const { settings } = this.store.getSnapshot();
    if (this.port && clk) {
      if (this.mode === 'running' && this.anchored && settings.clock) this.sendAt(STOP_BYTES, clk.ctxNow, clk.perf);
      this.releaseNotesAt(clk.ctxNow, clk.perf);
    }
    this.grid.reset();
    this.mode = 'idle';
    this.anchored = false;
    this.heldRemaining = null;
    this.relocate = null;
    this.resetTracking();
  }

  private onSeek(event: EngineSeekEvent): void {
    const clk = this.readClock();
    const { settings } = this.store.getSnapshot();
    switch (this.mode) {
      case 'arming':
        // Only reports from after the seek count.
        this.gateCtx = clk?.ctxNow ?? this.gateCtx;
        break;
      case 'running':
        this.releaseNotesNow();
        this.relocate = { atCtx: clk?.ctxNow ?? 0 };
        this.gateCtx = clk?.ctxNow ?? this.gateCtx;
        this.resetTracking();
        break;
      case 'paused':
        // The receiver is stopped: just move its position; Continue follows on resume.
        if (this.port && settings.clock && this.anchored) this.sendNow(songPositionBytes(event.step));
        break;
      case 'idle':
        break;
    }
  }

  private resetTracking(): void {
    this.lastSampleTime = -1;
    this.lastPositionSeconds = -1;
    this.lastRow = null;
    this.heardAnySample = false;
  }

  // ── the scheduler ──────────────────────────────────────────────────────────────────────────────

  /** One scheduler pass. Public for tests, which drive it with a fake clock. */
  tick(): void {
    if (!this.port) return;
    const clk = this.readClock();
    if (!clk) return;
    // Keep the audio → performance offset averaged even while idle: it must be settled at a play.
    this.perfClock.observe(clk.heard, clk.perf);
    if (this.mode === 'arming' || this.mode === 'running') this.followEngine(clk);
    if (this.mode === 'running') this.pumpPulses(clk);
    this.publishStats(clk.perf);
  }

  private followEngine(clk: Clock): void {
    const poll = this.engine.pollPosition();
    const view = this.freshPosition(poll);
    if (view) {
      this.heardAnySample = true;
      this.onPosition(view, poll, clk);
    } else if (this.mode === 'arming' && !this.heardAnySample) {
      this.armFallback(clk);
    } else if (this.mode === 'running' && !this.heardAnySample && this.engine.transport.phase === 'spFallback') {
      this.grid.setBpm(this.engine.getSnapshot().moduleInfo.bpm);
    }
  }

  /** The report if it is new and describes the playback being followed; copied out of the reused object. */
  private freshPosition(poll: EnginePositionPoll): PositionView | null {
    const s = poll.sample;
    if (!s) return null;
    if (s.workletTime === this.lastSampleTime) return null;
    if (s.workletTime < this.gateCtx - 0.001) return null;
    return {
      order: s.order,
      row: s.rowInt,
      rowFraction: s.row - s.rowInt,
      positionSeconds: s.positionSeconds,
      time: s.workletTime,
      bpm: s.bpm,
      speed: s.speed,
      rowsPerSecond: poll.rowsPerSecond,
    };
  }

  private onPosition(p: PositionView, poll: EnginePositionPoll, clk: Clock): void {
    const wrapped = this.lastPositionSeconds >= 0 && p.positionSeconds < this.lastPositionSeconds - MIDI_DISCONTINUITY_SEC;
    if (this.mode === 'arming') {
      if (poll.seekPending && clk.ctxNow - this.gateCtx < MIDI_SEEK_LAND_TIMEOUT_SEC) return;
      this.land(p, 'start');
    } else if (this.relocate) {
      if (poll.seekPending && clk.ctxNow - this.relocate.atCtx < MIDI_SEEK_LAND_TIMEOUT_SEC) return;
      this.land(p, 'relocate');
    } else if (wrapped) {
      // The song restarted or jumped back with no seek: a loop. The receiver has to go back too.
      this.releaseNotesNow();
      this.land(p, 'relocate');
    } else {
      this.grid.setBpm(p.bpm);
      this.lastBpm = p.bpm;
      this.followRows(p);
    }
    this.lastSampleTime = p.time;
    this.lastPositionSeconds = p.positionSeconds;
  }

  /**
   * The first report of a play, or of a position the receiver has to be moved to. Anchors the pulse
   * grid on the row start and sends the transport bytes just ahead of the first pulse.
   */
  private land(p: PositionView, kind: 'start' | 'relocate'): void {
    const { settings } = this.store.getSnapshot();
    const step = this.engine.stepOfOrder(p.order) + p.row;
    const rowStart = p.time - this.rowOffsetSec(p);
    const atSongStart = kind === 'start' && step === 0 && p.positionSeconds < 1;
    this.lastBpm = p.bpm;
    if (settings.clock && this.port) {
      this.grid.setBpm(p.bpm);
      const first = this.grid.anchor(atSongStart ? p.time - p.positionSeconds : rowStart);
      const messages: MidiBytes[] = atSongStart
        ? [START_BYTES]
        : kind === 'relocate'
          ? [STOP_BYTES, songPositionBytes(step), CONTINUE_BYTES]
          : [songPositionBytes(step), CONTINUE_BYTES];
      this.sendTransport(messages, first);
    }
    this.mode = 'running';
    this.anchored = true;
    this.relocate = null;
    this.lastRow = { order: p.order, row: p.row };
    this.lastSampleTime = p.time;
    this.dispatchRow(p.order, p.row, rowStart, p);
  }

  /** Seconds into the row a report was taken at (its fraction counts from the report that saw the row). */
  private rowOffsetSec(p: PositionView): number {
    return p.rowsPerSecond > 0 ? p.rowFraction / p.rowsPerSecond : 0;
  }

  /** Note-out: the rows that began since the previous report. */
  private followRows(p: PositionView): void {
    const prev = this.lastRow;
    if (!prev) {
      this.lastRow = { order: p.order, row: p.row };
      this.dispatchRow(p.order, p.row, p.time - this.rowOffsetSec(p), p);
      return;
    }
    if (p.order === prev.order && p.row === prev.row) return;
    const advanced = p.row - prev.row;
    const prevTime = this.lastSampleTime;
    if (p.order === prev.order && advanced >= 1 && advanced <= MIDI_MAX_CATCHUP_ROWS && prevTime >= 0) {
      // Rows began somewhere between the two reports: spread them evenly, each at the middle of its share.
      for (let j = 1; j <= advanced; j++) {
        const at = prevTime + ((p.time - prevTime) * (j - 0.5)) / advanced;
        this.dispatchRow(p.order, prev.row + j, at, p);
      }
    } else {
      // A new order, a jump, a loop: the row that is playing now began about half a report ago.
      const at = prevTime >= 0 ? (prevTime + p.time) / 2 : p.time;
      this.dispatchRow(p.order, p.row, at, p);
    }
    this.lastRow = { order: p.order, row: p.row };
  }

  private dispatchRow(order: number, row: number, startSec: number, p: PositionView): void {
    const { settings } = this.store.getSnapshot();
    if (!settings.noteOut || !this.port) return;
    const cells = this.engine.getPatternMatrix(order)?.rows[row];
    if (!cells) return;
    const rowSec = p.rowsPerSecond > 0 ? 1 / p.rowsPerSecond : 0;
    const tickSec = rowSec / Math.max(1, p.speed);
    const perf = this.env.now();
    for (const m of this.planner.planRow(cells, { tickSec, ticksPerRow: Math.max(1, p.speed) }, (c) => this.engine.isChannelMuted(c))) {
      if ((m.bytes[0] ?? 0) >= 0x90 && (m.bytes[0] ?? 0) < 0xa0) this.notes += 1;
      this.sendAt(m.bytes, startSec + m.atSec, perf);
    }
  }

  private pumpPulses(clk: Clock): void {
    const { settings } = this.store.getSnapshot();
    if (!settings.clock || !this.grid.running) return;
    const result = this.grid.advance(clk.heard + MIDI_LOOKAHEAD_SEC, clk.heard - this.grid.intervalSec, (at) => {
      this.pulses += 1;
      this.sendAt(CLOCK_BYTES, at, clk.perf);
    });
    this.skipped += result.skipped;
  }

  /** Arming for a while with no report at all (ScriptProcessor fallback): free-run from now. */
  private armFallback(clk: Clock): void {
    if (this.engine.transport.phase !== 'spFallback') return;
    if (clk.perf - this.armedAtPerf < MIDI_ARM_FALLBACK_MS) return;
    const { settings } = this.store.getSnapshot();
    const bpm = this.engine.getSnapshot().moduleInfo.bpm;
    this.lastBpm = bpm;
    if (settings.clock && this.port) {
      this.grid.setBpm(bpm);
      const first = this.grid.anchor(clk.heard + MIDI_LOOKAHEAD_SEC / 2);
      this.sendTransport([START_BYTES], first);
    }
    this.mode = 'running';
    this.anchored = true;
  }

  // ── sending ────────────────────────────────────────────────────────────────────────────────────

  private readClock(): Clock | null {
    const ctx = this.engine.getAudioContext();
    if (!ctx || ctx.state === 'closed') return null;
    const perf = this.env.now();
    return { perf, heard: this.env.heardTime(ctx, perf), ctxNow: ctx.currentTime };
  }

  /** The transport bytes, 1 ms apart, ending just before `firstPulseSec`. */
  private sendTransport(messages: readonly MidiBytes[], firstPulseSec: number): void {
    const port = this.port;
    if (!port) return;
    const perf = this.env.now();
    const base = this.perfClock.toPerformanceMs(firstPulseSec);
    messages.forEach((bytes, i) => {
      const lead = (messages.length - i) * MIDI_TRANSPORT_LEAD_MS;
      this.rawSend(port, bytes, base === null ? undefined : this.clampPast(base - lead, perf));
    });
  }

  /** Send `bytes` for the audio-clock instant `audioSec`. */
  private sendAt(bytes: MidiBytes, audioSec: number, perfNow: number): void {
    const port = this.port;
    if (!port) return;
    const at = this.perfClock.toPerformanceMs(audioSec);
    this.rawSend(port, bytes, at === null ? undefined : this.clampPast(at, perfNow));
  }

  private sendNow(bytes: MidiBytes): void {
    if (this.port) this.rawSend(this.port, bytes, undefined);
  }

  /** A time already gone goes out at once; one that is gone by more than a few ms is counted as late. */
  private clampPast(at: number, perfNow: number): number {
    if (at >= perfNow) return at;
    if (perfNow - at > 2) this.late += 1;
    return perfNow;
  }

  private rawSend(port: MIDIOutput, bytes: MidiBytes, timestamp: number | undefined): void {
    try {
      if (timestamp === undefined) port.send(bytes as number[]);
      else port.send(bytes as number[], timestamp);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.store.patch({ error: `MIDI output error: ${detail}` });
    }
  }

  private releaseNotesNow(): void {
    const port = this.port;
    for (const bytes of this.planner.releaseAll()) if (port) this.rawSend(port, bytes, undefined);
  }

  private releaseNotesAt(ctxNow: number, perf: number): void {
    for (const bytes of this.planner.releaseAll()) this.sendAt(bytes, ctxNow, perf);
  }

  /** A belt for a stuck receiver: All Notes Off on every channel notes were sent on. */
  panic(): void {
    const port = this.port;
    if (!port) return;
    for (let ch = 0; ch < 16; ch++) this.rawSend(port, allNotesOffBytes(ch), undefined);
  }

  private publishStats(perf: number): void {
    if (perf - this.lastStatsPublish < STATS_PUBLISH_MS) return;
    this.lastStatsPublish = perf;
    const prev = this.store.getSnapshot().stats;
    if (
      prev.pulses === this.pulses && prev.late === this.late &&
      prev.skipped === this.skipped && prev.notes === this.notes
    ) return;
    this.store.patch({ stats: { pulses: this.pulses, late: this.late, skipped: this.skipped, notes: this.notes } });
  }
}

/** One controller per engine (a page has one engine; tests make their own). */
const controllers = new WeakMap<object, MidiOutController>();

export function getMidiOutController(engine: MidiOutEngine & object): MidiOutController {
  let controller = controllers.get(engine);
  if (!controller) {
    controller = new MidiOutController(engine);
    controllers.set(engine, controller);
  }
  return controller;
}
