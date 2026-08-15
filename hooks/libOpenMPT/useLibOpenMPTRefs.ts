import { useRef } from 'react';
import type { ChannelShadowState, PlaybackState } from '../../types';
import type { OpenMPTWorkletEngine } from '../../audio-worklet/OpenMPTWorkletEngine';
import { rowsPerSecondFromBpm } from '../../utils/playheadPrediction';
import {
  createPlayheadLagTracker,
  createPositionReportTracker,
} from '../../utils/playheadLagMonitor';
import type { NativeClockAnchor } from '../../utils/nativeClockAnchor';
import type { LibOpenMPTRefs } from './types';

export function useLibOpenMPTRefs(): LibOpenMPTRefs {
  const libopenmptRef = useRef<import('../../types').LibOpenMPT | null>(null);
  const currentModulePtr = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const spLeftBufPtr = useRef<number>(0);
  const spRightBufPtr = useRef<number>(0);
  const spFallbackTriggered = useRef<boolean>(false);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const wasmMemoryRef = useRef<WebAssembly.Memory | null>(null);
  const stereoPannerRef = useRef<StereoPannerNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const fileDataRef = useRef<Uint8Array | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const parserWorkerHealthyRef = useRef(true);
  const ensureMainThreadModuleRef = useRef<((data: Uint8Array) => Promise<void>) | null>(null);
  const animationFrameHandle = useRef<number>(0);
  const lastUpdateTimeRef = useRef<number>(0);
  const workletOrderRef = useRef<number>(0);
  const workletRowRef = useRef<number>(0);
  const workletTimeRef = useRef<number>(0);
  const workletTimestampRef = useRef<number>(0);
  const workletBpmRef = useRef<number>(125);
  const workletSpeedRef = useRef<number>(6);
  const workletRowsPerSecRef = useRef<number>(rowsPerSecondFromBpm(125));
  const workletPositionSampleRef = useRef<import('../../utils/playheadPrediction').WorkletPositionSample | null>(null);
  const lastWorkletUpdateRef = useRef<number>(0);
  const audioClockStartRef = useRef<number>(0);
  const workletTimeAtStartRef = useRef<number>(0);
  const driftAccumulatorRef = useRef<number>(0);
  const lastCorrectedTimeRef = useRef<number>(0);
  const pendingSeekRef = useRef<{ order: number; row: number; timestamp: number } | null>(null);
  const seekAcknowledgedRef = useRef<boolean>(true);
  const patternMatricesRef = useRef<(import('../../types').PatternMatrix | null)[]>([]);
  const patternBackfillAbortRef = useRef<AbortController | null>(null);
  const channelStatesRef = useRef<ChannelShadowState[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const playRef = useRef<((options?: { forceModuleLoad?: boolean }) => Promise<void>) | null>(null);
  const workletLoadedRef = useRef<boolean>(false);
  const workletModuleTokenRef = useRef<number>(0);
  const lastWorkletModuleTokenSentRef = useRef<number>(-1);
  const playheadLagTrackerRef = useRef(createPlayheadLagTracker());
  const positionReportTrackerRef = useRef(createPositionReportTracker());
  const lastPositionSampleTimeRef = useRef<number>(-1);
  const updateUIRef = useRef<(() => void) | null>(null);
  const uiLoopActiveRef = useRef<boolean>(false);
  const lastUiOrderRef = useRef<number>(-1);
  const lastUiRowIntRef = useRef<number>(-1);
  const lastUiBpmRef = useRef<number>(-1);
  const lastSyncDebugUiMsRef = useRef<number>(0);
  const lastChannelStatePublishMsRef = useRef<number>(0);
  const noteAgesScratchRef = useRef<number[]>([]);
  const userModuleLoadedRef = useRef<boolean>(false);
  const nativeEngineRef = useRef<OpenMPTWorkletEngine | null>(null);
  const nativeSharedBufferRef = useRef<SharedArrayBuffer | null>(null);
  const nativeClockAnchorRef = useRef<NativeClockAnchor | null>(null);
  const nativeBridgeLatencyRef = useRef<number>(0);
  const oscBufferRef = useRef<Float32Array | null>(null);
  const audioReactiveRef = useRef<Float32Array | null>(null);
  const playbackStateRef = useRef<PlaybackState>({
    playheadRow: 0,
    currentOrder: 0,
    timeSec: 0,
    beatPhase: 0,
    kickTrigger: 0,
    grooveAmount: 0.5,
    lastUpdateTimestamp: 0,
  });

  return {
    libopenmptRef,
    currentModulePtr,
    audioContextRef,
    scriptProcessorRef,
    spLeftBufPtr,
    spRightBufPtr,
    spFallbackTriggered,
    audioWorkletNodeRef,
    wasmMemoryRef,
    stereoPannerRef,
    gainNodeRef,
    analyserRef,
    fileDataRef,
    workerRef,
    parserWorkerHealthyRef,
    ensureMainThreadModuleRef,
    animationFrameHandle,
    lastUpdateTimeRef,
    workletOrderRef,
    workletRowRef,
    workletTimeRef,
    workletTimestampRef,
    workletBpmRef,
    workletSpeedRef,
    workletRowsPerSecRef,
    workletPositionSampleRef,
    lastWorkletUpdateRef,
    audioClockStartRef,
    workletTimeAtStartRef,
    driftAccumulatorRef,
    lastCorrectedTimeRef,
    pendingSeekRef,
    seekAcknowledgedRef,
    patternMatricesRef,
    patternBackfillAbortRef,
    channelStatesRef,
    isPlayingRef,
    playRef,
    workletLoadedRef,
    workletModuleTokenRef,
    lastWorkletModuleTokenSentRef,
    playheadLagTrackerRef,
    positionReportTrackerRef,
    lastPositionSampleTimeRef,
    updateUIRef,
    uiLoopActiveRef,
    lastUiOrderRef,
    lastUiRowIntRef,
    lastUiBpmRef,
    lastSyncDebugUiMsRef,
    lastChannelStatePublishMsRef,
    noteAgesScratchRef,
    userModuleLoadedRef,
    nativeEngineRef,
    nativeSharedBufferRef,
    nativeClockAnchorRef,
    nativeBridgeLatencyRef,
    oscBufferRef,
    audioReactiveRef,
    playbackStateRef,
  };
}
