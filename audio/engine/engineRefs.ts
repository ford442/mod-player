/**
 * The engine's mutable state bag (#492) — what `hooks/libOpenMPT/useLibOpenMPTRefs.ts` used to build
 * out of ~63 React refs. It is shared, by reference, with the action factories
 * (hooks/libOpenMPT/create*.ts) and the engine start paths (hooks/audioGraph/), which is why it keeps
 * the `{ current }` shape: their unit tests drive them with plain objects.
 *
 * The flags that used to be duplicated — and disagree — are views here, so they cannot drift:
 *
 *   isPlayingRef / isPausedRef  read the transport FSM. The start paths still assign them (for their
 *                               plain-ref tests); those writes are ignored, and the paired
 *                               `callbacks.setIsPlaying(...)` is what moves the FSM.
 *   seekAcknowledgedRef         `pendingSeekRef.current === null`; writing `true` clears the seek.
 *   spFallbackTriggered         `playbackEngineRef.current === 'scriptprocessor'`.
 *   workletLoadedRef            `addModule` resolved on *this* AudioContext — a module loaded into a
 *                               closed context no longer reads as loaded on its successor.
 *   activeEngineRef             the snapshot's engine selection.
 *
 * (`uiLoopActiveRef` is gone: the UI loop runs exactly while the transport is playing or paused.)
 */
import type { PlaybackState } from '../../types';
import type { LibOpenMPTRefs } from '../../hooks/libOpenMPT/types';
import { rowsPerSecondFromBpm } from '../../utils/playheadPrediction';
import {
  createPlayheadLagTracker,
  createPositionReportTracker,
} from '../../utils/playheadLagMonitor';
import { createPauseClock } from '../../utils/transportClock';
import type { Ref } from './store';
import type { TransportMachine } from './transport';

const ref = <T,>(current: T): Ref<T> => ({ current });

/**
 * A number-only ref (#492). Every `{ current }` literal shares one V8 hidden class, and since some
 * refs hold objects, `current` there is a tagged field: each double stored in it allocates a fresh
 * HeapNumber. A class of its own keeps `current` an unboxed double field updated in place, so the
 * position path (several doubles per report, 60 Hz) allocates nothing.
 */
class NumberRef implements Ref<number> {
  // The numeric initializer matters: a bare `current: number;` is emitted as a field defined to
  // `undefined` first (useDefineForClassFields), and V8 then keeps the field tagged.
  current = 0;
  constructor(value: number) {
    this.current = value;
  }
}
const num = (value: number): Ref<number> => new NumberRef(value);

/** A `{ current }` whose value is computed; `write` decides what an assignment means (default: nothing). */
function viewRef<T>(read: () => T, write: (value: T) => void = () => {}): Ref<T> {
  return Object.defineProperty({} as Ref<T>, 'current', {
    get: read,
    set: write,
    enumerable: true,
  });
}

export function createInitialPlaybackState(): PlaybackState {
  return {
    playheadRow: 0,
    currentOrder: 0,
    timeSec: 0,
    beatPhase: 0,
    kickTrigger: 0,
    grooveAmount: 0.5,
    lastUpdateTimestamp: 0,
  };
}

export interface EngineRefSources {
  transport: Pick<TransportMachine, 'isPlaying' | 'isPaused'>;
  activeEngine: () => 'worklet' | 'native-worklet';
}

export function createEngineRefs(sources: EngineRefSources): LibOpenMPTRefs {
  const audioContextRef = ref<AudioContext | null>(null);
  const pendingSeekRef = ref<{ order: number; row: number; timestamp: number } | null>(null);
  const playbackEngineRef = ref<LibOpenMPTRefs['playbackEngineRef']['current']>(null);
  const workletModuleContexts = new WeakSet<BaseAudioContext>();

  return {
    libopenmptRef: ref(null),
    currentModulePtr: num(0),
    audioContextRef,
    scriptProcessorRef: ref(null),
    spLeftBufPtr: num(0),
    spRightBufPtr: num(0),
    spFallbackTriggered: viewRef(() => playbackEngineRef.current === 'scriptprocessor'),
    audioWorkletNodeRef: ref(null),
    masterInputRef: ref(null),
    masterDirectRef: ref(null),
    stereoPannerRef: ref(null),
    gainNodeRef: ref(null),
    analyserRef: ref(null),
    fileDataRef: ref(null),
    workerRef: ref(null),
    parserWorkerHealthyRef: ref(true),
    ensureMainThreadModuleRef: ref(null),
    animationFrameHandle: num(0),
    workletOrderRef: num(0),
    workletRowRef: num(0),
    workletTimeRef: num(0),
    workletTimestampRef: num(0),
    workletBpmRef: num(125),
    workletSpeedRef: num(6),
    workletRowsPerSecRef: num(rowsPerSecondFromBpm(125)),
    workletPositionSampleRef: ref(null),
    positionRingRef: ref(null),
    lastWorkletUpdateRef: num(0),
    audioClockStartRef: num(0),
    workletTimeAtStartRef: num(0),
    driftAccumulatorRef: num(0),
    lastCorrectedTimeRef: num(0),
    pendingSeekRef,
    seekAcknowledgedRef: viewRef(
      () => pendingSeekRef.current === null,
      (acknowledged) => {
        if (acknowledged) pendingSeekRef.current = null;
      },
    ),
    patternMatricesRef: ref([]),
    patternBackfillAbortRef: ref(null),
    channelStatesRef: ref([]),
    isPlayingRef: viewRef(() => sources.transport.isPlaying),
    isPausedRef: viewRef(() => sources.transport.isPaused),
    pauseClockRef: ref(createPauseClock()),
    playRef: ref(null),
    workletLoadedRef: viewRef(
      () => audioContextRef.current != null && workletModuleContexts.has(audioContextRef.current),
      (loaded) => {
        const ctx = audioContextRef.current;
        if (!ctx) return;
        if (loaded) workletModuleContexts.add(ctx);
        else workletModuleContexts.delete(ctx);
      },
    ),
    workletModuleTokenRef: num(0),
    lastWorkletModuleTokenSentRef: num(-1),
    playheadLagTrackerRef: ref(createPlayheadLagTracker()),
    positionReportTrackerRef: ref(createPositionReportTracker()),
    lastPositionSampleTimeRef: num(-1),
    updateUIRef: ref(null),
    lastUiOrderRef: num(-1),
    lastUiRowIntRef: num(-1),
    lastUiBpmRef: num(-1),
    lastSyncDebugUiMsRef: num(0),
    lastChannelStatePublishMsRef: num(0),
    noteAgesScratchRef: ref([]),
    userModuleLoadedRef: ref(false),
    nativeEngineRef: ref(null),
    activeEngineRef: viewRef(sources.activeEngine),
    playbackEngineRef,
    nativeClockAnchorRef: ref(null),
    nativeBridgeLatencyRef: num(0),
    oscBufferRef: ref(null),
    audioReactiveRef: ref(null),
    playbackStateRef: ref(createInitialPlaybackState()),
  };
}
