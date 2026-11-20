/**
 * #538 MIDI out — the controller against a simulated engine.
 *
 * A fake worklet renders a song on a virtual audio clock, 40 ms ahead of what is heard, and reports
 * its position every ~16.7 ms like the real one. The "heard" time handed to the controller carries
 * ±3 ms of timestamp noise. A fake MIDI port records every `send(data, timestamp)`; the assertions
 * compare those timestamps with where the messages ought to fall on the performance clock.
 *
 * What this cannot show is a real DAW on the other end: Chromium's own send scheduling and the OS MIDI
 * driver add their jitter on top of what is measured here (docs/MIDI_CONTROLS.md says so).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MidiOutController,
  MIDI_LOOKAHEAD_SEC,
  MIDI_TICK_MS,
  type MidiOutEngine,
  type MidiOutEnv,
} from '../../audio/midi/midiOutController';
import type { EnginePositionPoll, EngineSeekEvent } from '../../audio/engine/PlayerEngine';
import type { TransportEvent, TransportPhase, TransportTransition } from '../../audio/engine/transport';
import type { PatternCell, PatternMatrix } from '../../types';
import { DEFAULT_MIDI_OUT_SETTINGS, type MidiOutSettings } from '../../utils/midiOut';

/** Audio time at the speakers = performance seconds + this. */
const OFFSET_SEC = 1000;
/** The worklet renders this far ahead of what is heard. */
const LATENCY_SEC = 0.04;
/** The worklet reports about every 16.7 ms; the 1 ms virtual-time step rounds that to 17. */
const REPORT_MS = 17;
const ROWS_PER_ORDER = 64;
const CLOCK = 0xf8;
const START = 0xfa;
const CONTINUE = 0xfb;
const STOP = 0xfc;
const SPP = 0xf2;

interface Sent {
  data: number[];
  /** `undefined` = no timestamp (sent immediately). */
  ts: number | undefined;
  /** Virtual time of the send() call. */
  at: number;
}

/** Deterministic noise in [-1, 1). */
function makeNoise(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0x100000000) * 2 - 1;
  };
}

const note = (n: number): PatternCell => ({ type: 'note', text: '', note: n });

function makeMatrix(order: number, notes: Record<number, PatternCell[]>): PatternMatrix {
  const rows: PatternCell[][] = [];
  for (let r = 0; r < ROWS_PER_ORDER; r++) rows.push(notes[r] ?? [{ type: 'empty', text: '' }]);
  return { order, patternIndex: order, numRows: ROWS_PER_ORDER, numChannels: 1, rows };
}

class FakePort {
  state: 'connected' | 'disconnected' = 'connected';
  readonly sent: Sent[] = [];
  constructor(readonly id: string, readonly name: string, private readonly sim: Sim) {}
  open(): Promise<FakePort> {
    return Promise.resolve(this);
  }
  send(data: number[], ts?: number): void {
    this.sent.push({ data: [...data], ts, at: this.sim.perf });
  }
  /** Messages with status byte `status`. */
  byStatus(status: number): Sent[] {
    return this.sent.filter((m) => m.data[0] === status);
  }
}

class Sim {
  perf = 5000;
  phase: TransportPhase = 'ready';
  muted = new Set<number>();
  bpm = 125;
  speed = 6;
  /** Song state, advanced by `report()`. */
  playing = false;
  rowFloat = 0;
  posSec = 0;
  private lastRender = 0;
  private lastReport = 0;
  private seekTarget: number | null = null;
  sample: EnginePositionPoll['sample'] = null;
  seekPending = false;
  /** Audio time the song's row 0 began rendering (set by play()). */
  songStart = 0;
  matrices: PatternMatrix[] = [makeMatrix(0, {}), makeMatrix(1, {})];
  readonly noise = makeNoise(11);
  noisy = true;

  readonly transportListeners = new Set<(t: TransportTransition) => void>();
  readonly seekListeners = new Set<(e: EngineSeekEvent) => void>();
  readonly ports = new Map<string, FakePort>();
  access = { outputs: this.ports, onstatechange: null as null | (() => void) };
  settingsStore: MidiOutSettings = { ...DEFAULT_MIDI_OUT_SETTINGS };
  intervalHandler: (() => void) | null = null;
  cleared = 0;
  supported = true;
  accessError: Error | null = null;
  permission: 'granted' | 'prompt' | 'denied' | 'unknown' = 'prompt';

  get rowsPerSecond(): number {
    return (this.bpm / 60) * 4;
  }
  get renderTime(): number {
    return this.perf / 1000 + OFFSET_SEC + LATENCY_SEC;
  }
  /** Audio time at the speakers at virtual time `perfMs`. */
  heardAt(perfMs: number): number {
    return perfMs / 1000 + OFFSET_SEC;
  }
  /** Where an event at audio time `t` is heard on the performance clock (ms). */
  perfOf(t: number): number {
    return (t - OFFSET_SEC) * 1000;
  }

  readonly ctx = { state: 'running' as const, get currentTime() { return 0; } };

  readonly engine: MidiOutEngine;
  readonly env: MidiOutEnv;

  constructor() {
    Object.defineProperty(this.ctx, 'currentTime', { get: () => this.renderTime });
    const phase = () => this.phase;
    const listeners = this.transportListeners;
    this.engine = {
      transport: {
        get phase() { return phase(); },
        get isPlaying() { return phase() === 'playing' || phase() === 'spFallback'; },
        get isPaused() { return phase() === 'paused'; },
        subscribe(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
      },
      getAudioContext: () => this.ctx as unknown as AudioContext,
      pollPosition: () => ({ sample: this.sample, rowsPerSecond: this.rowsPerSecond, seekPending: this.seekPending }),
      getPatternMatrix: (order) => this.matrices[order] ?? null,
      isChannelMuted: (c) => this.muted.has(c),
      stepOfOrder: (order) => order * ROWS_PER_ORDER,
      onSeek: (listener) => {
        this.seekListeners.add(listener);
        return () => { this.seekListeners.delete(listener); };
      },
      getSnapshot: () => ({ moduleInfo: { title: 't', order: 0, row: 0, bpm: this.bpm, numChannels: 1 } }),
    };
    this.env = {
      supported: true,
      requestAccess: () => (this.accessError ? Promise.reject(this.accessError) : Promise.resolve(this.access as unknown as MIDIAccess)),
      queryPermission: () => Promise.resolve(this.permission),
      storage: {
        read: () => ({ ...this.settingsStore }),
        write: (s) => { this.settingsStore = { ...s }; },
      },
      now: () => this.perf,
      heardTime: (_ctx, perfMs) => this.heardAt(perfMs) + (this.noisy ? this.noise() * 0.003 : 0),
      setInterval: (handler) => { this.intervalHandler = handler; return 1; },
      clearInterval: () => { this.intervalHandler = null; this.cleared += 1; },
    };
  }

  addPort(id: string, name = id): FakePort {
    const port = new FakePort(id, name, this);
    this.ports.set(id, port);
    return port;
  }

  fire(event: TransportEvent, to: TransportPhase): void {
    const from = this.phase;
    this.phase = to;
    for (const l of [...this.transportListeners]) l({ event, from, to });
  }

  /** The worklet acks `loaded`: it renders from row 0 now. */
  play(): void {
    this.playing = true;
    this.rowFloat = 0;
    this.posSec = 0;
    this.lastRender = this.renderTime;
    this.lastReport = this.perf;
    this.songStart = this.renderTime;
    this.sample = null;
    this.fire('started', 'playing');
  }

  pause(): void {
    this.accumulate();
    this.playing = false;
    this.fire('pause', 'paused');
  }

  resume(): void {
    this.playing = true;
    this.lastRender = this.renderTime;
    this.fire('resume', 'playing');
  }

  stop(): void {
    this.playing = false;
    this.sample = null;
    this.fire('stop', 'stopped');
  }

  seek(step: number): void {
    if (this.playing) this.accumulate();
    this.rowFloat = step;
    this.posSec = step / this.rowsPerSecond;
    this.lastRender = this.renderTime;
    this.seekTarget = step;
    this.seekPending = true;
    const order = Math.floor(step / ROWS_PER_ORDER);
    const event = { step, order, row: step - order * ROWS_PER_ORDER };
    for (const l of [...this.seekListeners]) l(event);
  }

  private accumulate(): void {
    const t = this.renderTime;
    const dt = t - this.lastRender;
    this.posSec += dt;
    this.rowFloat += dt * this.rowsPerSecond;
    this.lastRender = t;
  }

  /** The worklet's ~60 Hz report, when due. */
  private report(): void {
    if (!this.playing || this.perf - this.lastReport < REPORT_MS - 1e-9) return;
    this.lastReport = this.perf;
    this.accumulate();
    const global = this.rowFloat;
    const order = Math.floor(global / ROWS_PER_ORDER);
    const within = global - order * ROWS_PER_ORDER;
    this.sample = {
      order,
      row: within,
      rowInt: Math.floor(within),
      positionSeconds: this.posSec,
      workletTime: this.lastRender,
      bpm: this.bpm,
      speed: this.speed,
    };
    if (this.seekTarget !== null) {
      this.seekPending = false;
      this.seekTarget = null;
    }
  }

  private nextTick = 0;

  /** Run `ms` of virtual time in 1 ms steps: the worklet reports every REPORT_MS, the controller's timer ticks every MIDI_TICK_MS. */
  run(ms: number, controller: MidiOutController): void {
    const end = this.perf + ms;
    if (this.nextTick === 0) this.nextTick = this.perf + MIDI_TICK_MS;
    while (this.perf < end - 1e-9) {
      this.perf += Math.min(1, end - this.perf);
      this.report();
      if (this.perf >= this.nextTick - 1e-9) {
        this.nextTick += MIDI_TICK_MS;
        if (this.intervalHandler) controller.tick();
      }
    }
  }
}

async function setup(options: { settings?: Partial<MidiOutSettings>; ports?: string[] } = {}) {
  const sim = new Sim();
  sim.settingsStore = { ...DEFAULT_MIDI_OUT_SETTINGS, ...options.settings };
  const ports = (options.ports ?? ['out']).map((id) => sim.addPort(id, `Port ${id}`));
  const controller = new MidiOutController(sim.engine, sim.env);
  await controller.enableAccess();
  controller.selectOutput(ports[0]!.id);
  return { sim, controller, port: ports[0]!, ports };
}

/** Clock pulses as audio times, via the port's performance timestamps. */
const clockTimes = (port: FakePort) => port.byStatus(CLOCK).map((m) => m.ts!);

describe('MidiOutController', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  describe('the clock', () => {
    it('keeps every pulse within ±1 ms of the 125 BPM grid, with ±3 ms of timestamp noise', async () => {
      const { sim, controller, port } = await setup();
      sim.run(1000, controller); // idle: the time map settles before a play, as it does on a real page
      sim.play();
      sim.run(6000, controller);

      const times = clockTimes(port);
      expect(times.length).toBeGreaterThan(280);
      // Pulse k belongs at song start + k × 20 ms.
      const first = sim.perfOf(sim.songStart);
      let worst = 0;
      times.forEach((ts, k) => { worst = Math.max(worst, Math.abs(ts - (first + k * 20))); });
      expect(worst).toBeLessThan(1);

      let worstInterval = 0;
      for (let i = 1; i < times.length; i++) worstInterval = Math.max(worstInterval, Math.abs(times[i]! - times[i - 1]! - 20));
      expect(worstInterval).toBeLessThan(1);
    });

    it('stays regular even if the very first play comes right after enabling the port', async () => {
      const { sim, controller, port } = await setup();
      sim.play();
      sim.run(4000, controller);
      const times = clockTimes(port);
      const first = sim.perfOf(sim.songStart);
      // Only the first few pulses may sit on a not-yet-averaged offset.
      const settled = times.slice(60).map((ts, k) => Math.abs(ts - (first + (k + 60) * 20)));
      expect(Math.max(...settled)).toBeLessThan(1);
      expect(Math.max(...times.map((ts, k) => Math.abs(ts - (first + k * 20))))).toBeLessThan(4);
    });

    it('sends every message ahead of its time, within the lookahead window', async () => {
      const { sim, controller, port } = await setup();
      sim.run(1000, controller);
      sim.play();
      sim.run(3000, controller);
      const lead = port.byStatus(CLOCK).map((m) => m.ts! - m.at);
      expect(Math.min(...lead)).toBeGreaterThan(-1);
      expect(Math.max(...lead)).toBeLessThanOrEqual(MIDI_LOOKAHEAD_SEC * 1000 + MIDI_TICK_MS + 4);
      expect(controller.getSnapshot().stats.late).toBe(0);
    });

    it('sends nothing before the engine plays', async () => {
      const { sim, controller, port } = await setup();
      sim.run(2000, controller);
      expect(port.sent).toEqual([]);
    });

    it('follows a speed change (Fxx) from the next pulse that has not been handed out', async () => {
      const { sim, controller, port } = await setup();
      sim.run(1000, controller);
      sim.play();
      sim.run(2000, controller);
      const changedAt = sim.perf;
      sim.bpm = (125 * 6) / 7; // speed 6 → 7: libopenmpt's estimated BPM drops to 107.143
      sim.run(2000, controller);

      const times = clockTimes(port);
      const intervals = times.slice(1).map((t, i) => ({ at: t, d: t - times[i]! }));
      const before = intervals.filter((i) => i.at < changedAt - 200);
      const after = intervals.filter((i) => i.at > changedAt + (MIDI_LOOKAHEAD_SEC + 0.1) * 1000);
      expect(Math.max(...before.map((i) => Math.abs(i.d - 20)))).toBeLessThan(1);
      expect(Math.max(...after.map((i) => Math.abs(i.d - 2500 / ((125 * 6) / 7))))).toBeLessThan(1);
      // Between: one switch, no wobble back and forth, no pulse closer than the fast interval.
      const all = intervals.map((i) => i.d);
      expect(Math.min(...all)).toBeGreaterThan(19);
      const flips = all.slice(1).filter((d, k) => Math.abs(d - all[k]!) > 1).length;
      expect(flips).toBe(1);
      // The slow interval takes over within one lookahead window (counted from when the change is
      // heard, LATENCY after it was rendered) plus a timer tick.
      const firstSlow = intervals.find((i) => i.d > 21)!;
      expect(firstSlow.at - (changedAt + LATENCY_SEC * 1000)).toBeLessThan(MIDI_LOOKAHEAD_SEC * 1000 + MIDI_TICK_MS + REPORT_MS);
    });

    it('keeps the clock going with no rAF anywhere: only the timer and the engine poll drive it', async () => {
      const raf = vi.fn();
      vi.stubGlobal('requestAnimationFrame', raf);
      const { sim, controller, port } = await setup();
      sim.run(500, controller);
      sim.play();
      sim.run(1000, controller);
      expect(port.byStatus(CLOCK).length).toBeGreaterThan(40);
      expect(raf).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  describe('transport', () => {
    it('sends Start just before the first clock, which lands on the downbeat of the song', async () => {
      const { sim, controller, port } = await setup();
      sim.run(1000, controller);
      sim.play();
      sim.run(500, controller);
      const start = port.byStatus(START);
      expect(start).toHaveLength(1);
      const firstClock = port.byStatus(CLOCK)[0]!;
      expect(firstClock.ts! - start[0]!.ts!).toBeGreaterThanOrEqual(0.9);
      expect(firstClock.ts! - start[0]!.ts!).toBeLessThan(3);
      expect(Math.abs(firstClock.ts! - sim.perfOf(sim.songStart))).toBeLessThan(1);
      expect(port.sent[0]!.data).toEqual([START]);
    });

    it('sends Stop at the moment of a pause, then Continue on resume, with the beat continuing', async () => {
      const { sim, controller, port } = await setup();
      sim.run(1000, controller);
      sim.play();
      sim.run(2007, controller); // off the pulse grid: a pause exactly on a pulse is a coin toss
      const pausedAtAudio = sim.renderTime;
      sim.pause();
      const stop = port.byStatus(STOP);
      expect(stop).toHaveLength(1);
      expect(Math.abs(stop[0]!.ts! - sim.perfOf(pausedAtAudio))).toBeLessThan(1);

      // The grid position at the pause: the first pulse of the pre-pause grid at or after it.
      const grid = (k: number) => sim.perfOf(sim.songStart) + k * 20;
      const pausedPerf = sim.perfOf(pausedAtAudio);
      const kNext = Math.ceil((pausedPerf - grid(0)) / 20 - 1e-9);
      const remaining = grid(kNext) - pausedPerf;

      sim.run(3000, controller);
      const clocksWhilePaused = port.byStatus(CLOCK).filter((m) => m.at > stop[0]!.at + MIDI_LOOKAHEAD_SEC * 1000 + 40);
      expect(clocksWhilePaused.filter((m) => m.at < sim.perf - 1)).toEqual([]);

      const resumeAudio = sim.renderTime;
      sim.resume();
      sim.run(1000, controller);
      const cont = port.byStatus(CONTINUE);
      expect(cont).toHaveLength(1);
      const after = port.byStatus(CLOCK).filter((m) => m.ts! >= cont[0]!.ts!);
      // First clock after Continue is where the beat would have been had the audio not paused.
      expect(Math.abs(after[0]!.ts! - sim.perfOf(resumeAudio + remaining / 1000))).toBeLessThan(1);
      expect(cont[0]!.ts!).toBeLessThan(after[0]!.ts!);
      // And regular from there on.
      const ts = after.map((m) => m.ts!);
      for (let i = 1; i < ts.length; i++) expect(Math.abs(ts[i]! - ts[i - 1]! - 20)).toBeLessThan(1);
    });

    it('sends Stop on stop, and Start again (not Continue) on the next play', async () => {
      const { sim, controller, port } = await setup();
      sim.run(500, controller);
      sim.play();
      sim.run(1000, controller);
      sim.stop();
      expect(port.byStatus(STOP)).toHaveLength(1);
      sim.run(500, controller);
      sim.fire('start', 'loading');
      sim.play();
      sim.run(500, controller);
      expect(port.byStatus(START)).toHaveLength(2);
      expect(port.byStatus(CONTINUE)).toHaveLength(0);
    });

    it('sends Stop when the worklet faults, and Start once it is back', async () => {
      const { sim, controller, port } = await setup();
      sim.run(500, controller);
      sim.play();
      sim.run(500, controller);
      sim.playing = false;
      sim.fire('fault', 'faulted');
      expect(port.byStatus(STOP)).toHaveLength(1);
      sim.fire('recover', 'recovering');
      sim.play();
      sim.run(300, controller);
      expect(port.byStatus(START)).toHaveLength(2);
    });

    it('relocates on a seek while playing: Stop, Song Position, Continue, then clocks without a doubled pulse', async () => {
      const { sim, controller, port } = await setup();
      sim.run(1000, controller);
      sim.play();
      sim.run(2000, controller);
      const before = port.sent.length;
      sim.seek(70); // order 1, row 6
      sim.run(1000, controller);

      const after = port.sent.slice(before);
      const stop = after.findIndex((m) => m.data[0] === STOP);
      expect(stop).toBeGreaterThanOrEqual(0);
      expect(after[stop + 1]!.data).toEqual([SPP, 70, 0]);
      expect(after[stop + 2]!.data).toEqual([CONTINUE]);
      const gap = after[stop + 2]!.ts! - after[stop]!.ts!;
      expect(gap).toBeGreaterThan(0.5);
      expect(gap).toBeLessThan(4);

      // No two pulses closer than half an interval, anywhere — the pulses already sent are waited for.
      const all = clockTimes(port).sort((a, b) => a - b);
      for (let i = 1; i < all.length; i++) expect(all[i]! - all[i - 1]!).toBeGreaterThan(9.5);
      // The beat is back to a steady 20 ms within a few pulses of the landing.
      const tail = all.slice(-30);
      for (let i = 1; i < tail.length; i++) expect(Math.abs(tail[i]! - tail[i - 1]! - 20)).toBeLessThan(1);
    });

    it('moves only the position (no Stop, no Continue) for a seek while paused, and continues from it on resume', async () => {
      const { sim, controller, port } = await setup();
      sim.run(500, controller);
      sim.play();
      sim.run(1000, controller);
      sim.pause();
      const stopsBefore = port.byStatus(STOP).length;
      sim.seek(128);
      expect(port.sent[port.sent.length - 1]!.data).toEqual([SPP, 0, 1]);
      expect(port.byStatus(STOP)).toHaveLength(stopsBefore);
      sim.resume();
      sim.run(500, controller);
      expect(port.byStatus(CONTINUE)).toHaveLength(1);
    });

    it('starts from a sought position with Song Position + Continue, not Start (seekOrder from stopped)', async () => {
      const { sim, controller, port } = await setup();
      sim.run(500, controller);
      sim.play();
      sim.seek(64); // what the engine does right after `started` when it was asked to start at order 1
      sim.run(800, controller);
      expect(port.byStatus(START)).toHaveLength(0);
      const spp = port.byStatus(SPP);
      expect(spp).toHaveLength(1);
      expect(spp[0]!.data).toEqual([SPP, 64, 0]);
      const cont = port.byStatus(CONTINUE);
      expect(cont).toHaveLength(1);
      expect(spp[0]!.ts!).toBeLessThan(cont[0]!.ts!);
      expect(cont[0]!.ts!).toBeLessThan(port.byStatus(CLOCK)[0]!.ts! + 0.01);
    });

    it('relocates when the song loops with no seek (position steps back)', async () => {
      const { sim, controller, port } = await setup();
      sim.run(500, controller);
      sim.play();
      sim.run(2000, controller);
      // libopenmpt wrapped to the start by itself.
      sim.rowFloat = 0;
      sim.posSec = 0;
      sim.run(400, controller);
      expect(port.byStatus(STOP).length).toBeGreaterThanOrEqual(1);
      const spp = port.byStatus(SPP);
      expect(spp[spp.length - 1]!.data).toEqual([SPP, 0, 0]);
    });
  });

  describe('ports and settings', () => {
    it('does nothing at all without Web MIDI, and says so', async () => {
      const sim = new Sim();
      sim.env.supported = false;
      const controller = new MidiOutController(sim.engine, sim.env);
      expect(controller.getSnapshot().supported).toBe(false);
      expect(controller.getSnapshot().access).toBe('unsupported');
      expect(await controller.enableAccess()).toBe(false);
      expect(sim.transportListeners.size).toBe(0);
      expect(sim.seekListeners.size).toBe(0);
      sim.play();
      sim.run(500, controller);
      controller.selectOutput('x');
      controller.tick();
    });

    it('reports a refusal instead of throwing', async () => {
      const sim = new Sim();
      sim.accessError = Object.assign(new Error('blocked'), { name: 'SecurityError' });
      const controller = new MidiOutController(sim.engine, sim.env);
      expect(await controller.enableAccess()).toBe(false);
      expect(controller.getSnapshot().access).toBe('denied');
      expect(controller.getSnapshot().error).toMatch(/blocked/i);
    });

    it('lists connected outputs and remembers the chosen one', async () => {
      const { sim, controller } = await setup({ ports: ['a', 'b'] });
      expect(controller.getSnapshot().outputs.map((o) => o.id)).toEqual(['a', 'b']);
      controller.selectOutput('b');
      expect(controller.getSnapshot().connected).toBe(true);
      expect(sim.settingsStore.outputId).toBe('b');
      expect(sim.settingsStore.outputName).toBe('Port b');
      controller.selectOutput(null);
      expect(controller.getSnapshot().connected).toBe(false);
    });

    it('only restores a saved output on load when the browser already granted MIDI', async () => {
      const first = new Sim();
      first.settingsStore = { ...DEFAULT_MIDI_OUT_SETTINGS, outputId: 'out' };
      first.addPort('out');
      first.permission = 'prompt';
      const prompted = new MidiOutController(first.engine, first.env);
      await prompted.restore();
      expect(prompted.getSnapshot().access).toBe('idle');

      const second = new Sim();
      second.settingsStore = { ...DEFAULT_MIDI_OUT_SETTINGS, outputId: 'out' };
      second.addPort('out');
      second.permission = 'granted';
      const granted = new MidiOutController(second.engine, second.env);
      await granted.restore();
      expect(granted.getSnapshot().access).toBe('granted');
      expect(granted.getSnapshot().connected).toBe(true);
    });

    it('sends no clock or transport with the clock switched off, but still plays notes', async () => {
      const { sim, controller, port } = await setup({ settings: { clock: false, noteOut: true } });
      sim.matrices[0] = makeMatrix(0, { 0: [note(61)] });
      sim.run(500, controller);
      sim.play();
      sim.run(1500, controller);
      expect(port.byStatus(CLOCK)).toEqual([]);
      expect(port.byStatus(START)).toEqual([]);
      expect(port.byStatus(0x90).length).toBe(1);
    });

    it('stops the timer when nothing is enabled or no port is chosen', async () => {
      const { sim, controller } = await setup();
      expect(sim.intervalHandler).not.toBeNull();
      controller.setClockEnabled(false);
      expect(sim.intervalHandler).toBeNull();
      controller.setClockEnabled(true);
      expect(sim.intervalHandler).not.toBeNull();
      controller.selectOutput(null);
      expect(sim.intervalHandler).toBeNull();
    });

    it('silences the old port when the output changes mid-song, and brings the new one up to date', async () => {
      const { sim, controller, ports } = await setup({ ports: ['a', 'b'], settings: { noteOut: true } });
      sim.matrices[0] = makeMatrix(0, { 0: [note(61)] });
      sim.run(500, controller);
      sim.play();
      sim.run(1000, controller);
      controller.selectOutput('b');
      expect(ports[0]!.sent.slice(-2).map((m) => m.data[0])).toEqual([STOP, 0x80]);
      sim.run(600, controller);
      const b = ports[1]!;
      expect(b.byStatus(STOP).length).toBe(1);
      expect(b.byStatus(SPP)).toHaveLength(1);
      expect(b.byStatus(CONTINUE)).toHaveLength(1);
      expect(b.byStatus(CLOCK).length).toBeGreaterThan(10);
    });

    it('drops quietly when the output is unplugged and resyncs when it returns', async () => {
      const { sim, controller, port } = await setup();
      sim.run(500, controller);
      sim.play();
      sim.run(1000, controller);
      port.state = 'disconnected';
      sim.access.onstatechange?.();
      expect(controller.getSnapshot().connected).toBe(false);
      expect(sim.intervalHandler).toBeNull();
      const count = port.sent.length;
      sim.run(500, controller);
      expect(port.sent.length).toBe(count);

      port.state = 'connected';
      sim.access.onstatechange?.();
      expect(controller.getSnapshot().connected).toBe(true);
      sim.run(600, controller);
      expect(port.byStatus(CONTINUE).length).toBeGreaterThanOrEqual(1);
      expect(port.sent.slice(count).some((m) => m.data[0] === SPP)).toBe(true);
    });

    it('survives a port that throws on send', async () => {
      const { sim, controller, port } = await setup();
      port.send = () => { throw Object.assign(new Error('port closed'), { name: 'InvalidStateError' }); };
      sim.run(500, controller);
      sim.play();
      expect(() => sim.run(500, controller)).not.toThrow();
      expect(controller.getSnapshot().error).toMatch(/port closed/);
    });

    it('stops listening to the engine when disposed', async () => {
      const { sim, controller } = await setup();
      controller.dispose();
      expect(sim.transportListeners.size).toBe(0);
      expect(sim.seekListeners.size).toBe(0);
      expect(sim.intervalHandler).toBeNull();
    });
  });

  describe('note-out', () => {
    const song = () => ({
      0: [note(61)], // C-5 → MIDI 60 on the first row
      4: [note(65)],
      8: [note(255)], // key-off
      12: [{ type: 'note', text: '', note: 68, effCmd: 19, effVal: 0xc2 } as PatternCell],
    });

    it('is off by default: the pattern sends no notes', async () => {
      const { sim, controller, port } = await setup();
      sim.matrices[0] = makeMatrix(0, song());
      sim.run(500, controller);
      sim.play();
      sim.run(2500, controller);
      expect(port.sent.filter((m) => (m.data[0]! & 0xf0) === 0x90 || (m.data[0]! & 0xf0) === 0x80)).toEqual([]);
    });

    it('plays the rows as they are reached, off the next note, the key-off and the cut effect', async () => {
      const { sim, controller, port } = await setup({ settings: { noteOut: true } });
      sim.matrices[0] = makeMatrix(0, song());
      sim.run(1000, controller);
      sim.play();
      sim.run(2000, controller);
      const notes = port.sent.filter((m) => m.data[0]! >= 0x80 && m.data[0]! < 0xa0).map((m) => m.data.join(','));
      expect(notes.slice(0, 5)).toEqual([
        '144,60,100', // row 0 note on
        '128,60,0', //   row 4: off, then on (legato)
        '144,64,100',
        '128,64,0', //   row 8: key-off
        '144,67,100', // row 12: note + EC2
      ]);
    });

    it('places notes within half a position report of their row, unbiased, and the first row exactly', async () => {
      const { sim, controller, port } = await setup({ settings: { noteOut: true } });
      const dense: Record<number, PatternCell[]> = {};
      for (let r = 0; r < ROWS_PER_ORDER; r++) dense[r] = [note(61 + (r % 12))];
      sim.matrices[0] = makeMatrix(0, dense);
      sim.run(1000, controller);
      sim.play();
      sim.run(6000, controller);
      const ons = port.sent.filter((m) => (m.data[0]! & 0xf0) === 0x90);
      expect(ons.length).toBeGreaterThan(40);
      const errors = ons.map((m, r) => m.ts! - (sim.perfOf(sim.songStart) + r * 120));
      expect(Math.abs(errors[0]!)).toBeLessThan(1); // the landing row is exact
      expect(Math.max(...errors.map(Math.abs))).toBeLessThan(REPORT_MS / 2 + 1.5);
      const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
      expect(Math.abs(mean)).toBeLessThan(2);
      expect(controller.getSnapshot().stats.late).toBe(0);
    });

    it('does not play a muted channel', async () => {
      const { sim, controller, port } = await setup({ settings: { noteOut: true } });
      sim.matrices[0] = makeMatrix(0, song());
      sim.muted.add(0);
      sim.run(500, controller);
      sim.play();
      sim.run(2000, controller);
      expect(port.sent.filter((m) => (m.data[0]! & 0xf0) === 0x90)).toEqual([]);
    });

    it('lets go of every held note on pause, stop and seek', async () => {
      for (const act of ['pause', 'stop', 'seek'] as const) {
        const { sim, controller, port } = await setup({ settings: { noteOut: true } });
        sim.matrices[0] = makeMatrix(0, { 0: [note(61)] });
        sim.run(500, controller);
        sim.play();
        sim.run(800, controller);
        expect(port.byStatus(0x90)).toHaveLength(1);
        if (act === 'pause') sim.pause();
        else if (act === 'stop') sim.stop();
        else sim.seek(20);
        sim.run(300, controller);
        expect(port.byStatus(0x80)).toHaveLength(1);
        controller.dispose();
      }
    });

    it('releases notes at once when note-out is switched off, and sends them on the chosen channel', async () => {
      const { sim, controller, port } = await setup({ settings: { noteOut: true, channelMode: 'single', singleChannel: 5 } });
      sim.matrices[0] = makeMatrix(0, { 0: [note(61)] });
      sim.run(500, controller);
      sim.play();
      sim.run(800, controller);
      expect(port.byStatus(0x94)).toHaveLength(1);
      controller.setNoteOutEnabled(false);
      expect(port.byStatus(0x84)).toHaveLength(1);
      expect(sim.settingsStore.noteOut).toBe(false);
    });
  });
});
