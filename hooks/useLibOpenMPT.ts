import { useState, useEffect, useRef, useCallback } from 'react';
import { LibOpenMPT, ModuleInfo, PatternMatrix, ChannelShadowState, PlaybackState, SyncDebugInfo, WorkerParseError, WorkerParseResponse } from '../types';
import { OpenMPTWorkletEngine, NATIVE_RING_BUF_BYTES } from '../audio-worklet/OpenMPTWorkletEngine';
import { computeNoteAges } from '../utils/patternExtractor';
import { parseModuleWithLib } from '../utils/parseModuleWithLib';
import { parserLog } from '../utils/parserDebug';
import {
  createParserWorker,
  parseInWorker,
  PARSER_SLOW_HINT_MS,
  verifyParserWorkerUrl,
} from '../utils/parserWorker';
import { startAudioPlayback, AudioGraphRefs, AudioGraphCallbacks, AudioGraphConfig } from './useAudioGraph';
import {
  useWorkletLoader,
  getWorkletUrl,
  getNativeGlueUrl,
  getAbsoluteWorkletUrl,
  isNativeGlueAvailable,
  withBase,
} from './useWorkletLoader';
import { logWorkletDiagnostics } from '../audio-worklet/diagnostics';
import {
  getAudioHeardTime,
  predictPlayheadFromSample,
  rowsPerSecondFromBpm,
  type WorkletPositionSample,
} from '../utils/playheadPrediction';
import { hasShareModuleIntent } from '../utils/shareState';


// Use Vite BASE_URL for correct resolution under subdirectory deployment
const DEFAULT_MODULE_URL = withBase('4-mat_madness.mod');

// AUDIO-001 FIX COMPLETE: Use centralized worklet URL construction from useWorkletLoader
const WORKLET_URL = getWorkletUrl();

// AUDIO-001 FIX COMPLETE: Enhanced logging for diagnostics
console.log('[AudioWorklet] Configuration:', {
  workletUrl: WORKLET_URL,
  absoluteWorkletUrl: getAbsoluteWorkletUrl(),
  viteBaseUrl: import.meta.env.BASE_URL,
  currentPath: window.location.pathname,
  origin: window.location.origin,
  crossOriginIsolated: window.crossOriginIsolated,
  hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
  hardwareConcurrency: navigator.hardwareConcurrency,
});

// TIMING FIX: Maximum allowed drift before correction (in seconds)
const MAX_DRIFT_SECONDS = 0.1;
// Worklet: prediction already tracks audio clock — only light EMA to hide
// postMessage jitter (α→1 = less lag). Was 0.88; still a small lag source.
const WORKLET_ROW_SMOOTHING = 0.94;
// ScriptProcessor / direct lib query: near-instant follow
const DIRECT_ROW_SMOOTHING = 0.96;

function isLibReadyForParse(lib: LibOpenMPT): boolean {
  return typeof lib._openmpt_module_create_from_memory2 === 'function';
}

function parseOnMainThread(
  lib: LibOpenMPT,
  fileData: Uint8Array,
  fileName: string,
): WorkerParseResponse {
  parserLog('main-thread parse', fileName, fileData.byteLength);
  const parsed = parseModuleWithLib(lib, fileData, fileName);
  if (!parsed.patternMatrices.length) {
    throw new Error('No pattern data in module');
  }
  console.log(
    `[Parser] main-thread parse OK (${fileName}):`,
    parsed.metadata.numOrders,
    'orders,',
    parsed.patternMatrices.length,
    'matrices',
  );
  return {
    type: 'parsed',
    patternMatrices: parsed.patternMatrices,
    metadata: parsed.metadata,
  };
}

async function resolveParsedModule(
  lib: LibOpenMPT,
  worker: Worker | null,
  workerRefObj: { current: Worker | null },
  fileDataForWorker: Uint8Array,
  fileDataCopy: Uint8Array,
  fileName: string,
  onParseProgress?: (stage: 'fetch' | 'wasm' | 'patterns') => void,
): Promise<WorkerParseResponse> {
  // Main thread already has initialized libopenmpt from index.html — use it directly.
  // The worker re-fetches WASM from CDN (slow, can fail under strict COEP/CORP).
  if (isLibReadyForParse(lib)) {
    onParseProgress?.('patterns');
    return parseOnMainThread(lib, fileDataCopy, fileName);
  }

  let workerResult: WorkerParseResponse | WorkerParseError | null = null;

  if (worker) {
    try {
      workerResult = await parseInWorker(
        worker,
        { type: 'parse', fileData: fileDataForWorker, fileName },
        [fileDataForWorker.buffer],
        onParseProgress,
      );
      if (
        workerResult.type === 'parsed' &&
        workerResult.patternMatrices.length > 0
      ) {
        return workerResult;
      }
      if (workerResult.type === 'error') {
        console.warn(`[Parser] worker error (${fileName}):`, workerResult.message);
      } else {
        console.warn(`[Parser] worker returned empty patternMatrices (${fileName})`);
      }
    } catch (err) {
      console.warn(`[Parser] worker path failed (${fileName}) — main-thread fallback:`, err);
      parserLog('worker failed', fileName, err);
    } finally {
      // The worker is now either hung (timeout terminated it) or in a bad state;
      // discard it so the next load gets a fresh worker.
      if (workerRefObj.current) {
        try { workerRefObj.current.terminate(); } catch { /* ignore */ }
        workerRefObj.current = null;
      }
    }
  }

  return parseOnMainThread(lib, fileDataCopy, fileName);
}

export function useLibOpenMPT(initialVolume: number = 0.4) {
  const [status, setStatus] = useState<string>("Initializing...");
  const [isReady, setIsReady] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isModuleLoaded, setIsModuleLoaded] = useState<boolean>(false);
  const [moduleInfo, setModuleInfo] = useState<ModuleInfo>({ title: "None", order: 0, row: 0, bpm: 125, numChannels: 0 });
  const [patternData, _setPatternData] = useState<Uint8Array | null>(null);
  const [sequencerMatrix, setSequencerMatrix] = useState<PatternMatrix | null>(null);
  const [instrumentNames, setInstrumentNames] = useState<string[]>([]);
  const [moduleComments, setModuleComments] = useState<string>('');
  const [sequencerCurrentRow, setSequencerCurrentRow] = useState<number>(0);
  const [sequencerGlobalRow, setSequencerGlobalRow] = useState<number>(0);
  const [playbackSeconds, setPlaybackSeconds] = useState<number>(0);
  const [playbackRowFraction, setPlaybackRowFraction] = useState<number>(0);
  const [totalPatternRows, setTotalPatternRows] = useState<number>(0);
  const [channelStates, setChannelStates] = useState<ChannelShadowState[]>([]);
  const [beatPhase, setBeatPhase] = useState<number>(0);
  const [grooveAmount, _setGrooveAmount] = useState<number>(0);
  const [kickTrigger, _setKickTrigger] = useState<number>(0);
  const [activeChannels, _setActiveChannels] = useState<number[]>([]);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [panValue, setPanValue] = useState<number>(0); // -1 to 1
  const [volume, _setVolume] = useState<number>(initialVolume); // 0 to 1
  const [activeEngine, setActiveEngine] = useState<'worklet' | 'native-worklet'>('worklet');
  const [isWorkletSupported, setIsWorkletSupported] = useState<boolean>(false);
  const [isNativeWorkletAvailable, setIsNativeWorkletAvailable] = useState<boolean>(false);
  const [restartPlayback, setRestartPlayback] = useState<boolean>(false);
  const [syncDebug, setSyncDebug] = useState<SyncDebugInfo>({
    mode: "none",
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
  });
  
  // AUDIO-001 FIX: Track worklet load errors for UI feedback
  const [workletLoadError, setWorkletLoadError] = useState<string | null>(null);
  
  // AUDIO-001 FIX: Initialize worklet loader with diagnostics
  const { verifyWorkletFile, isAudioWorkletSupported: checkWorkletSupport } = useWorkletLoader({
    debug: true,
  });

  const libopenmptRef = useRef<LibOpenMPT | null>(null);
  const currentModulePtr = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  // ScriptProcessorNode fallback when AudioWorklet WASM init fails (Chrome < 116)
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const spLeftBufPtr = useRef<number>(0);
  const spRightBufPtr = useRef<number>(0);
  const spFallbackTriggered = useRef<boolean>(false);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  // Shared WASM memory supplied to the worklet; allocated once on main thread
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

  // Worklet state tracking
  const workletOrderRef = useRef<number>(0);
  const workletRowRef = useRef<number>(0);
  const workletTimeRef = useRef<number>(0);
  const workletTimestampRef = useRef<number>(0);
  // TIMING FIX: Track worklet BPM for accurate row interpolation
  const workletBpmRef = useRef<number>(125);
  const workletSpeedRef = useRef<number>(6);
  const workletRowsPerSecRef = useRef<number>(rowsPerSecondFromBpm(125));
  const workletPositionSampleRef = useRef<WorkletPositionSample | null>(null);
  const lastWorkletUpdateRef = useRef<number>(0);

  // TIMING FIX: Drift compensation refs
  const audioClockStartRef = useRef<number>(0);
  const workletTimeAtStartRef = useRef<number>(0);
  const driftAccumulatorRef = useRef<number>(0);
  const lastCorrectedTimeRef = useRef<number>(0);

  // TIMING FIX: Seek synchronization
  const pendingSeekRef = useRef<{ order: number; row: number; timestamp: number } | null>(null);
  const seekAcknowledgedRef = useRef<boolean>(true);

  const patternMatricesRef = useRef<PatternMatrix[]>([]); // Cache for all patterns
  const channelStatesRef = useRef<ChannelShadowState[]>([]);

  // Stable refs to avoid stale closures across renders
  const isPlayingRef = useRef<boolean>(false);
  const playRef = useRef<(() => Promise<void>) | null>(null);
  // Track whether the worklet module is loaded on the current AudioContext
  const workletLoadedRef = useRef<boolean>(false);

  // Stabilize updateUI callback so startAudioPlayback always calls the latest version
  const updateUIRef = useRef<(() => void) | null>(null);

  // RAF-loop kill switch: guards against a frame that is in-flight when stop/load
  // is called from rescheduling itself and leaking a second updateUI loop.
  const uiLoopActiveRef = useRef<boolean>(false);

  // Track if user has manually loaded a module (to prevent default from overwriting)
  const userModuleLoadedRef = useRef<boolean>(false);

  // Native C++/Wasm AudioWorklet engine (Phase 2)
  const nativeEngineRef = useRef<OpenMPTWorkletEngine | null>(null);
  /**
   * SharedArrayBuffer pre-allocated for the native engine's audio ring buffer.
   * Set at engine construction time so it can be passed to OpenMPTWorkletEngine.
   * Null in non-cross-origin-isolated contexts where SharedArrayBuffer is unavailable.
   */
  const nativeSharedBufferRef = useRef<SharedArrayBuffer | null>(null);

  // Oscilloscope SAB view — zero-GC, ref-based pipeline to GPU
  const oscBufferRef = useRef<Float32Array | null>(null);

  // Sync isPlayingRef with the latest React state every render
  isPlayingRef.current = isPlaying;

  // PERFORMANCE OPTIMIZATION: Mutable ref for high-frequency playback data
  // This prevents React re-renders 60 times/second - PatternDisplay reads directly from this ref
  const playbackStateRef = useRef<PlaybackState>({
    playheadRow: 0,
    currentOrder: 0,
    timeSec: 0,
    beatPhase: 0,
    kickTrigger: 0,
    grooveAmount: 0.5,
    lastUpdateTimestamp: 0
  });

  const loadModule = useCallback(async (fileData: Uint8Array, fileName: string) => {
    if (!libopenmptRef.current) return;
    userModuleLoadedRef.current = true; // Mark that user loaded a module
    setStatus(`Loading "${fileName}"...`);
    await processModuleData(fileData, fileName);
    // Auto-play ONLY when a user manually loads a file/selects from playlist
    if (playRef.current) playRef.current();
  }, []);

  const ensureMainThreadModule = useCallback(async (data: Uint8Array) => {
    const lib = libopenmptRef.current;
    if (!lib) {
      console.error('[ensureMainThreadModule] libopenmpt not initialized');
      return;
    }
    if (currentModulePtr.current !== 0) return;

    const bufferSize = data.byteLength;
    const bufferPtr = lib._malloc(bufferSize);
    lib.HEAPU8.set(data, bufferPtr);
    const modPtr = lib._openmpt_module_create_from_memory2(
      bufferPtr, bufferSize, 0, 0, 0, 0, 0, 0, 0
    );
    lib._free(bufferPtr);

    if (modPtr !== 0) {
      currentModulePtr.current = modPtr;
      console.log('[ensureMainThreadModule] Main-thread module created for fallback');
    } else {
      console.error('[ensureMainThreadModule] Failed to create main-thread module');
    }
  }, []);

  // Expose to audio graph so ScriptProcessor fallback can lazily create a module.
  ensureMainThreadModuleRef.current = ensureMainThreadModule;

  const processModuleData = useCallback(async (fileData: Uint8Array, fileName: string) => {
    const lib = libopenmptRef.current;
    if (!lib) {
      console.error('[processModuleData] libopenmpt not initialized');
      setStatus('Error: Audio library not initialized');
      return;
    }

    console.log('[processModuleData] Processing module:', fileName, 'size:', fileData.byteLength);

    // Perform a complete engine stop before loading the next module. This resets
    // all timing/worklet refs, pauses any active native engine, and clears the
    // worklet message handler so a stray late position report from the old module
    // cannot corrupt the new module's state. The AudioWorkletNode is kept alive.
    stopMusic(false);

    // Mark UI as loading and clear stale playhead/fraction state so the display
    // doesn't briefly snap to the previous module's position.
    setIsModuleLoaded(false);
    setPlaybackRowFraction(0);

    // Cleanup previous main-thread module (e.g. from prior ScriptProcessor fallback)
    if (currentModulePtr.current !== 0) {
      console.log('[processModuleData] Destroying previous main-thread module');
      lib._openmpt_module_destroy(currentModulePtr.current);
      currentModulePtr.current = 0;
    }

    // Clone file data before transferring original buffer to the worker.
    const fileDataCopy = fileData.slice();
    fileDataRef.current = fileDataCopy;

    // Create parser worker only when main-thread lib is not yet ready (rare).
    const useWorkerParse = !isLibReadyForParse(lib);
    if (useWorkerParse && !workerRef.current && parserWorkerHealthyRef.current) {
      try {
        workerRef.current = createParserWorker((message) => {
          parserWorkerHealthyRef.current = false;
          if (workerRef.current) {
            try { workerRef.current.terminate(); } catch { /* ignore */ }
            workerRef.current = null;
          }
          console.error(`[Parser] worker unhealthy (${fileName}):`, message);
        });
      } catch (workerErr) {
        parserWorkerHealthyRef.current = false;
        console.warn(`[processModuleData] Failed to create parser worker (${fileName}):`, workerErr);
      }
    }

    setStatus(`Parsing "${fileName}"…`);
    parserLog('processModuleData start', fileName);

    const slowHintTimer = window.setTimeout(() => {
      setStatus(`Parsing "${fileName}"… (still loading)`);
    }, PARSER_SLOW_HINT_MS);

    const onParseProgress = (stage: 'fetch' | 'wasm' | 'patterns') => {
      if (stage === 'fetch') {
        setStatus(`Parsing "${fileName}"… (fetching parser engine)`);
      } else if (stage === 'patterns') {
        setStatus(`Parsing "${fileName}"… (reading patterns)`);
      }
    };

    let patternMatrices: PatternMatrix[];
    let metadata: WorkerParseResponse['metadata'];

    try {
      const parsed = await resolveParsedModule(
        lib,
        useWorkerParse && parserWorkerHealthyRef.current ? workerRef.current : null,
        workerRef,
        fileData,
        fileDataCopy,
        fileName,
        onParseProgress,
      );
      patternMatrices = parsed.patternMatrices;
      metadata = parsed.metadata;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Module parse failed';
      console.error(`[processModuleData] Parse failed (${fileName}):`, err);
      setStatus(`Error: ${message}`);
      return;
    } finally {
      window.clearTimeout(slowHintTimer);
    }

    if (!patternMatrices.length) {
      setStatus('Error: No pattern data in module');
      console.error('[Parser] empty patternMatrices after parse');
      return;
    }

    // TIMING FIX: Initialize BPM ref
    workletBpmRef.current = metadata.initialBpm || 125;

    setModuleInfo({
      title: metadata.title || fileName,
      order: 0,
      row: 0,
      bpm: metadata.initialBpm,
      numChannels: metadata.numChannels,
    });
    setInstrumentNames(metadata.instruments ?? []);
    setModuleComments(metadata.comments ?? '');

    patternMatricesRef.current = patternMatrices;
    setTotalPatternRows(metadata.totalPatternRows);

    // Initial state
    setSequencerMatrix(patternMatrices[0] ?? null);
    setSequencerCurrentRow(0);
    setSequencerGlobalRow(0);
    setChannelStates(
      new Array(metadata.numChannels).fill({
        volume: 0, pan: 128, freq: 0, trigger: 0, noteAge: 0,
        activeEffect: 0, effectValue: 0, isMuted: 0,
      })
    );
    channelStatesRef.current = new Array(metadata.numChannels)
      .fill(null)
      .map(() => ({
        volume: 0, pan: 128, freq: 0, trigger: 0, noteAge: 0,
        activeEffect: 0, effectValue: 0, isMuted: 0,
      }));

    // TIMING FIX: Reset timing refs on new module
    audioClockStartRef.current = 0;
    workletTimeAtStartRef.current = 0;
    driftAccumulatorRef.current = 0;
    lastCorrectedTimeRef.current = 0;
    lastWorkletUpdateRef.current = 0;
    workletPositionSampleRef.current = null;
    workletRowsPerSecRef.current = rowsPerSecondFromBpm(125);
    pendingSeekRef.current = null;
    seekAcknowledgedRef.current = true;

    // Reset playback state ref so PatternDisplay doesn't show stale playhead
    playbackStateRef.current = {
      playheadRow: 0,
      currentOrder: 0,
      timeSec: 0,
      beatPhase: 0,
      kickTrigger: 0,
      grooveAmount: 0.5,
      lastUpdateTimestamp: 0,
    };

    setIsModuleLoaded(true);
    setStatus(`Loaded "${metadata.title || fileName}"`);

    // REMOVED AUTO-PLAY FROM HERE.
    // It prevented the AudioContext from securely starting because it lacked a user gesture on page load.
  }, []);

  // TIMING FIX: Improved updateUI with drift compensation and proper interpolation
  const updateUI = useCallback(() => {
    // Use ref so this callback always sees the current isPlaying state
    if (!isPlayingRef.current) return;

    // Mark the loop as active so this frame can reschedule itself. If stop/load
    // runs while we are mid-frame, it will clear this flag and the reschedule
    // below will be skipped, preventing leaked RAF loops.
    uiLoopActiveRef.current = true;

    const lib = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    const audioCtx = audioContextRef.current;

    let order = 0;
    let row = 0;
    let time = 0;
    let currentBpm = workletBpmRef.current;
    let rowSmoothing = DIRECT_ROW_SMOOTHING;

    const usingWorkletEngine =
      (activeEngine === 'worklet' || activeEngine === 'native-worklet') &&
      (audioWorkletNodeRef.current != null || nativeEngineRef.current != null);

    if (usingWorkletEngine && audioCtx) {
      rowSmoothing = WORKLET_ROW_SMOOTHING;
      const sample = workletPositionSampleRef.current;
      order = workletOrderRef.current;
      row = workletRowRef.current;
      time = workletTimeRef.current;
      currentBpm = workletBpmRef.current;

      if (sample) {
        // Predictive playhead: last worklet sample (fractional row + audioTime)
        // extrapolated to speaker-heard audio clock.
        const heardTime = getAudioHeardTime(audioCtx);
        const rowsPerSec =
          workletRowsPerSecRef.current || rowsPerSecondFromBpm(sample.bpm || currentBpm);
        const predicted = predictPlayheadFromSample(sample, heardTime, rowsPerSec);
        row = predicted.playheadRow;
        time = predicted.positionSeconds;
        order = sample.order;
        if (sample.bpm > 0) currentBpm = sample.bpm;
      }

      // Drift telemetry: compare predicted song time to hardware clock baseline
      if (sample && audioClockStartRef.current > 0) {
        const heardTime = getAudioHeardTime(audioCtx);
        const expectedTime = workletTimeAtStartRef.current + (heardTime - audioClockStartRef.current);
        const drift = time - expectedTime;
        driftAccumulatorRef.current = driftAccumulatorRef.current * 0.9 + drift * 0.1;
        if (Math.abs(driftAccumulatorRef.current) > MAX_DRIFT_SECONDS) {
          audioClockStartRef.current = heardTime;
          workletTimeAtStartRef.current = time;
          driftAccumulatorRef.current = 0;
        }
        lastCorrectedTimeRef.current = audioCtx.currentTime;
      }
    } else if (scriptProcessorRef.current && lib && modPtr !== 0) {
      // ScriptProcessor: position queried on audio callback path — leave unchanged.
      // Direct lib query is already sample-aligned with the SP render callback.
      order = lib._openmpt_module_get_current_order(modPtr);
      row = lib._openmpt_module_get_current_row(modPtr);
      time = lib._openmpt_module_get_position_seconds(modPtr);
      const bpm = lib._openmpt_module_get_current_estimated_bpm(modPtr);
      if (bpm > 0) currentBpm = bpm;
      rowSmoothing = DIRECT_ROW_SMOOTHING;
    } else {
      if (!lib || modPtr === 0) return;
      order = lib._openmpt_module_get_current_order(modPtr);
      row = lib._openmpt_module_get_current_row(modPtr);
      time = lib._openmpt_module_get_position_seconds(modPtr);
    }

    // TIMING FIX: Check for pending seek acknowledgment
    if (pendingSeekRef.current && !seekAcknowledgedRef.current) {
      const seekAge = (audioCtx ? audioCtx.currentTime : performance.now() / 1000) - pendingSeekRef.current.timestamp;
      // If seek is older than 500ms, consider it acknowledged to prevent stuck state
      if (seekAge > 0.5) {
        seekAcknowledgedRef.current = true;
        pendingSeekRef.current = null;
      }
    }

    // Update Pattern Matrix if needed
    if (sequencerMatrix?.order !== order) {
      const newMatrix = patternMatricesRef.current[order];
      if (newMatrix) setSequencerMatrix(newMatrix);
    }

    // moduleInfo / sequencer UI use integer row; shaders use fractional playhead
    const rowIntUi = Math.floor(row);
    setModuleInfo((prev: ModuleInfo) => ({ ...prev, order, row: rowIntUi, bpm: currentBpm }));
    setSequencerCurrentRow(rowIntUi);
    setPlaybackSeconds(time);

    // Update global row (approximate)
    let globalRow = 0;
    for (let i = 0; i < order; i++) {
      globalRow += patternMatricesRef.current[i]?.numRows || 64;
    }
    setSequencerGlobalRow(globalRow + rowIntUi);

    // TIMING FIX: Smooth row for visual display (light smoothing on worklet path only)
    const targetPlayhead = row;
    const prevPlayhead = playbackStateRef.current.playheadRow;
    let smoothedPlayhead = prevPlayhead + (targetPlayhead - prevPlayhead) * rowSmoothing;

    // Snap on seek / pattern change / large jumps (do not lag across page boundaries)
    if (Math.abs(targetPlayhead - prevPlayhead) > 1.0) {
      smoothedPlayhead = targetPlayhead;
    }
    // Never push a negative playhead after latency back-extrapolation
    if (smoothedPlayhead < 0) smoothedPlayhead = 0;
    setPlaybackRowFraction(smoothedPlayhead);

    // Compute note ages for hardware choke / shaders
    // Compute note ages for hardware choke in shader (only update React state when integer ages change)
    const playheadRow = smoothedPlayhead;
    const currentMatrix = patternMatricesRef.current[order];
    const numChannels = channelStatesRef.current.length;
    if (currentMatrix && numChannels > 0) {
      // PERFORMANCE: Only recompute on row boundary crossings
      const prev = playbackStateRef.current;
      const rowChanged = (order !== prev.currentOrder) ||
                        (Math.floor(playheadRow) !== Math.floor(prev.playheadRow));

      if (rowChanged) {
        const noteAges = computeNoteAges(currentMatrix, playheadRow);
        let changed = false;

        // On the SP fallback path, lib/modPtr are available and the worklet
        // message handler never runs, so volume/trigger are never refreshed
        // there. Query VU directly here instead.
        const spLib = (activeEngine !== 'worklet' && activeEngine !== 'native-worklet') ? lib : null;
        const spPtr = spLib && modPtr !== 0 ? modPtr : 0;

        for (let c = 0; c < numChannels; c++) {
          const newAge = noteAges[c] ?? 1000;
          const existing = channelStatesRef.current[c];
          if (!existing) continue;

          if ((newAge | 0) !== (existing.noteAge | 0)) {
            changed = true;
          }

          let volume = existing.volume;
          let trigger = existing.trigger;
          if (spLib && spPtr) {
            const vu: number = spLib._openmpt_module_get_current_channel_vu_mono(spPtr, c) as number;
            volume = vu;
            trigger = vu > 0.05 ? 1 : 0;
          }

          channelStatesRef.current[c] = {
            ...existing,
            noteAge: newAge,
            volume,
            trigger,
          };
        }

        if (changed) {
          setChannelStates([...channelStatesRef.current]);
        }
      } else {
        // Smooth fractional ages between rows (no allocation)
        const delta = playheadRow - prev.playheadRow;
        if (delta > 0) {
          for (let c = 0; c < numChannels; c++) {
            const state = channelStatesRef.current[c];
            if (state && state.noteAge < 999) {
              state.noteAge += delta;
            }
          }
        }
      }
    }

    // Calculate beat phase based on actual audio time
    const beatPhaseValue = (time * 2) % 1;
    setBeatPhase(beatPhaseValue);

    // TIMING FIX: Atomic update of playbackStateRef with worklet-provided timestamp
    const now = workletTimestampRef.current ?? (audioCtx?.currentTime ?? performance.now() / 1000);
    playbackStateRef.current = {
      playheadRow: smoothedPlayhead,
      currentOrder: order,
      timeSec: time,
      beatPhase: beatPhaseValue,
      kickTrigger: kickTrigger,
      grooveAmount: grooveAmount,
      lastUpdateTimestamp: now
    };

    // TIMING FIX: Update sync debug info
    setSyncDebug((prev: SyncDebugInfo) => ({
      ...prev,
      driftMs: Math.round(driftAccumulatorRef.current * 1000),
      row: Math.floor(smoothedPlayhead),
      mode: scriptProcessorRef.current ? 'scriptprocessor' : activeEngine,
      bufferMs: Math.round(
        ((audioContextRef.current?.baseLatency ?? 0) + (audioContextRef.current?.outputLatency ?? 0)) * 1000
      ),
      audioContextState: audioContextRef.current?.state || 'none',
      sampleRate: audioContextRef.current?.sampleRate || 0,
      baseLatency: audioContextRef.current?.baseLatency ?? 0,
      outputLatency: audioContextRef.current?.outputLatency ?? 0,
      workletSupported: typeof AudioWorklet !== 'undefined',
      wasmSupported: typeof WebAssembly !== 'undefined',
      driftAccumulator: driftAccumulatorRef.current,
      lastCorrectedTime: lastCorrectedTimeRef.current,
      lastWorkletUpdate: lastWorkletUpdateRef.current,
      seekPending: !!pendingSeekRef.current,
    }));

    lastUpdateTimeRef.current = performance.now() / 1000;
    // Only reschedule if stop/load hasn't killed the loop while we were running.
    if (uiLoopActiveRef.current) {
      animationFrameHandle.current = requestAnimationFrame(updateUI);
    }
  }, [isPlaying, activeEngine, sequencerMatrix, kickTrigger, grooveAmount]);

  // Keep updateUIRef always pointing to the latest updateUI so
  // startAudioPlayback can schedule the most current callback.
  updateUIRef.current = updateUI;

  const stopMusic = useCallback((destroy: boolean = false) => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    // Prevent any in-flight updateUI frame from rescheduling itself.
    uiLoopActiveRef.current = false;
    if (animationFrameHandle.current) cancelAnimationFrame(animationFrameHandle.current);

    // Pause native engine if active
    if (nativeEngineRef.current) {
      nativeEngineRef.current.pause();
    }

    // Do not suspend the AudioContext on normal stop/module reload. resume() after
    // suspend() requires a fresh user gesture — auto-play at the end of async
    // processModuleData() then fails silently (UI shows Playing, no audio).

    // Gracefully stop the old worklet before disconnecting: pause it so it stops
    // rendering/posting, and detach the message handler so any late position
    // reports from the previous module cannot overwrite the new module's state.
    // Keep the node alive on normal stop/module reload — recreating it re-inits
    // libopenmpt in the shared AudioWorklet global scope and breaks XM playback.
    if (audioWorkletNodeRef.current) {
      const oldNode = audioWorkletNodeRef.current;
      try { oldNode.port.postMessage({ type: 'pause' }); } catch { /* ignore */ }
      try { oldNode.port.onmessage = null; } catch { /* ignore */ }
      if (destroy) {
        try { oldNode.disconnect(); } catch { /* ignore */ }
        audioWorkletNodeRef.current = null;
      }
    }

    // Cleanup ScriptProcessorNode fallback
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (spLeftBufPtr.current && libopenmptRef.current) {
      libopenmptRef.current._free(spLeftBufPtr.current);
      spLeftBufPtr.current = 0;
    }
    if (spRightBufPtr.current && libopenmptRef.current) {
      libopenmptRef.current._free(spRightBufPtr.current);
      spRightBufPtr.current = 0;
    }
    spFallbackTriggered.current = false;

    // TIMING FIX: Reset timing refs on stop
    audioClockStartRef.current = 0;
    workletTimeAtStartRef.current = 0;
    driftAccumulatorRef.current = 0;
    lastCorrectedTimeRef.current = 0;
    pendingSeekRef.current = null;
    seekAcknowledgedRef.current = true;

    const audioCtx = audioContextRef.current;
    lastWorkletUpdateRef.current = audioCtx ? audioCtx.currentTime : (performance.now() / 1000);

    workletTimeRef.current = 0;
    workletOrderRef.current = 0;
    workletRowRef.current = 0;
    workletSpeedRef.current = 6;
    workletRowsPerSecRef.current = rowsPerSecondFromBpm(125);
    workletPositionSampleRef.current = null;
    workletBpmRef.current = 125;
    if (destroy) {
      setInstrumentNames([]);
      setModuleComments('');
    }

    if (destroy && currentModulePtr.current !== 0 && libopenmptRef.current) {
      libopenmptRef.current._openmpt_module_destroy(currentModulePtr.current);
      currentModulePtr.current = 0;
      setIsModuleLoaded(false);
    }

    setStatus("Stopped.");
  }, []);

  // TIMING FIX: Improved seekToStep with proper synchronization
  const seekToStepWrapper = useCallback((step: number) => {
    const matrices = patternMatricesRef.current;
    if (matrices.length === 0) return;

    let acc = 0;
    let targetOrder = 0;
    let targetRow = 0;
    for (let o = 0; o < matrices.length; o++) {
      const m = matrices[o];
      const rows = m ? m.numRows : 64;
      if (step < acc + rows) {
        targetOrder = o;
        targetRow = step - acc;
        break;
      }
      acc += rows;
    }

    // TIMING FIX: Set pending seek for synchronization tracking
    const audioCtx = audioContextRef.current;
    pendingSeekRef.current = {
      order: targetOrder,
      row: targetRow,
      timestamp: audioCtx ? audioCtx.currentTime : performance.now() / 1000
    };
    seekAcknowledgedRef.current = false;

    // Update main thread libopenmpt position only if a main-thread module exists
    const lib = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    if (lib && modPtr !== 0) {
      lib._openmpt_module_set_position_order_row(modPtr, targetOrder, targetRow);
    }

    // TIMING FIX: Update worklet refs immediately for UI consistency
    workletOrderRef.current = targetOrder;
    workletRowRef.current = targetRow;
    workletTimeRef.current = 0;
    workletPositionSampleRef.current = null;
    workletRowsPerSecRef.current = rowsPerSecondFromBpm(workletBpmRef.current);

    setModuleInfo((prev: ModuleInfo) => ({ ...prev, order: targetOrder, row: targetRow }));
    setSequencerCurrentRow(targetRow);
    setSequencerGlobalRow(step);
    setPlaybackRowFraction(targetRow);
    playbackStateRef.current.playheadRow = targetRow;

    // TIMING FIX: Reset drift accumulator on seek
    driftAccumulatorRef.current = 0;
    lastWorkletUpdateRef.current = audioCtx ? audioCtx.currentTime : 0;

    // TIMING FIX: Reset baselines on seek to prevent massive drift calculation
    audioClockStartRef.current = audioCtx ? audioCtx.currentTime : 0;
    workletTimeAtStartRef.current = workletTimeRef.current;

    // Worklet update with acknowledgment tracking
    if (activeEngine === 'native-worklet' && nativeEngineRef.current) {
      nativeEngineRef.current.seek(targetOrder, targetRow);
      // Native engine seek is synchronous, mark as acknowledged
      seekAcknowledgedRef.current = true;
    } else if (activeEngine === 'worklet' && audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.postMessage({
        type: 'seek',
        order: targetOrder,
        row: targetRow,
        // TIMING FIX: Include timestamp for worklet to correlate
        timestamp: audioCtx ? audioCtx.currentTime : 0
      });
    }
  }, [activeEngine]);

  const play = useCallback(async () => {
    const audioRefs: AudioGraphRefs = {
      libopenmptRef, fileDataRef, audioContextRef, workletLoadedRef,
      stereoPannerRef, gainNodeRef, analyserRef, audioWorkletNodeRef,
      nativeEngineRef, wasmMemoryRef, workletOrderRef, workletRowRef,
      workletTimeRef, lastWorkletUpdateRef, workletBpmRef, workletSpeedRef,
      workletRowsPerSecRef, workletPositionSampleRef, pendingSeekRef,
      seekAcknowledgedRef, workletTimestampRef, spFallbackTriggered, scriptProcessorRef,
      spLeftBufPtr, spRightBufPtr, isPlayingRef, animationFrameHandle,
      currentModulePtr, channelStatesRef, patternMatricesRef,
      audioClockStartRef, workletTimeAtStartRef, driftAccumulatorRef,
      updateUIRef, nativeSharedBuffer: nativeSharedBufferRef,
      ensureMainThreadModuleRef,
    };
    const audioCbs: AudioGraphCallbacks = {
      setStatus, setIsPlaying, setActiveEngine, setModuleInfo, setSequencerMatrix,
      stopMusic, seekToStepWrapper, updateUI,
    };
    const audioConfig: AudioGraphConfig = {
      activeEngine, isWorkletSupported, isNativeWorkletAvailable,
      panValue, volume, isLooping, WORKLET_URL,
    };
    await startAudioPlayback(audioRefs, audioCbs, audioConfig);

    // Request oscilloscope SharedArrayBuffer from worklet (sent once in constructor,
    // but we may have missed it; getOscBuffer allows re-delivery without re-allocation)
    const node = audioWorkletNodeRef.current;
    if (node) {
      const handler = (e: MessageEvent) => {
        if (e.data?.type === 'oscBuffer' && e.data.buffer) {
          oscBufferRef.current = new Float32Array(e.data.buffer);
          node.port.removeEventListener('message', handler);
        }
      };
      node.port.addEventListener('message', handler);
      node.port.postMessage({ type: 'getOscBuffer' });
    }
  }, [activeEngine, isWorkletSupported, isNativeWorkletAvailable, panValue, volume, isLooping, stopMusic, seekToStepWrapper, updateUI]);

  // Keep playRef always pointing to the latest play function
  // so processModuleData (which memoises over different deps) can call it without stale closure
  playRef.current = play;

  // AUDIO-001 FIX: Enhanced toggle function with better engine state management
  const toggleAudioEngine = useCallback(() => {
    // Cycle: native-worklet → worklet → native-worklet (if available)
    let newEngine: 'worklet' | 'native-worklet';
    if (activeEngine === 'native-worklet') {
      newEngine = 'worklet';
    } else {
      newEngine = isNativeWorkletAvailable ? 'native-worklet' : 'worklet';
    }

    console.log('[toggleEngine]', { 
      from: activeEngine, 
      to: newEngine, 
      isNativeAvailable: isNativeWorkletAvailable,
      isWorkletSupported,
      willRestart: isPlaying
    });

    if (isPlaying) {
      setRestartPlayback(true);
      stopMusic(false);
    }
    setActiveEngine(newEngine);
    setWorkletLoadError(null); // Clear any previous errors when switching
  }, [activeEngine, isPlaying, isNativeWorkletAvailable, isWorkletSupported, stopMusic]);

  useEffect(() => {
    if (restartPlayback) {
      setRestartPlayback(false);
      play();
    }
  }, [restartPlayback, play]);

  useEffect(() => {
    const init = async () => {
      console.log("[INIT] Starting libopenmpt initialization...");

      if (!window.libopenmptReady) {
        setStatus("Error: libopenmpt initialization script not found.");
        console.error("[INIT] window.libopenmptReady promise not found. Check index.html.");
        return;
      }

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Initialization timed out')), 15000);
        });

        console.log("[INIT] Waiting for libopenmptReady...");
        const lib = await Promise.race([window.libopenmptReady, timeoutPromise]);
        console.log("[INIT] libopenmptReady resolved");

        if (!lib.UTF8ToString) {
          console.warn('Polyfilling libopenmpt.UTF8ToString...');
          lib.UTF8ToString = (ptr) => {
            let str = '';
            if (!ptr) return str;
            const heap = lib.HEAPU8;
            for (let i = 0; ; i++) {
              const byte = heap[ptr + i];
              if (byte === undefined || byte === 0) break;
              str += String.fromCharCode(byte);
            }
            return str;
          };
        }
        if (!lib.stringToUTF8) {
          console.warn('Polyfilling libopenmpt.stringToUTF8...');
          lib.stringToUTF8 = (jsString) => {
            const length = (jsString.length << 2) + 1;
            const ptr = lib._malloc(length);
            const heap = lib.HEAPU8;
            let i = 0, j = 0;
            while (i < jsString.length) heap[ptr + j++] = jsString.charCodeAt(i++);
            heap[ptr + j] = 0;
            return ptr;
          };
        }

        libopenmptRef.current = lib;
        setIsReady(true);

        // Parser worker availability is determined by actually constructing the
        // worker and attempting a parse. The HEAD check is diagnostic-only because
        // Vite hashes worker chunks in production, so the source .ts URL may 404
        // even though the emitted worker chunk is valid.
        void verifyParserWorkerUrl().then((ok) => {
          if (!ok) {
            console.warn(
              '[Parser] Worker script HEAD check failed (diagnostic only; will still attempt worker parse)',
            );
          }
        });

        // AUDIO-001 FIX COMPLETE: Enhanced AudioWorklet support check with detailed diagnostics
        console.log("[INIT] Testing AudioWorklet support...");
        try {
          const hasWorkletSupport = checkWorkletSupport();
          
          // Use centralized diagnostic logging
          logWorkletDiagnostics(WORKLET_URL);

          // AUDIO-001 FIX COMPLETE: Verify the worklet file is accessible
          if (hasWorkletSupport) {
            const fileAccessible = await verifyWorkletFile();
            
            if (fileAccessible) {
              setIsWorkletSupported(true);
              setActiveEngine('worklet');
              console.log('✅ [INIT] AudioWorklet API available and file accessible');
            } else {
              console.warn("⚠️ [INIT] AudioWorklet API available but worklet file not accessible");
              setIsWorkletSupported(false);
              setWorkletLoadError(`Worklet file not found at ${WORKLET_URL}. Check deployment.`);
              setStatus("Error: Worklet file not accessible.");
            }
          } else {
            console.warn("⚠️ [INIT] AudioWorklet API not available in this browser");
            setIsWorkletSupported(false);
            setWorkletLoadError('AudioWorklet not supported in this browser');
            setStatus("Error: AudioWorklet not supported in this browser.");
          }
        } catch (e) {
          console.warn("⚠️ [INIT] AudioWorklet API check failed:", e);
          setIsWorkletSupported(false);
          setWorkletLoadError('AudioWorklet check failed: ' + (e as Error).message);
          setStatus("Error: AudioWorklet not supported in this browser.");
        }

        // Probe for native C++/Wasm AudioWorklet engine
        // Note: enabling this requires building the wasm engine using
        // ./scripts/build-wasm.sh (Emscripten SDK must be installed).
        try {
          const nativeGlueUrl = getNativeGlueUrl();
          console.log('[INIT] Probing for native engine at:', nativeGlueUrl);
          const glueIsSafe = await isNativeGlueAvailable(nativeGlueUrl);
          if (glueIsSafe) {
            console.log('[INIT] Native C++/Wasm AudioWorklet glue detected');

            // Allocate the ring-buffer SharedArrayBuffer before constructing the engine
            // so it can be stored and forwarded to the engine constructor.
            // SharedArrayBuffer requires cross-origin isolation (COOP/COEP headers).
            const sharedOutputBuffer: SharedArrayBuffer | undefined =
              window.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
                ? new SharedArrayBuffer(NATIVE_RING_BUF_BYTES)
                : undefined;

            if (sharedOutputBuffer) {
              console.log('[INIT] Allocated ring-buffer SharedArrayBuffer:', NATIVE_RING_BUF_BYTES, 'bytes');
            } else {
              console.log('[INIT] crossOriginIsolated=false — ring-buffer bridge unavailable; '
                + 'falling back to MediaStream bridge');
            }

            nativeSharedBufferRef.current = sharedOutputBuffer ?? null;
            const engineOptions: import('../audio-worklet/OpenMPTWorkletEngine').NativeEngineOptions = {};
            if (sharedOutputBuffer) engineOptions.sharedOutputBuffer = sharedOutputBuffer;
            const engine = new OpenMPTWorkletEngine(engineOptions);
            await engine.init();
            nativeEngineRef.current = engine;
            setIsNativeWorkletAvailable(true);
            setActiveEngine('native-worklet');
            console.log('[INIT] Native engine initialized');
          } else {
            console.log('[INIT] Native engine glue not available — using JS AudioWorklet fallback');
          }
        } catch (nativeErr) {
          console.warn('[INIT] Native engine probe failed — using JS AudioWorklet fallback:', nativeErr);
          setIsNativeWorkletAvailable(false);
        }
      } catch (e) {
        const error = e as Error;
        if (error.message === 'Initialization timed out') {
          setStatus("Error: libopenmpt initialization timed out.");
        } else {
          setStatus(`Error: ${error.message || 'Audio library failed to load'}`);
          console.error("Error awaiting libopenmptReady:", e);
        }
      }
    };
    init();

    return () => {
      console.log("Cleaning up libopenmpt resources.");
      if (nativeEngineRef.current) {
        nativeEngineRef.current.destroy();
        nativeEngineRef.current = null;
      }
      if (audioWorkletNodeRef.current) audioWorkletNodeRef.current.disconnect();
      if (stereoPannerRef.current) stereoPannerRef.current.disconnect();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') audioContextRef.current.close();
      if (currentModulePtr.current !== 0 && libopenmptRef.current) {
        libopenmptRef.current._openmpt_module_destroy(currentModulePtr.current);
      }
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      cancelAnimationFrame(animationFrameHandle.current);
    };
  }, []);

  // Update panning when panValue changes
  useEffect(() => {
    if (stereoPannerRef.current) {
      stereoPannerRef.current.pan.value = panValue;
    }
  }, [panValue]);

  // Update volume
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume;
    }
    // Sync volume with native C++/Wasm engine
    if (nativeEngineRef.current) {
      nativeEngineRef.current.setVolume(volume);
    }
  }, [volume]);

  const replacePatternMatrix = useCallback((matrix: PatternMatrix) => {
    const order = matrix.order;
    if (order >= 0 && order < patternMatricesRef.current.length) {
      const nextMatrices = [...patternMatricesRef.current];
      nextMatrices[order] = matrix;
      patternMatricesRef.current = nextMatrices;
    }
    setSequencerMatrix(matrix);
  }, []);

  // Load default module (only if user hasn't loaded one and no share URL)
  useEffect(() => {
    if (isReady && !userModuleLoadedRef.current && !hasShareModuleIntent()) {
      const loadDefault = async () => {
        const fileName = DEFAULT_MODULE_URL.split('/').pop() || 'default.mod';
        setStatus(`Fetching "${fileName}"...`);
        try {
          const response = await fetch(DEFAULT_MODULE_URL);
          if (!response.ok) throw new Error(`Failed to fetch module: ${response.statusText}`);
          const arrayBuffer = await response.arrayBuffer();
          const fileData = new Uint8Array(arrayBuffer);
          await processModuleData(fileData, fileName);
        } catch (e) {
          console.error("Failed to load default module:", e);
          setStatus(`Error fetching default module. See console.`);
        }
      };
      loadDefault();
    }
  }, [isReady, processModuleData]);

  return {
    status, isReady, isPlaying, isModuleLoaded, moduleInfo, patternData,
    loadFile: loadModule, play, stopMusic, sequencerMatrix, sequencerCurrentRow, sequencerGlobalRow,
    totalPatternRows, playbackSeconds, playbackRowFraction, setPlaybackRowFraction, channelStates, beatPhase, grooveAmount, kickTrigger, activeChannels,
    instrumentNames,
    moduleComments,
    isLooping, setIsLooping, seekToStep: seekToStepWrapper, panValue, setPanValue,
    activeEngine, isWorkletSupported, toggleAudioEngine, syncDebug,
    analyserNode: analyserRef.current,
    replacePatternMatrix,
    // PERFORMANCE OPTIMIZATION: Export ref for high-frequency updates
    // PatternDisplay reads directly from this to this ref - avoids React re-renders
    playbackStateRef,
    // AUDIO-001 FIX: Export worklet diagnostics
    workletLoadError,
    // Oscilloscope SAB view for GPU texture upload
    oscBufferRef,
  };
}
