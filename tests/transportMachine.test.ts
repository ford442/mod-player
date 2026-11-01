/**
 * The transport FSM (#492, audio/engine/transport.ts): the typed table is the only way the transport
 * changes, an edge that is not in it throws (strict) or is refused and logged (production), and the
 * coarse playing / paused / stopped view is derived from the phase.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IllegalTransportTransitionError,
  TRANSPORT_PHASES,
  TRANSPORT_TRANSITIONS,
  TransportMachine,
  transportStateOf,
  type TransportEvent,
  type TransportPhase,
} from '../audio/engine/transport';

const strict = () => new TransportMachine({ strict: true });

/** Drive a fresh machine to `phase` along legal edges. */
function machineAt(phase: TransportPhase, options: { holdPaused?: boolean } = {}): TransportMachine {
  const m = strict();
  const toReady = () => { m.send('load'); m.send('parsed', 'ready'); };
  const toPlaying = () => { toReady(); m.send('start'); m.send('started', 'playing'); };
  switch (phase) {
    case 'idle': break;
    case 'loading': m.send('load', undefined, options); break;
    case 'ready': toReady(); break;
    case 'playing': toPlaying(); break;
    case 'paused': toPlaying(); m.send('pause'); break;
    case 'stopped': toPlaying(); m.send('stop'); break;
    case 'faulted': toPlaying(); m.send('fault'); break;
    case 'recovering': toPlaying(); m.send('fault'); m.send('recover'); break;
    case 'spFallback': toReady(); m.send('start'); m.send('started', 'spFallback'); break;
  }
  expect(m.phase).toBe(phase);
  return m;
}

describe('transition table', () => {
  it('only names real phases', () => {
    for (const [event, edges] of Object.entries(TRANSPORT_TRANSITIONS)) {
      for (const [from, targets] of Object.entries(edges)) {
        expect(TRANSPORT_PHASES, `${event} from`).toContain(from);
        for (const to of targets as readonly string[]) expect(TRANSPORT_PHASES, `${event} → ${to}`).toContain(to);
      }
    }
  });

  it('reaches every phase from idle, and every phase can be stopped', () => {
    const reachable = new Set<TransportPhase>(['idle']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const edges of Object.values(TRANSPORT_TRANSITIONS)) {
        for (const [from, targets] of Object.entries(edges) as [TransportPhase, readonly TransportPhase[]][]) {
          if (!reachable.has(from)) continue;
          for (const to of targets) if (!reachable.has(to)) { reachable.add(to); grew = true; }
        }
      }
    }
    expect([...reachable].sort()).toEqual([...TRANSPORT_PHASES].sort());
    for (const phase of TRANSPORT_PHASES) {
      expect(Object.keys(TRANSPORT_TRANSITIONS.stop), `stop from ${phase}`).toContain(phase);
    }
  });
});

describe('TransportMachine', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts idle and stopped', () => {
    const m = strict();
    expect(m.phase).toBe('idle');
    expect(m.state).toBe('stopped');
    expect(m.isPlaying).toBe(false);
    expect(m.isPaused).toBe(false);
  });

  it('runs load → ready → start → playing ⇄ paused → stopped', () => {
    const m = strict();
    const seen: string[] = [];
    m.subscribe((t) => seen.push(`${t.from}-${t.event}->${t.to}`));
    m.send('load');
    m.send('parsed', 'ready');
    m.send('start');
    m.send('started', 'playing');
    expect(m.isPlaying).toBe(true);
    m.send('pause');
    expect(m.isPaused).toBe(true);
    m.send('resume', 'playing');
    m.send('stop');
    expect(seen).toEqual([
      'idle-load->loading',
      'loading-parsed->ready',
      'ready-start->loading',
      'loading-started->playing',
      'playing-pause->paused',
      'paused-resume->playing',
      'playing-stop->stopped',
    ]);
    expect(m.state).toBe('stopped');
  });

  it('throws on an illegal transition in strict mode, and leaves the phase alone', () => {
    const m = strict();
    expect(() => m.send('pause')).toThrow(IllegalTransportTransitionError);
    expect(() => m.send('started', 'playing')).toThrow(/'started' cannot go 'idle' → 'playing'/);
    expect(m.phase).toBe('idle');

    const playing = machineAt('playing');
    expect(() => playing.send('resume', 'playing')).toThrow(IllegalTransportTransitionError);
    expect(() => playing.send('parsed', 'ready')).toThrow(IllegalTransportTransitionError);
    expect(playing.phase).toBe('playing');
  });

  it('refuses an edge that exists but to the wrong target', () => {
    const m = machineAt('faulted');
    expect(() => m.send('started', 'playing')).toThrow(IllegalTransportTransitionError);
  });

  it('requires an explicit target where the table allows several', () => {
    const m = machineAt('paused');
    expect(m.can('resume')).toBe(false);
    expect(m.can('resume', 'playing')).toBe(true);
    expect(() => m.send('resume')).toThrow(/'resume' is not legal from 'paused'/);
  });

  it('logs and refuses (does not throw) an illegal transition outside strict mode', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const listener = vi.fn();
    const m = new TransportMachine({ strict: false });
    m.subscribe(listener);
    expect(m.send('resume', 'playing')).toBe('idle');
    expect(m.phase).toBe('idle');
    expect(listener).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("'resume' cannot go 'idle' → 'playing'"));
  });

  it('cues a module under a paused transport: paused throughout the load, lands paused', () => {
    const m = machineAt('paused');
    m.send('stop');
    m.send('load', undefined, { holdPaused: true });
    expect(m.phase).toBe('loading');
    expect(m.holdPaused).toBe(true);
    expect(m.isPaused).toBe(true);
    expect(m.state).toBe('paused');
    m.send('parsed', 'paused');
    expect(m.holdPaused).toBe(false);
    expect(m.state).toBe('paused');
  });

  it('drops the cue hold on any way out of loading', () => {
    const m = machineAt('loading', { holdPaused: true });
    m.send('stop');
    expect(m.holdPaused).toBe(false);
    expect(m.state).toBe('stopped');
    m.send('load');
    expect(m.holdPaused).toBe(false);
    expect(m.state).toBe('stopped');
  });

  it('recovers a fault into the worklet or the ScriptProcessor fallback', () => {
    const m = machineAt('playing');
    m.send('fault');
    expect(m.isPlaying).toBe(false);
    m.send('recover');
    m.send('started', 'spFallback');
    expect(m.phase).toBe('spFallback');
    expect(m.isPlaying).toBe(true);
    m.send('pause');
    m.send('resume', 'spFallback');
    expect(m.phase).toBe('spFallback');
  });

  it('keeps a paused transport paused through a background fault', () => {
    const m = machineAt('paused');
    m.send('fault');
    expect(m.phase).toBe('paused');
    expect(m.isPaused).toBe(true);
  });

  it('lets a module that finished parsing after a user stop land without moving the transport', () => {
    const m = machineAt('loading');
    m.send('stop');
    m.send('parsed', 'stopped');
    expect(m.phase).toBe('stopped');
  });

  it('stop is legal from every phase', () => {
    for (const phase of TRANSPORT_PHASES) {
      const m = machineAt(phase);
      m.send('stop');
      expect(m.phase).toBe(phase === 'idle' ? 'idle' : 'stopped');
    }
  });

  it('can() agrees with send() for every event from every phase', () => {
    const events = Object.keys(TRANSPORT_TRANSITIONS) as TransportEvent[];
    for (const phase of TRANSPORT_PHASES) {
      for (const event of events) {
        for (const to of TRANSPORT_PHASES) {
          const m = machineAt(phase);
          const legal = m.can(event, to);
          if (legal) expect(() => m.send(event, to)).not.toThrow();
          else expect(() => m.send(event, to)).toThrow(IllegalTransportTransitionError);
        }
      }
    }
  });
});

describe('transportStateOf', () => {
  it('maps every phase onto stopped / playing / paused', () => {
    const coarse = Object.fromEntries(TRANSPORT_PHASES.map((p) => [p, transportStateOf(p, false)]));
    expect(coarse).toEqual({
      idle: 'stopped',
      loading: 'stopped',
      ready: 'stopped',
      playing: 'playing',
      paused: 'paused',
      stopped: 'stopped',
      faulted: 'stopped',
      recovering: 'stopped',
      spFallback: 'playing',
    });
    expect(transportStateOf('loading', true)).toBe('paused');
  });
});
