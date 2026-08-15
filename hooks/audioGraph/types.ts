import type React from 'react';
import type { LibOpenMPT, PatternMatrix, ChannelShadowState, ModuleInfo } from '../../types';
import type { OpenMPTWorkletEngine } from '../../audio-worklet/OpenMPTWorkletEngine';

export interface AudioGraphRefs {
  libopenmptRef:       React.MutableRefObject<LibOpenMPT | null>;
  fileDataRef:         React.MutableRefObject<Uint8Array | null>;
  audioContextRef:     React.MutableRefObject<AudioContext | null>;
  workletLoadedRef:    React.MutableRefObject<boolean>;
  stereoPannerRef:     React.MutableRefObject<StereoPannerNode | null>;
  gainNodeRef:         React.MutableRefObject<GainNode | null>;
  analyserRef:         React.MutableRefObject<AnalyserNode | null>;
  audioWorkletNodeRef: React.MutableRefObject<AudioWorkletNode | null>;
  nativeEngineRef:     React.MutableRefObject<OpenMPTWorkletEngine | null>;
  wasmMemoryRef:       React.MutableRefObject<WebAssembly.Memory | null>;
  workletOrderRef:     React.MutableRefObject<number>;
  workletRowRef:       React.MutableRefObject<number>;
  workletTimeRef:      React.MutableRefObject<number>;
  workletTimestampRef: React.MutableRefObject<number>;
  lastWorkletUpdateRef: React.MutableRefObject<number>;
  workletBpmRef:       React.MutableRefObject<number>;
  workletSpeedRef:     React.MutableRefObject<number>;
  workletRowsPerSecRef: React.MutableRefObject<number>;
  workletPositionSampleRef: React.MutableRefObject<import('../../utils/playheadPrediction').WorkletPositionSample | null>;
  pendingSeekRef:      React.MutableRefObject<{ order: number; row: number; timestamp: number } | null>;
  seekAcknowledgedRef: React.MutableRefObject<boolean>;
  spFallbackTriggered: React.MutableRefObject<boolean>;
  scriptProcessorRef:  React.MutableRefObject<ScriptProcessorNode | null>;
  spLeftBufPtr:        React.MutableRefObject<number>;
  spRightBufPtr:       React.MutableRefObject<number>;
  isPlayingRef:        React.MutableRefObject<boolean>;
  animationFrameHandle: React.MutableRefObject<number>;
  currentModulePtr:    React.MutableRefObject<number>;
  channelStatesRef:    React.MutableRefObject<ChannelShadowState[]>;
  patternMatricesRef:  React.MutableRefObject<(PatternMatrix | null)[]>;
  audioClockStartRef:  React.MutableRefObject<number>;
  workletTimeAtStartRef: React.MutableRefObject<number>;
  driftAccumulatorRef: React.MutableRefObject<number>;
  updateUIRef:         React.MutableRefObject<(() => void) | null>;
  /** SharedArrayBuffer provided to the native engine constructor (may be null in non-isolated contexts). */
  nativeSharedBuffer:  React.MutableRefObject<SharedArrayBuffer | null>;
  nativeClockAnchorRef: React.MutableRefObject<import('../../utils/nativeClockAnchor').NativeClockAnchor | null>;
  nativeBridgeLatencyRef: React.MutableRefObject<number>;
  /** Callback to lazily create a main-thread libopenmpt module for ScriptProcessor fallback. */
  ensureMainThreadModuleRef: React.MutableRefObject<((data: Uint8Array) => Promise<void>) | null>;
  /** Incremented on each processModuleData — guards stale worklet `loaded` acks. */
  workletModuleTokenRef: React.MutableRefObject<number>;
  lastWorkletModuleTokenSentRef: React.MutableRefObject<number>;
}

export interface AudioGraphCallbacks {
  setStatus:         (s: string) => void;
  setIsPlaying:      (v: boolean) => void;
  setActiveEngine:   React.Dispatch<React.SetStateAction<'worklet' | 'native-worklet'>>;
  setModuleInfo:     React.Dispatch<React.SetStateAction<ModuleInfo>>;
  setSequencerMatrix: React.Dispatch<React.SetStateAction<PatternMatrix | null>>;
  stopMusic:         (destroy?: boolean) => void;
  seekToStepWrapper: (step: number) => void;
  updateUI:          () => void;
}

export interface AudioGraphConfig {
  activeEngine:           'worklet' | 'native-worklet';
  isWorkletSupported:     boolean;
  isNativeWorkletAvailable: boolean;
  panValue:               number;
  volume:                 number;
  isLooping:              boolean;
  WORKLET_URL:            string;
  /** Set after processModuleData — always post `load` even if isPlayingRef is still true (#329). */
  forceModuleLoad?:       boolean;
}
