/**
 * PlayerEngine (#492): the player as a framework-free object that React observes.
 *
 * Before #492 the transport and the engine handles lived in ~63 `useRef`s and 20+ `useState`s inside
 * `useLibOpenMPT`, some of them duplicated as both (`isPlaying`, `spFallbackTriggered`,
 * `workletLoadedRef`, `seekAcknowledgedRef`, `uiLoopActiveRef`). This class owns all of it:
 *
 *   - the engine handles (JS worklet node, ScriptProcessor), the module pointer and
 *     the master chain — the refs bag built by `engineRefs.ts`;
 *   - the transport FSM (`transport.ts`): the only thing that changes playing / paused / stopped;
 *   - a snapshot store (`store.ts`) that React reads through `useSyncExternalStore`
 *     (`hooks/usePlayerEngine.ts`), so a component re-renders only for the fields it selects.
 *
 * High-rate data stays outside the snapshot exactly as before (pitfall 9): position and VU land in
 * `channelStatesRef` / `playbackStateRef`, mutated in place and read by the GPU every frame; the
 * snapshot gets a ≤10 Hz copy of the channel states for React.
 *
 * The engine start paths (`hooks/audioGraph/`) and action factories (`hooks/libOpenMPT/create*.ts`)
 * are framework-free code this class composes; they keep their paths because their unit tests import
 * them there. `tests/playerEngineImports.test.ts` checks nothing reachable from here imports React.
 *
 * Callers — the React UI, the command bus (`registerEngineCommands`), MIDI, `mediaSession`, the 3D view,
 * headless tests — drive it with methods or `dispatch(command)`.
 */
import type { ChannelShadowState, ModuleInfo, PatternMatrix, PlaybackState, SyncDebugInfo } from '../../types';
import { emptyInstrumentTable, type InstrumentTable } from '../../types/instruments';
import { startAudioPlayback } from '../../hooks/useAudioGraph';
import type {
  AudioGraphCallbacks,
  AudioGraphConfig,
  AudioGraphRefs,
  AudioStartResult,
} from '../../hooks/audioGraph/types';
import { createUpdateUI } from '../../hooks/libOpenMPT/createUpdateUI';
import {
  createEnsureMainThreadModule,
  createLoadModule,
  createProcessModuleData,
  type ProcessModuleOptions,
} from '../../hooks/libOpenMPT/createModuleActions';
import {
  createPauseMusic,
  createRequestOscBuffer,
  createResumeMusic,
  createSeekToStep,
  createStopMusic,
  type TransportActionsDeps,
} from '../../hooks/libOpenMPT/createTransportActions';
import { cleanupLibOpenMPT, runLibOpenMPTInit } from '../../hooks/libOpenMPT/runInit';
import { DEFAULT_MODULE_URL, WORKLET_URL } from '../../hooks/libOpenMPT/constants';
import type { LibOpenMPTRefs, LibOpenMPTSetters } from '../../hooks/libOpenMPT/types';
import { postPause, postSetAudioLite } from '../../audio-worklet/protocol';
import { applyMasterLevels } from '../../utils/audioMasterGraph';
import { resetAudioHeardTime } from '../../utils/playheadPrediction';
import { hasShareModuleIntent } from '../../utils/shareState';
import { playShouldResume, type TransportState } from '../../utils/transportClock';
import { createLogger } from '../../utils/log';
import { createEngineRefs } from './engineRefs';
import {
  browserOutputDeviceEnv,
  OutputDeviceController,
  type OutputDeviceEnv,
  type OutputDeviceState,
} from './outputDevice';
import { SnapshotStore, type Ref, type SetStateAction } from './store';
import { TransportMachine, type TransportPhase } from './transport';
import { isAudioWorkletSupported, verifyWorkletFile } from './workletUrls';

const log = createLogger('Engine');

/**
 * Everything React (or any other observer) may read. Immutable; replaced on every change. The
 * output-device fields (`outputDeviceId`, `sinkError`, …) come from `OutputDeviceState`.
 */
export interface PlayerSnapshot extends OutputDeviceState {
  /** The FSM phase — see transport.ts. */
  readonly phase: TransportPhase;
  /** Coarse transport for the UI, shortcuts and mediaSession; derived from `phase`. */
  readonly transportState: TransportState;
  readonly isPlaying: boolean;
  readonly isPaused: boolean;
  readonly status: string;
  readonly isReady: boolean;
  readonly isModuleLoaded: boolean;
  readonly moduleInfo: ModuleInfo;
  readonly sequencerMatrix: PatternMatrix | null;
  readonly instrumentNames: string[];
  readonly sampleNames: string[];
  readonly moduleFormat: string;
  readonly instrumentTable: InstrumentTable;
  readonly moduleComments: string;
  readonly moduleDurationSeconds: number;
  readonly moduleFileName: string;
  readonly sequencerCurrentRow: number;
  readonly sequencerGlobalRow: number;
  readonly playbackSeconds: number;
  readonly playbackRowFraction: number;
  readonly totalPatternRows: number;
  /** ≤10 Hz copy of `channelStatesRef` for React; the GPU reads the ref. */
  readonly channelStates: ChannelShadowState[];
  readonly beatPhase: number;
  readonly isLooping: boolean;
  /** Master volume 0…1 — applied by the master GainNode only (pitfall 16). */
  readonly volume: number;
  /** Master pan −1…1. */
  readonly pan: number;
  readonly isMuted: boolean;
  readonly isWorkletSupported: boolean;
  readonly syncDebug: SyncDebugInfo;
  readonly workletLoadError: string | null;
  /** The master analyser, once the master chain exists. */
  readonly analyserNode: AnalyserNode | null;
}

/** Commands the command bus, MIDI, mediaSession and the UI send (`dispatch`). */
export type EngineCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'togglePlayPause' }
  | { type: 'stop' }
  | { type: 'seekToStep'; step: number }
  | { type: 'seekRows'; delta: number }
  | { type: 'seekOrders'; delta: number }
  | { type: 'jumpToOrder'; order: number }
  | { type: 'setVolume'; value: number }
  | { type: 'nudgeVolume'; delta: number }
  | { type: 'setPan'; value: number }
  | { type: 'toggleMute' }
  | { type: 'setLooping'; value: boolean }
  | { type: 'toggleLoop' }
  | { type: 'toggleChannelMute'; channel: number };

export type StartAudioPlayback = (
  refs: AudioGraphRefs,
  callbacks: AudioGraphCallbacks,
  config: AudioGraphConfig,
) => Promise<AudioStartResult>;

export interface PlayerEngineOptions {
  /** Throw on an illegal transport edge instead of logging it (dev builds, unit tests). */
  strictTransport?: boolean;
  initialVolume?: number;
  /** The engine start path; tests substitute a fake that plays the audio engine's part. */
  startAudioPlayback?: StartAudioPlayback;
  /** Output-device support, storage and `devicechange` source; tests substitute fakes. */
  outputDeviceEnv?: OutputDeviceEnv;
}

const DEFAULT_VOLUME = 0.5;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function createInitialSnapshot(volume: number, output: OutputDeviceState): PlayerSnapshot {
  return {
    ...output,
    phase: 'idle',
    transportState: 'stopped',
    isPlaying: false,
    isPaused: false,
    status: 'Initializing...',
    isReady: false,
    isModuleLoaded: false,
    moduleInfo: { title: 'None', order: 0, row: 0, bpm: 125, numChannels: 0 },
    sequencerMatrix: null,
    instrumentNames: [],
    sampleNames: [],
    moduleFormat: '',
    instrumentTable: emptyInstrumentTable(),
    moduleComments: '',
    moduleDurationSeconds: 0,
    moduleFileName: '',
    sequencerCurrentRow: 0,
    sequencerGlobalRow: 0,
    playbackSeconds: 0,
    playbackRowFraction: 0,
    totalPatternRows: 0,
    channelStates: [],
    beatPhase: 0,
    isLooping: true,
    volume,
    pan: 0,
    isMuted: false,
    isWorkletSupported: false,
    syncDebug: {
      mode: 'none',
      bufferMs: 0,
      driftMs: 0,
      row: 0,
      starvationCount: 0,
      audioContextState: 'none',
      sampleRate: 0,
      baseLatency: 0,
      outputLatency: 0,
      workletSupported: typeof AudioWorklet !== 'undefined',
      wasmSupported: typeof WebAssembly !== 'undefined',
      driftAccumulator: 0,
      lastCorrectedTime: 0,
      lastWorkletUpdate: 0,
      seekPending: false,
      bufferHealth: 0,
    },
    workletLoadError: null,
    analyserNode: null,
  };
}

export class PlayerEngine {
  readonly transport: TransportMachine;
  private readonly store: SnapshotStore<PlayerSnapshot>;
  private readonly refs: LibOpenMPTRefs;
  private readonly setters: LibOpenMPTSetters;
  private readonly callbacks: AudioGraphCallbacks;
  private readonly startAudio: StartAudioPlayback;
  /** Which device the context renders to (setSinkId on the one context — pitfall 12). */
  private readonly output: OutputDeviceController;
  /** Bumped by dispose(): an init still awaiting when it is disposed stops at its next await. */
  private generation = 0;
  /** Volume to restore on unmute. */
  private preMuteVolume = DEFAULT_VOLUME;

  private readonly stopFn: (destroy?: boolean) => void;
  private readonly pauseFn: () => void;
  private readonly resumeFn: () => void;
  private readonly seekFn: (step: number) => void;
  private readonly requestOscBufferFn: () => void;
  private readonly processModuleDataFn: (
    fileData: Uint8Array,
    fileName: string,
    options?: ProcessModuleOptions,
  ) => Promise<void>;
  private readonly loadModuleFn: (fileData: Uint8Array, fileName: string) => Promise<void>;
  private readonly updateUIFn: () => void;

  constructor(options: PlayerEngineOptions = {}) {
    this.transport = new TransportMachine({ strict: options.strictTransport ?? false });
    this.output = new OutputDeviceController(
      (state) => this.store.patch(state),
      (ctx) => this.onSinkMoved(ctx),
      options.outputDeviceEnv ?? browserOutputDeviceEnv(),
    );
    this.store = new SnapshotStore(
      createInitialSnapshot(options.initialVolume ?? DEFAULT_VOLUME, this.output.idleState()),
    );
    this.preMuteVolume = this.store.getSnapshot().volume;
    this.startAudio = options.startAudioPlayback ?? startAudioPlayback;

    this.transport.subscribe(() => {
      const t = this.transport;
      this.store.patch({
        phase: t.phase,
        transportState: t.state,
        isPlaying: t.isPlaying,
        isPaused: t.isPaused,
      });
    });

    this.refs = createEngineRefs({
      transport: this.transport,
    });

    const s = this.store;
    this.setters = {
      setStatus: s.setter('status'),
      setIsModuleLoaded: s.setter('isModuleLoaded'),
      setModuleInfo: s.setter('moduleInfo'),
      setSequencerMatrix: s.setter('sequencerMatrix'),
      setInstrumentNames: s.setter('instrumentNames'),
      setSampleNames: s.setter('sampleNames'),
      setModuleFormat: s.setter('moduleFormat'),
      setInstrumentTable: s.setter('instrumentTable'),
      setModuleComments: s.setter('moduleComments'),
      setModuleDurationSeconds: s.setter('moduleDurationSeconds'),
      setModuleFileName: s.setter('moduleFileName'),
      setSequencerCurrentRow: s.setter('sequencerCurrentRow'),
      setSequencerGlobalRow: s.setter('sequencerGlobalRow'),
      setPlaybackSeconds: s.setter('playbackSeconds'),
      setPlaybackRowFraction: s.setter('playbackRowFraction'),
      setTotalPatternRows: s.setter('totalPatternRows'),
      setChannelStates: s.setter('channelStates'),
      setBeatPhase: s.setter('beatPhase'),
      setSyncDebug: s.setter('syncDebug'),
      setIsReady: s.setter('isReady'),
      setIsWorkletSupported: s.setter('isWorkletSupported'),
      setWorkletLoadError: s.setter('workletLoadError'),
    };

    const transportDeps: TransportActionsDeps = {
      refs: this.refs,
      setters: this.setters,
      transport: this.transport,
    };
    this.stopFn = createStopMusic(transportDeps);
    this.pauseFn = createPauseMusic(transportDeps);
    this.resumeFn = createResumeMusic(transportDeps);
    this.seekFn = createSeekToStep(transportDeps);
    this.requestOscBufferFn = createRequestOscBuffer(this.refs);

    this.processModuleDataFn = createProcessModuleData({
      refs: this.refs,
      setters: this.setters,
      stopMusic: (destroy) => this.stopFn(destroy),
      transport: this.transport,
    });
    this.loadModuleFn = createLoadModule(this.refs, this.setters.setStatus, this.processModuleDataFn);
    this.refs.ensureMainThreadModuleRef.current = createEnsureMainThreadModule(this.refs);

    this.updateUIFn = createUpdateUI({
      refs: this.refs,
      setters: this.setters,
      kickTrigger: 0,
      grooveAmount: 0,
    });
    this.refs.updateUIRef.current = this.updateUIFn;
    this.refs.playRef.current = (playOptions) => this.play(playOptions);

    this.callbacks = {
      setStatus: this.setters.setStatus,
      setIsPlaying: (rendering) => {
        if (rendering) this.onEngineStarted();
        else this.onEngineFaulted();
      },
      setModuleInfo: this.setters.setModuleInfo,
      setSequencerMatrix: this.setters.setSequencerMatrix,
      stopMusic: (destroy) => this.stopFn(destroy),
      seekToStepWrapper: (step) => this.seekFn(step),
      updateUI: () => this.updateUIFn(),
      prepareAudioContext: (ctx) => this.output.attach(ctx),
    };
  }

  // ── store (useSyncExternalStore) ───────────────────────────────────────────────────────────────

  readonly getSnapshot = (): PlayerSnapshot => this.store.getSnapshot();
  readonly subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener);

  // ── high-rate state: stable objects, mutated in place, never in the snapshot (pitfall 9) ──────

  get playbackStateRef(): Ref<PlaybackState> {
    return this.refs.playbackStateRef;
  }
  get channelStatesRef(): Ref<ChannelShadowState[]> {
    return this.refs.channelStatesRef;
  }
  get oscBufferRef(): Ref<Float32Array | null> {
    return this.refs.oscBufferRef;
  }
  get audioReactiveRef(): Ref<Float32Array | null> {
    return this.refs.audioReactiveRef;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────────────────────────

  /** Wait for libopenmpt, probe the engines, then load the default module (unless a share link or the user loads one). */
  async init(): Promise<void> {
    const generation = ++this.generation;
    const isCancelled = () => generation !== this.generation;
    await runLibOpenMPTInit({
      refs: this.refs,
      setters: this.setters,
      checkWorkletSupport: isAudioWorkletSupported,
      verifyWorkletFile,
      isCancelled,
    });
    if (isCancelled() || !this.store.getSnapshot().isReady) return;
    if (!this.refs.userModuleLoadedRef.current && !hasShareModuleIntent()) {
      await this.loadDefaultModule();
    }
  }

  /** Tear everything down (unmount). The engine can be init()ed again afterwards (StrictMode, HMR). */
  dispose(): void {
    this.generation += 1;
    this.stopFn(false);
    this.output.detach();
    cleanupLibOpenMPT(this.refs);
    this.store.patch({ analyserNode: null, ...this.output.idleState() });
  }

  private async loadDefaultModule(): Promise<void> {
    const fileName = DEFAULT_MODULE_URL.split('/').pop() || 'default.mod';
    this.setters.setStatus(`Fetching "${fileName}"...`);
    try {
      const response = await fetch(DEFAULT_MODULE_URL);
      if (!response.ok) throw new Error(`Failed to fetch module: ${response.statusText}`);
      const fileData = new Uint8Array(await response.arrayBuffer());
      // The user may have dropped a file while this was downloading.
      if (this.refs.userModuleLoadedRef.current) return;
      await this.processModuleDataFn(fileData, fileName);
    } catch (e) {
      console.error('Failed to load default module:', e);
      this.setters.setStatus('Error fetching default module. See console.');
    }
  }

  // ── transport ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Play from the start when stopped / ready, resume when paused (`playShouldResume`). A module load
   * passes `forceModuleLoad`: it (re)loads the engine — under a paused transport that is the cued
   * module's engine load, and the transport stays paused.
   */
  async play(options?: { forceModuleLoad?: boolean }): Promise<void> {
    if (playShouldResume(this.transport.isPaused, options)) {
      this.resumeFn();
      return;
    }
    const cueing = this.transport.isPaused;
    if (!cueing) {
      if (this.transport.can('start')) {
        this.transport.send('start');
      } else if (!this.transport.isPlaying) {
        // idle (no module) or loading (a parse or an engine start is already in flight).
        log.log(`play ignored while ${this.transport.phase}`);
        return;
      }
      // Already playing: the start path re-pokes the node and resumes the context.
    }
    const result = await this.startAudio(this.refs, this.callbacks, this.audioConfig(options));
    this.store.patch({ analyserNode: this.refs.analyserRef.current });
    if (result === 'failed' && this.transport.phase === 'loading' && !this.transport.holdPaused) {
      this.transport.send('startFailed');
    }
    this.requestOscBufferFn();
  }

  pause(): void {
    this.pauseFn();
  }

  resume(): void {
    this.resumeFn();
  }

  /** Space / MIDI note 60 / the play button: pause while playing, otherwise play-or-resume. */
  togglePlayPause(): void {
    if (this.transport.isPlaying) this.pauseFn();
    else void this.play();
  }

  stop(destroy = false): void {
    this.stopFn(destroy);
  }

  seekToStep(step: number): void {
    this.seekFn(step);
  }

  /** Global step of the first row of `order` (orders can have different pattern lengths). */
  stepOfOrder(order: number): number {
    const matrices = this.refs.patternMatricesRef.current;
    let step = 0;
    for (let o = 0; o < order && o < matrices.length; o++) step += matrices[o]?.numRows ?? 64;
    return step;
  }

  jumpToOrder(order: number): void {
    const last = Math.max(0, this.refs.patternMatricesRef.current.length - 1);
    this.seekFn(this.stepOfOrder(clamp(Math.floor(order), 0, last)));
  }

  /** Move `delta` rows from the live playhead (the ref the GPU reads, not the 10 Hz snapshot). */
  seekRows(delta: number): void {
    const playhead = Math.floor(this.refs.playbackStateRef.current.playheadRow);
    const order = this.refs.playbackStateRef.current.currentOrder;
    this.seekFn(Math.max(0, this.stepOfOrder(order) + playhead + delta));
  }

  seekOrders(delta: number): void {
    this.jumpToOrder(this.refs.playbackStateRef.current.currentOrder + delta);
  }

  // ── master levels (the GainNode owns volume — pitfall 16) ─────────────────────────────────────

  setMasterVolume(action: SetStateAction<number>): void {
    const previous = this.store.getSnapshot().volume;
    const next = clamp(typeof action === 'function' ? action(previous) : action, 0, 1);
    this.store.patch({ volume: next });
    this.applyLevels();
  }

  setMasterPan(action: SetStateAction<number>): void {
    const previous = this.store.getSnapshot().pan;
    const next = clamp(typeof action === 'function' ? action(previous) : action, -1, 1);
    this.store.patch({ pan: next });
    this.applyLevels();
  }

  toggleMute(): void {
    const { isMuted, volume } = this.store.getSnapshot();
    if (isMuted) {
      this.store.patch({ isMuted: false });
      this.setMasterVolume(this.preMuteVolume > 0 ? this.preMuteVolume : DEFAULT_VOLUME);
    } else {
      this.preMuteVolume = volume;
      this.store.patch({ isMuted: true });
      this.setMasterVolume(0);
    }
  }

  setLooping(action: SetStateAction<boolean>): void {
    const previous = this.store.getSnapshot().isLooping;
    const next = typeof action === 'function' ? action(previous) : action;
    this.store.patch({ isLooping: next });
    // The JS worklet's `ended` handler and the ScriptProcessor read the live value (audioConfig).
  }

  private applyLevels(): void {
    const { volume, pan } = this.store.getSnapshot();
    applyMasterLevels(this.refs, volume, pan);
  }

  // ── output device (setSinkId on the one AudioContext — pitfall 12) ────────────────────────────

  /**
   * Play through `deviceId` (`''` = the system default) and remember the choice for this browser.
   * Moves the live context with `setSinkId()` — never a new context, never a suspend — or, before
   * the first play, stores the choice for the context the start path is about to create. Resolves
   * false when the browser refuses (the previous device keeps playing; `sinkError` says why).
   */
  setOutputDevice(deviceId: string, label?: string): Promise<boolean> {
    return this.output.select(deviceId, label);
  }

  /**
   * The output moved (our switch, the browser's, a lost device). Output latency belongs to the device:
   * drop the heard-time jitter hold (the new device's timestamps may step back legitimately) and
   * re-anchor the drift detector the way suspend recovery does (hooks/useAudioGraph.ts) — the latter
   * only while a play has anchored it (stop zeroes the anchor).
   */
  private onSinkMoved(ctx: AudioContext): void {
    resetAudioHeardTime(ctx);
    if (this.refs.audioClockStartRef.current <= 0) return;
    this.refs.audioClockStartRef.current = ctx.currentTime;
    this.refs.workletTimeAtStartRef.current = this.refs.workletTimeRef.current || 0;
    this.refs.driftAccumulatorRef.current = 0;
  }

  // ── channels, misc ────────────────────────────────────────────────────────────────────────────

  toggleChannelMute(channelIndex: number): void {
    const previous = this.store.getSnapshot().channelStates;
    const existing = previous[channelIndex];
    if (!existing) return;
    const next = [...previous];
    const updated = { ...existing, isMuted: (existing.isMuted ?? 0) > 0 ? 0 : 1 };
    next[channelIndex] = updated;
    this.refs.channelStatesRef.current[channelIndex] = updated;
    this.store.patch({ channelStates: next });
  }

  /** Load a user module (drop, playlist, library, share link): parse, then play — or cue, if paused. */
  loadFile(fileData: Uint8Array, fileName: string): Promise<void> {
    return this.loadModuleFn(fileData, fileName);
  }

  /** Swap an edited pattern into the engine's matrices and the snapshot. */
  replacePatternMatrix(matrix: PatternMatrix): void {
    const order = matrix.order;
    const matrices = this.refs.patternMatricesRef.current;
    if (order >= 0 && order < matrices.length) {
      const nextMatrices = [...matrices];
      nextMatrices[order] = matrix;
      this.refs.patternMatricesRef.current = nextMatrices;
    }
    this.store.patch({ sequencerMatrix: matrix });
  }

  getModuleFileData(): Uint8Array | null {
    return this.refs.fileDataRef.current ? this.refs.fileDataRef.current.slice() : null;
  }

  getAudioContext(): AudioContext | null {
    return this.refs.audioContextRef.current;
  }

  /** Post-pan, pre-gain tap for capture (MediaRecorder). */
  getAudioTapNode(): AudioNode | null {
    return this.refs.stereoPannerRef.current ?? this.refs.gainNodeRef.current;
  }

  getMasterGainValue(): number | null {
    return this.refs.gainNodeRef.current?.gain.value ?? null;
  }

  getMasterPanValue(): number | null {
    return this.refs.stereoPannerRef.current?.pan.value ?? null;
  }

  /** The engine that is really rendering. */
  getPlaybackEngine(): LibOpenMPTRefs['playbackEngineRef']['current'] {
    return this.refs.playbackEngineRef.current;
  }

  requestOscBuffer(): void {
    this.requestOscBufferFn();
  }

  /** How position reports reach the main thread now (#492: the shared ring when isolated), and counts. */
  getPositionPathStats(): { transport: 'ring' | 'message'; samples: number; dropped: number } {
    const ring = this.refs.positionRingRef.current;
    if (ring && ring.node === this.refs.audioWorkletNodeRef.current) {
      return { transport: 'ring', ...ring.stats() };
    }
    return { transport: 'message', samples: 0, dropped: 0 };
  }

  /** Test hook: force the fractional playhead the renderers read (does not move the audio). */
  setPlayheadForTest(row: number): void {
    this.refs.playbackStateRef.current = {
      ...this.refs.playbackStateRef.current,
      playheadRow: row,
      lastUpdateTimestamp: performance.now() / 1000,
    };
    this.store.patch({ playbackRowFraction: row });
  }

  setLiteMode(lite: boolean): void {
    this.refs.audioWorkletNodeRef.current?.port.postMessage(postSetAudioLite(lite));
  }

  dispatch(command: EngineCommand): void {
    switch (command.type) {
      case 'play': void this.play(); return;
      case 'pause': this.pause(); return;
      case 'togglePlayPause': this.togglePlayPause(); return;
      case 'stop': this.stop(false); return;
      case 'seekToStep': this.seekToStep(command.step); return;
      case 'seekRows': this.seekRows(command.delta); return;
      case 'seekOrders': this.seekOrders(command.delta); return;
      case 'jumpToOrder': this.jumpToOrder(command.order); return;
      case 'setVolume': this.setMasterVolume(command.value); return;
      case 'nudgeVolume': this.setMasterVolume((v) => v + command.delta); return;
      case 'setPan': this.setMasterPan(command.value); return;
      case 'toggleMute': this.toggleMute(); return;
      case 'setLooping': this.setLooping(command.value); return;
      case 'toggleLoop': this.setLooping((l) => !l); return;
      case 'toggleChannelMute': this.toggleChannelMute(command.channel); return;
      default: {
        const exhaustive: never = command;
        throw new Error(`unknown engine command ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  // ── engine reports (asynchronous; may be stale) ───────────────────────────────────────────────

  /**
   * An engine start path reports it is rendering. The JS worklet does so from its `loaded` ack,
   * after several awaits — by which time the user may have stopped. A report that no
   * longer fits the transport is stale: the engine that sent it is silenced instead of letting it
   * flip the transport back to playing (the #329 class of bug).
   */
  private onEngineStarted(): void {
    const target = this.refs.playbackEngineRef.current === 'scriptprocessor' ? 'spFallback' : 'playing';
    if (this.transport.can('started', target)) {
      this.transport.send('started', target);
      return;
    }
    const phase = this.transport.phase;
    console.warn(`[Engine] stale engine start while ${phase} — silencing it`);
    if (this.transport.isPaused) this.silenceRenderingEngine();
    else this.stopFn(false);
  }

  /** The worklet crashed (handleWorkletFault). Recovery — restart, then the ScriptProcessor — starts at once. */
  private onEngineFaulted(): void {
    const phase = this.transport.phase;
    if (phase === 'paused') {
      // Repaired in the background; the restarted node comes up paused (#456).
      this.transport.send('fault');
      return;
    }
    if (this.transport.can('fault')) {
      this.transport.send('fault');
      this.transport.send('recover');
      return;
    }
    log.log(`worklet fault reported while ${phase} — nothing to recover`);
  }

  /** Pause whichever engine renders, without a transport change (used for a stale start under a pause). */
  private silenceRenderingEngine(): void {
    const engine = this.refs.playbackEngineRef.current;
    if (engine === 'worklet') {
      try { this.refs.audioWorkletNodeRef.current?.port.postMessage(postPause()); } catch { /* torn down */ }
    }
    // 'scriptprocessor' renders silence by itself while the transport is paused.
  }

  /** Start-path config whose fields read live state (see AudioGraphConfig). */
  private audioConfig(options?: { forceModuleLoad?: boolean }): AudioGraphConfig {
    const store = this.store;
    return {
      get isWorkletSupported() { return store.getSnapshot().isWorkletSupported; },
      get panValue() { return store.getSnapshot().pan; },
      get volume() { return store.getSnapshot().volume; },
      get isLooping() { return store.getSnapshot().isLooping; },
      WORKLET_URL,
      ...(options?.forceModuleLoad ? { forceModuleLoad: true } : {}),
    };
  }
}
