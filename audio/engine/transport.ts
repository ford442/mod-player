/**
 * The transport state machine (#492).
 *
 * Before #492 the transport lived in a pair of booleans duplicated as React state and refs
 * (`isPlaying` / `isPlayingRef`, `isPaused` / `isPausedRef`), written from a dozen places — the
 * transport actions, three engine start paths, the fault handler, the module loader. Every bug of
 * the #329 / #330 / #456 / #467 class was two of those writers disagreeing. Here the transport is
 * one value, `phase`, and the only way to change it is `send(event, to)`, checked against the
 * typed table below: an edge that is not in the table throws in dev builds (and in unit tests) and
 * is logged and refused in production.
 *
 * Phases:
 *
 *   idle        no module (initial; after a failed parse)
 *   loading     a module is being parsed, or loaded into the audio engine before it renders
 *   ready       a module is loaded and has not been played yet
 *   playing     an AudioWorklet engine (JS or native) is rendering
 *   paused      silent, the engine keeps its cursor (pitfall 15: pause is not stop)
 *   stopped     silent, position reset
 *   faulted     the worklet engine crashed (transient: recovery starts in the same tick)
 *   recovering  restarting the worklet node, or bringing up the ScriptProcessor fallback
 *   spFallback  playing on the ScriptProcessorNode fallback
 *
 *   idle → loading → ready → loading → playing ⇄ paused → stopped
 *   playing → faulted → recovering → (playing | spFallback)
 *
 * `loading` carries one bit of extended state, `holdPaused`: a module loaded while paused is *cued*
 * (pitfall 15) — it loads, then the transport comes back as `paused`, not `ready`, and it reads as
 * paused throughout (`isPaused`), so the UI never flashes "stopped" while the next track loads.
 *
 * The audio engines report asynchronously (a worklet `loaded` ack, a native start finishing after
 * its awaits), so a report can arrive after the user moved the transport on. Callers that relay
 * engine reports check `can()` first and treat a report that no longer fits as stale; `send()`
 * throwing is reserved for edges that can only come from a bug.
 */
import { createLogger } from '../../utils/log';
import type { TransportState } from '../../utils/transportClock';

const log = createLogger('Transport');

export const TRANSPORT_PHASES = [
  'idle',
  'loading',
  'ready',
  'playing',
  'paused',
  'stopped',
  'faulted',
  'recovering',
  'spFallback',
] as const;

export type TransportPhase = (typeof TRANSPORT_PHASES)[number];

export type TransportEvent =
  /** processModuleData started parsing a module (after its own stop). */
  | 'load'
  /** The parse finished; the module is installed. */
  | 'parsed'
  /** The parse failed; the previous module is already gone. */
  | 'loadFailed'
  /** play() is bringing an engine up (the JS worklet waits for its `loaded` ack). */
  | 'start'
  /** The engine start path gave up before anything rendered. */
  | 'startFailed'
  /** An engine reports it is rendering. */
  | 'started'
  | 'pause'
  | 'resume'
  | 'stop'
  /** The worklet engine crashed (processorerror, or a trapped process()). */
  | 'fault'
  /** Automatic recovery began: restart the node, or fall back to the ScriptProcessor. */
  | 'recover';

type Edges = { readonly [P in TransportPhase]?: readonly TransportPhase[] };

/** Every legal edge, keyed event → from → allowed targets. Nothing else changes `phase`. */
export const TRANSPORT_TRANSITIONS = {
  load: {
    idle: ['loading'],
    ready: ['loading'],
    stopped: ['loading'],
    faulted: ['loading'],
    recovering: ['loading'],
  },
  parsed: {
    loading: ['ready', 'paused'],
    // The user pressed stop while the parse was still running: the module lands, the transport stays put.
    stopped: ['stopped'],
  },
  loadFailed: {
    loading: ['idle'],
    stopped: ['idle'],
  },
  start: {
    ready: ['loading'],
    stopped: ['loading'],
    // A failed restart leaves the transport recovering; play is the user's retry.
    faulted: ['loading'],
    recovering: ['loading'],
  },
  startFailed: {
    loading: ['stopped'],
  },
  started: {
    loading: ['playing', 'spFallback'],
    recovering: ['playing', 'spFallback'],
    // A hot module reload into the playing worklet acks `loaded` again; or the engine changed under it.
    playing: ['playing', 'spFallback'],
  },
  pause: {
    playing: ['paused'],
    spFallback: ['paused'],
  },
  resume: {
    paused: ['playing', 'spFallback'],
  },
  stop: {
    idle: ['idle'],
    loading: ['stopped'],
    ready: ['stopped'],
    playing: ['stopped'],
    paused: ['stopped'],
    stopped: ['stopped'],
    faulted: ['stopped'],
    recovering: ['stopped'],
    spFallback: ['stopped'],
  },
  fault: {
    loading: ['faulted'],
    playing: ['faulted'],
    recovering: ['faulted'],
    // A fault under a paused transport is repaired in the background; the transport stays paused and
    // the restarted node comes up paused (#456).
    paused: ['paused'],
  },
  recover: {
    faulted: ['recovering'],
  },
} as const satisfies Record<TransportEvent, Edges>;

export interface TransportTransition {
  readonly event: TransportEvent;
  readonly from: TransportPhase;
  readonly to: TransportPhase;
}

export class IllegalTransportTransitionError extends Error {
  constructor(
    readonly event: TransportEvent,
    readonly from: TransportPhase,
    readonly to: TransportPhase | undefined,
  ) {
    super(
      to === undefined
        ? `transport: '${event}' is not legal from '${from}'`
        : `transport: '${event}' cannot go '${from}' → '${to}'`,
    );
    this.name = 'IllegalTransportTransitionError';
  }
}

export interface TransportMachineOptions {
  /** Throw on an illegal edge (dev builds, unit tests). Otherwise log it and keep the current phase. */
  strict: boolean;
}

export interface SendOptions {
  /** `load` only: the module is being cued under a paused transport (see `holdPaused`). */
  holdPaused?: boolean;
}

function allowedTargets(event: TransportEvent, from: TransportPhase): readonly TransportPhase[] {
  const edges: Edges = TRANSPORT_TRANSITIONS[event];
  return edges[from] ?? [];
}

/** The coarse transport the UI, the shortcuts and `mediaSession` show (stopped / playing / paused). */
export function transportStateOf(phase: TransportPhase, holdPaused: boolean): TransportState {
  if (phase === 'playing' || phase === 'spFallback') return 'playing';
  if (phase === 'paused' || (phase === 'loading' && holdPaused)) return 'paused';
  return 'stopped';
}

export class TransportMachine {
  private current: TransportPhase = 'idle';
  private hold = false;
  private readonly listeners = new Set<(transition: TransportTransition) => void>();

  constructor(private readonly options: TransportMachineOptions) {}

  get phase(): TransportPhase {
    return this.current;
  }

  /** True while a cued module (loaded under a paused transport) is loading. */
  get holdPaused(): boolean {
    return this.hold;
  }

  /** Rendering audibly, on any engine. */
  get isPlaying(): boolean {
    return transportStateOf(this.current, this.hold) === 'playing';
  }

  /** Silent with the cursor kept — including a module cued while paused. Never true with `isPlaying`. */
  get isPaused(): boolean {
    return transportStateOf(this.current, this.hold) === 'paused';
  }

  get state(): TransportState {
    return transportStateOf(this.current, this.hold);
  }

  /** Is `event` (to `to`, or to its only target) legal from the current phase? */
  can(event: TransportEvent, to?: TransportPhase): boolean {
    const targets = allowedTargets(event, this.current);
    return to === undefined ? targets.length === 1 : targets.includes(to);
  }

  /**
   * Take the edge `event` → `to`. `to` may be omitted when the table allows exactly one target from
   * the current phase. Returns the phase after the call.
   */
  send(event: TransportEvent, to?: TransportPhase, options?: SendOptions): TransportPhase {
    const from = this.current;
    const targets = allowedTargets(event, from);
    const target = to ?? (targets.length === 1 ? targets[0] : undefined);
    if (target === undefined || !targets.includes(target)) {
      const error = new IllegalTransportTransitionError(event, from, to);
      if (this.options.strict) throw error;
      console.error(`[Transport] ${error.message} — ignored`);
      return from;
    }
    this.current = target;
    this.hold = target === 'loading' && event === 'load' && Boolean(options?.holdPaused);
    log.debug(`${from} --${event}--> ${target}${this.hold ? ' (holding pause)' : ''}`);
    const transition: TransportTransition = { event, from, to: target };
    for (const listener of this.listeners) listener(transition);
    return target;
  }

  subscribe(listener: (transition: TransportTransition) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
