import type {
  ChannelShadowState,
  LibOpenMPT,
  ModuleInfo,
  PatternMatrix,
  PlaybackState,
  SyncDebugInfo,
} from '../../types';
import type { InstrumentTable } from '../../types/instruments';
import type { OpenMPTWorkletEngine } from '../../audio-worklet/OpenMPTWorkletEngine';
import type { Ref, StateSetter } from '../../audio/engine/store';
import type { TransportMachine } from '../../audio/engine/transport';
import type { WorkletPositionSample } from '../../utils/playheadPrediction';
import type { NativeClockAnchor } from '../../utils/nativeClockAnchor';
import type { PauseClock } from '../../utils/transportClock';
import type {
  PlayheadLagTracker,
  PositionReportTracker,
} from '../../utils/playheadLagMonitor';

export type PlaybackEngine = 'worklet' | 'native-worklet' | 'scriptprocessor';

/**
 * The engine's mutable state, shared with the action factories and the start paths (#492: owned by
 * `audio/engine/PlayerEngine.ts`, built by `audio/engine/engineRefs.ts`; it used to be ~63 React refs).
 *
 * Several members are *views*, not storage — see engineRefs.ts: `isPlayingRef` / `isPausedRef` read
 * the transport FSM, `seekAcknowledgedRef` reads `pendingSeekRef`, `spFallbackTriggered` reads
 * `playbackEngineRef`, `workletLoadedRef` is keyed to the AudioContext, `activeEngineRef` reads the
 * snapshot. Unit tests hand the factories plain `{ current }` objects instead, which is why the
 * factories keep the ref shape.
 */
export interface LibOpenMPTRefs {
  libopenmptRef: Ref<LibOpenMPT | null>;
  currentModulePtr: Ref<number>;
  audioContextRef: Ref<AudioContext | null>;
  scriptProcessorRef: Ref<ScriptProcessorNode | null>;
  spLeftBufPtr: Ref<number>;
  spRightBufPtr: Ref<number>;
  /** View: the ScriptProcessor fallback owns playback (`playbackEngineRef === 'scriptprocessor'`). */
  spFallbackTriggered: Ref<boolean>;
  audioWorkletNodeRef: Ref<AudioWorkletNode | null>;
  masterInputRef: Ref<GainNode | null>;
  masterDirectRef: Ref<GainNode | null>;
  stereoPannerRef: Ref<StereoPannerNode | null>;
  gainNodeRef: Ref<GainNode | null>;
  analyserRef: Ref<AnalyserNode | null>;
  fileDataRef: Ref<Uint8Array | null>;
  workerRef: Ref<Worker | null>;
  parserWorkerHealthyRef: Ref<boolean>;
  ensureMainThreadModuleRef: Ref<((data: Uint8Array) => Promise<void>) | null>;
  animationFrameHandle: Ref<number>;
  workletOrderRef: Ref<number>;
  workletRowRef: Ref<number>;
  workletTimeRef: Ref<number>;
  workletTimestampRef: Ref<number>;
  workletBpmRef: Ref<number>;
  workletSpeedRef: Ref<number>;
  workletRowsPerSecRef: Ref<number>;
  workletPositionSampleRef: Ref<WorkletPositionSample | null>;
  lastWorkletUpdateRef: Ref<number>;
  audioClockStartRef: Ref<number>;
  workletTimeAtStartRef: Ref<number>;
  driftAccumulatorRef: Ref<number>;
  lastCorrectedTimeRef: Ref<number>;
  pendingSeekRef: Ref<{ order: number; row: number; timestamp: number } | null>;
  /** View: `pendingSeekRef.current === null`; writing `true` clears the pending seek. */
  seekAcknowledgedRef: Ref<boolean>;
  patternMatricesRef: Ref<(PatternMatrix | null)[]>;
  patternBackfillAbortRef: Ref<AbortController | null>;
  /** Live per-channel state the GPU reads every frame; mutated in place (pitfall 9). */
  channelStatesRef: Ref<ChannelShadowState[]>;
  /** View of the transport FSM: an engine is rendering. Writes are ignored — see engineRefs.ts. */
  isPlayingRef: Ref<boolean>;
  /** View of the transport FSM: paused (or cueing a module while paused). Writes are ignored. */
  isPausedRef: Ref<boolean>;
  /** Audio-clock instants of the last pause / resume — see utils/transportClock.ts. */
  pauseClockRef: Ref<PauseClock>;
  playRef: Ref<((options?: { forceModuleLoad?: boolean }) => Promise<void>) | null>;
  /** View: `audioWorklet.addModule` resolved on the current AudioContext (kept per context). */
  workletLoadedRef: Ref<boolean>;
  workletModuleTokenRef: Ref<number>;
  lastWorkletModuleTokenSentRef: Ref<number>;
  playheadLagTrackerRef: Ref<PlayheadLagTracker>;
  positionReportTrackerRef: Ref<PositionReportTracker>;
  lastPositionSampleTimeRef: Ref<number>;
  updateUIRef: Ref<(() => void) | null>;
  lastUiOrderRef: Ref<number>;
  lastUiRowIntRef: Ref<number>;
  lastUiBpmRef: Ref<number>;
  lastSyncDebugUiMsRef: Ref<number>;
  lastChannelStatePublishMsRef: Ref<number>;
  noteAgesScratchRef: Ref<number[]>;
  userModuleLoadedRef: Ref<boolean>;
  nativeEngineRef: Ref<OpenMPTWorkletEngine | null>;
  /** View of the snapshot's engine *selection* (what the toggle says). */
  activeEngineRef: Ref<'worklet' | 'native-worklet'>;
  /**
   * The engine that actually started the current playback, written by the engine start paths and
   * cleared by stop. Unlike activeEngineRef (selection state, which still says native after a failed
   * native start fell back to the JS worklet) this is what pause/resume must drive.
   */
  playbackEngineRef: Ref<PlaybackEngine | null>;
  /** Maps native frame clock → main heard-time for playhead prediction. */
  nativeClockAnchorRef: Ref<NativeClockAnchor | null>;
  /** Bridge latency estimate (ring vs MediaStream) for clock anchor. */
  nativeBridgeLatencyRef: Ref<number>;
  oscBufferRef: Ref<Float32Array | null>;
  audioReactiveRef: Ref<Float32Array | null>;
  playbackStateRef: Ref<PlaybackState>;
}

/**
 * Snapshot setters the factories write through (PlayerEngine binds them to its store). The transport
 * flags are not here: `isPlaying` / `isPaused` are derived from the FSM.
 */
export interface LibOpenMPTSetters {
  setStatus: StateSetter<string>;
  setIsModuleLoaded: StateSetter<boolean>;
  setModuleInfo: StateSetter<ModuleInfo>;
  setSequencerMatrix: StateSetter<PatternMatrix | null>;
  setInstrumentNames: StateSetter<string[]>;
  setSampleNames: StateSetter<string[]>;
  setModuleFormat: StateSetter<string>;
  setInstrumentTable: StateSetter<InstrumentTable>;
  setModuleComments: StateSetter<string>;
  setModuleDurationSeconds: StateSetter<number>;
  setModuleFileName: StateSetter<string>;
  setSequencerCurrentRow: StateSetter<number>;
  setSequencerGlobalRow: StateSetter<number>;
  setPlaybackSeconds: StateSetter<number>;
  setPlaybackRowFraction: StateSetter<number>;
  setTotalPatternRows: StateSetter<number>;
  setChannelStates: StateSetter<ChannelShadowState[]>;
  setBeatPhase: StateSetter<number>;
  setSyncDebug: StateSetter<SyncDebugInfo>;
  setIsReady: StateSetter<boolean>;
  setIsWorkletSupported: StateSetter<boolean>;
  setIsNativeWorkletAvailable: StateSetter<boolean>;
  setActiveEngine: StateSetter<'worklet' | 'native-worklet'>;
  setWorkletLoadError: StateSetter<string | null>;
}

/** The slice of the transport FSM the action factories drive. */
export type TransportPort = Pick<
  TransportMachine,
  'send' | 'can' | 'phase' | 'isPlaying' | 'isPaused'
>;

export interface UpdateUIParams {
  refs: LibOpenMPTRefs;
  setters: Pick<
    LibOpenMPTSetters,
    | 'setModuleInfo'
    | 'setSequencerMatrix'
    | 'setSequencerCurrentRow'
    | 'setSequencerGlobalRow'
    | 'setPlaybackSeconds'
    | 'setPlaybackRowFraction'
    | 'setChannelStates'
    | 'setBeatPhase'
    | 'setSyncDebug'
  >;
  /** Read on every frame — PlayerEngine passes a getter onto its snapshot. */
  activeEngine: 'worklet' | 'native-worklet';
  kickTrigger: number;
  grooveAmount: number;
}
