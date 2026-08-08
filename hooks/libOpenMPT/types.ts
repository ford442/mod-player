import type React from 'react';
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
import type { WorkletPositionSample } from '../../utils/playheadPrediction';
import type {
  PlayheadLagTracker,
  PositionReportTracker,
} from '../../utils/playheadLagMonitor';

/** All mutable refs owned by useLibOpenMPT — passed to extracted action factories. */
export interface LibOpenMPTRefs {
  libopenmptRef: React.MutableRefObject<LibOpenMPT | null>;
  currentModulePtr: React.MutableRefObject<number>;
  audioContextRef: React.MutableRefObject<AudioContext | null>;
  scriptProcessorRef: React.MutableRefObject<ScriptProcessorNode | null>;
  spLeftBufPtr: React.MutableRefObject<number>;
  spRightBufPtr: React.MutableRefObject<number>;
  spFallbackTriggered: React.MutableRefObject<boolean>;
  audioWorkletNodeRef: React.MutableRefObject<AudioWorkletNode | null>;
  wasmMemoryRef: React.MutableRefObject<WebAssembly.Memory | null>;
  stereoPannerRef: React.MutableRefObject<StereoPannerNode | null>;
  gainNodeRef: React.MutableRefObject<GainNode | null>;
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  fileDataRef: React.MutableRefObject<Uint8Array | null>;
  workerRef: React.MutableRefObject<Worker | null>;
  parserWorkerHealthyRef: React.MutableRefObject<boolean>;
  ensureMainThreadModuleRef: React.MutableRefObject<((data: Uint8Array) => Promise<void>) | null>;
  animationFrameHandle: React.MutableRefObject<number>;
  lastUpdateTimeRef: React.MutableRefObject<number>;
  workletOrderRef: React.MutableRefObject<number>;
  workletRowRef: React.MutableRefObject<number>;
  workletTimeRef: React.MutableRefObject<number>;
  workletTimestampRef: React.MutableRefObject<number>;
  workletBpmRef: React.MutableRefObject<number>;
  workletSpeedRef: React.MutableRefObject<number>;
  workletRowsPerSecRef: React.MutableRefObject<number>;
  workletPositionSampleRef: React.MutableRefObject<WorkletPositionSample | null>;
  lastWorkletUpdateRef: React.MutableRefObject<number>;
  audioClockStartRef: React.MutableRefObject<number>;
  workletTimeAtStartRef: React.MutableRefObject<number>;
  driftAccumulatorRef: React.MutableRefObject<number>;
  lastCorrectedTimeRef: React.MutableRefObject<number>;
  pendingSeekRef: React.MutableRefObject<{ order: number; row: number; timestamp: number } | null>;
  seekAcknowledgedRef: React.MutableRefObject<boolean>;
  patternMatricesRef: React.MutableRefObject<(PatternMatrix | null)[]>;
  patternBackfillAbortRef: React.MutableRefObject<AbortController | null>;
  channelStatesRef: React.MutableRefObject<ChannelShadowState[]>;
  isPlayingRef: React.MutableRefObject<boolean>;
  playRef: React.MutableRefObject<((options?: { forceModuleLoad?: boolean }) => Promise<void>) | null>;
  workletLoadedRef: React.MutableRefObject<boolean>;
  workletModuleTokenRef: React.MutableRefObject<number>;
  lastWorkletModuleTokenSentRef: React.MutableRefObject<number>;
  playheadLagTrackerRef: React.MutableRefObject<PlayheadLagTracker>;
  positionReportTrackerRef: React.MutableRefObject<PositionReportTracker>;
  lastPositionSampleTimeRef: React.MutableRefObject<number>;
  updateUIRef: React.MutableRefObject<(() => void) | null>;
  uiLoopActiveRef: React.MutableRefObject<boolean>;
  lastUiOrderRef: React.MutableRefObject<number>;
  lastUiRowIntRef: React.MutableRefObject<number>;
  lastUiBpmRef: React.MutableRefObject<number>;
  lastSyncDebugUiMsRef: React.MutableRefObject<number>;
  noteAgesScratchRef: React.MutableRefObject<number[]>;
  userModuleLoadedRef: React.MutableRefObject<boolean>;
  nativeEngineRef: React.MutableRefObject<OpenMPTWorkletEngine | null>;
  nativeSharedBufferRef: React.MutableRefObject<SharedArrayBuffer | null>;
  oscBufferRef: React.MutableRefObject<Float32Array | null>;
  audioReactiveRef: React.MutableRefObject<Float32Array | null>;
  playbackStateRef: React.MutableRefObject<PlaybackState>;
}

export interface LibOpenMPTSetters {
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setIsModuleLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  setModuleInfo: React.Dispatch<React.SetStateAction<ModuleInfo>>;
  setSequencerMatrix: React.Dispatch<React.SetStateAction<PatternMatrix | null>>;
  setInstrumentNames: React.Dispatch<React.SetStateAction<string[]>>;
  setInstrumentTable: React.Dispatch<React.SetStateAction<InstrumentTable>>;
  setModuleComments: React.Dispatch<React.SetStateAction<string>>;
  setModuleDurationSeconds: React.Dispatch<React.SetStateAction<number>>;
  setModuleFileName: React.Dispatch<React.SetStateAction<string>>;
  setSequencerCurrentRow: React.Dispatch<React.SetStateAction<number>>;
  setSequencerGlobalRow: React.Dispatch<React.SetStateAction<number>>;
  setPlaybackSeconds: React.Dispatch<React.SetStateAction<number>>;
  setPlaybackRowFraction: React.Dispatch<React.SetStateAction<number>>;
  setTotalPatternRows: React.Dispatch<React.SetStateAction<number>>;
  setChannelStates: React.Dispatch<React.SetStateAction<ChannelShadowState[]>>;
  setBeatPhase: React.Dispatch<React.SetStateAction<number>>;
  setSyncDebug: React.Dispatch<React.SetStateAction<SyncDebugInfo>>;
  setIsReady: React.Dispatch<React.SetStateAction<boolean>>;
  setIsWorkletSupported: React.Dispatch<React.SetStateAction<boolean>>;
  setIsNativeWorkletAvailable: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveEngine: React.Dispatch<React.SetStateAction<'worklet' | 'native-worklet'>>;
  setWorkletLoadError: React.Dispatch<React.SetStateAction<string | null>>;
}

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
  activeEngine: 'worklet' | 'native-worklet';
  kickTrigger: number;
  grooveAmount: number;
}
