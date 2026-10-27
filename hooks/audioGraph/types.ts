import type { LibOpenMPT, PatternMatrix, ChannelShadowState, ModuleInfo } from '../../types';
import type { OpenMPTWorkletEngine } from '../../audio-worklet/OpenMPTWorkletEngine';
import type { Ref, StateSetter } from '../../audio/engine/store';
import type { WorkletPositionSample } from '../../utils/playheadPrediction';
import type { PositionRingConsumer } from '../../utils/positionRingConsumer';
import type { NativeClockAnchor } from '../../utils/nativeClockAnchor';

/**
 * What the engine start paths read and write. PlayerEngine passes its own refs bag (a superset; see
 * hooks/libOpenMPT/types.ts for which members are FSM views), unit tests pass plain `{ current }`s.
 */
export interface AudioGraphRefs {
  libopenmptRef:       Ref<LibOpenMPT | null>;
  fileDataRef:         Ref<Uint8Array | null>;
  audioContextRef:     Ref<AudioContext | null>;
  workletLoadedRef:    Ref<boolean>;
  /** Unity-gain master input: every engine connects here, never to the analyser (#453). */
  masterInputRef:      Ref<GainNode | null>;
  /** Dry path around the FX rack; its gain belongs to the rack controller (#453). */
  masterDirectRef:     Ref<GainNode | null>;
  stereoPannerRef:     Ref<StereoPannerNode | null>;
  gainNodeRef:         Ref<GainNode | null>;
  analyserRef:         Ref<AnalyserNode | null>;
  audioWorkletNodeRef: Ref<AudioWorkletNode | null>;
  nativeEngineRef:     Ref<OpenMPTWorkletEngine | null>;
  workletOrderRef:     Ref<number>;
  workletRowRef:       Ref<number>;
  workletTimeRef:      Ref<number>;
  workletTimestampRef: Ref<number>;
  lastWorkletUpdateRef: Ref<number>;
  workletBpmRef:       Ref<number>;
  workletSpeedRef:     Ref<number>;
  workletRowsPerSecRef: Ref<number>;
  workletPositionSampleRef: Ref<WorkletPositionSample | null>;
  /**
   * The JS worklet node's shared position ring, when the page is crossOriginIsolated (#492): the
   * worklet writes its position reports there instead of posting them; the UI loop drains it.
   */
  positionRingRef: Ref<PositionRingConsumer | null>;
  pendingSeekRef:      Ref<{ order: number; row: number; timestamp: number } | null>;
  seekAcknowledgedRef: Ref<boolean>;
  spFallbackTriggered: Ref<boolean>;
  scriptProcessorRef:  Ref<ScriptProcessorNode | null>;
  spLeftBufPtr:        Ref<number>;
  spRightBufPtr:       Ref<number>;
  /**
   * Rendering audibly. In PlayerEngine this is a read-only view of the transport FSM: the start paths
   * still assign it (their unit tests drive them with plain refs) and report the change through
   * `callbacks.setIsPlaying`, which is what moves the FSM.
   */
  isPlayingRef:        Ref<boolean>;
  /**
   * Transport is paused (see hooks/libOpenMPT/createTransportActions.ts). Engine start paths read it so
   * a node (re)started while paused — worklet fault recovery, loading a module — comes up paused,
   * and the ScriptProcessor callback reads it to render silence.
   */
  isPausedRef:         Ref<boolean>;
  /** Written by each engine start path: which engine is really rendering (pause/resume drive this one). */
  playbackEngineRef:   Ref<'worklet' | 'native-worklet' | 'scriptprocessor' | null>;
  animationFrameHandle: Ref<number>;
  currentModulePtr:    Ref<number>;
  channelStatesRef:    Ref<ChannelShadowState[]>;
  patternMatricesRef:  Ref<(PatternMatrix | null)[]>;
  audioClockStartRef:  Ref<number>;
  workletTimeAtStartRef: Ref<number>;
  driftAccumulatorRef: Ref<number>;
  updateUIRef:         Ref<(() => void) | null>;
  nativeClockAnchorRef: Ref<NativeClockAnchor | null>;
  nativeBridgeLatencyRef: Ref<number>;
  /** Callback to lazily create a main-thread libopenmpt module for ScriptProcessor fallback. */
  ensureMainThreadModuleRef: Ref<((data: Uint8Array) => Promise<void>) | null>;
  /** Incremented on each processModuleData — guards stale worklet `loaded` acks. */
  workletModuleTokenRef: Ref<number>;
  lastWorkletModuleTokenSentRef: Ref<number>;
}

export interface AudioGraphCallbacks {
  setStatus:         (s: string) => void;
  /**
   * The engine's report to the transport: `true` — it is rendering now; `false` — it stopped
   * rendering on its own because it faulted (handleWorkletFault). PlayerEngine maps these onto the
   * FSM's `started` / `fault` events, and treats a report that no longer fits as stale.
   */
  setIsPlaying:      (v: boolean) => void;
  setActiveEngine:   StateSetter<'worklet' | 'native-worklet'>;
  setModuleInfo:     StateSetter<ModuleInfo>;
  setSequencerMatrix: StateSetter<PatternMatrix | null>;
  stopMusic:         (destroy?: boolean) => void;
  seekToStepWrapper: (step: number) => void;
  updateUI:          () => void;
}

/**
 * Start-path configuration. PlayerEngine hands over an object whose fields are getters onto its live
 * state, so a handler installed at start (the worklet's `ended`, the ScriptProcessor's loop check)
 * sees a loop toggle made during playback instead of the value captured when play() was called.
 */
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

/**
 * What startAudioPlayback did: `pending` — the JS worklet is set up and plays on its `loaded` ack;
 * `started` — the native engine is rendering (or paused, if the transport is); `nudged` — already
 * playing, the node was re-poked; `failed` — nothing will render.
 */
export type AudioStartResult = 'pending' | 'started' | 'nudged' | 'failed';
