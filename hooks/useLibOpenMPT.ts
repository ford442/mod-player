import { useState, useEffect, useRef, useCallback } from 'react';
import { LibOpenMPT, ModuleInfo, PatternMatrix, ChannelShadowState, PlaybackState } from '../types';
import { OpenMPTWorkletEngine } from '../audio-worklet/OpenMPTWorkletEngine';
import { getPatternMatrix, computeNoteAges } from '../utils/patternExtractor';
import { startAudioPlayback, AudioGraphRefs, AudioGraphCallbacks, AudioGraphConfig } from './useAudioGraph';
import { useWorkletLoader, getWorkletUrl } from './useWorkletLoader';

interface SyncDebugInfo {
  mode: string;
  bufferMs: number;
  driftMs: number;
  row: number;
  starvationCount: number;
}

// Use Vite BASE_URL for correct resolution under subdirectory deployment
const DEFAULT_MODULE_URL = `${import.meta.env.BASE_URL}4-mat_madness.mod`;

// AUDIO-001 FIX: Use centralized worklet URL construction from useWorkletLoader
const WORKLET_URL = getWorkletUrl();

// AUDIO-001 FIX: Enhanced logging for diagnostics
console.log('[AudioWorklet] Configuration:', {
  workletUrl: WORKLET_URL,
  viteBaseUrl: import.meta.env.BASE_URL,
  currentPath: window.location.pathname,
  origin: window.location.origin,
});

// TIMING FIX: Maximum allowed drift before correction (in seconds)
const MAX_DRIFT_SECONDS = 0.1;
// TIMING FIX: Row interpolation smoothing factor
const ROW_INTERPOLATION_SMOOTHING = 0.3;

export function useLibOpenMPT(initialVolume: number = 0.4) {
  const [status, setStatus] = useState<string>("Initializing...");
  const [isReady, setIsReady] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isModuleLoaded, setIsModuleLoaded] = useState<boolean>(false);
  const [moduleInfo, setModuleInfo] = useState<ModuleInfo>({ title: "None", order: 0, row: 0, bpm: 125, numChannels: 0 });
  const [patternData, _setPatternData] = useState<Uint8Array | null>(null);
  const [sequencerMatrix, setSequencerMatrix] = useState<PatternMatrix | null>(null);
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
  const [syncDebug, setSyncDebug] = useState<SyncDebugInfo>({ mode: "none", bufferMs: 0, driftMs: 0, row: 0, starvationCount: 0 });
  
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

  const animationFrameHandle = useRef<number>(0);
  const lastUpdateTimeRef = useRef<number>(0);

  // Worklet state tracking
  const workletOrderRef = useRef<number>(0);
  const workletRowRef = useRef<number>(0);
  const workletTimeRef = useRef<number>(0);
  // TIMING FIX: Track worklet BPM for accurate row interpolation
  const workletBpmRef = useRef<number>(125);
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

  // Track if user has manually loaded a module (to prevent default from overwriting)
  const userModuleLoadedRef = useRef<boolean>(false);

  // Native C++/Wasm AudioWorklet engine (Phase 2)
  const nativeEngineRef = useRef<OpenMPTWorkletEngine | null>(null);

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

  const processModuleData = useCallback(async (fileData: Uint8Array, fileName: string) => {
    const lib = libopenmptRef.current;
    if (!lib) {
      console.error("[processModuleData] libopenmpt not initialized");
      return;
    }

    console.log("[processModuleData] Processing module:", fileName, "size:", fileData.byteLength);

    // Use ref to check playing state to avoid dependency loop
    if (isPlayingRef.current) {
      console.log("[processModuleData] Stopping current playback");
      // Stop without calling stopMusic to avoid circular dependency
      isPlayingRef.current = false;
      setIsPlaying(false);
      if (animationFrameHandle.current) cancelAnimationFrame(animationFrameHandle.current);
      if (audioContextRef.current) {
        try { audioContextRef.current.suspend(); } catch { /* ignore */ }
      }
      if (audioWorkletNodeRef.current) {
        try { audioWorkletNodeRef.current.disconnect(); } catch { /* ignore */ }
        audioWorkletNodeRef.current = null;
      }
    }

    // Cleanup previous module
    if (currentModulePtr.current !== 0) {
      console.log("[processModuleData] Destroying previous module");
      lib._openmpt_module_destroy(currentModulePtr.current);
      currentModulePtr.current = 0;
    }

    // Store file data for Worklet
    console.log("[processModuleData] Storing fileDataRef for worklet");
    fileDataRef.current = fileData;

    // Load module into MAIN thread instance (for metadata and pattern viewing)
    const bufferSize = fileData.byteLength;
    const bufferPtr = lib._malloc(bufferSize);
    lib.HEAPU8.set(fileData, bufferPtr);

    // Provide logging/error callbacks (null for now)
    const modPtr = lib._openmpt_module_create_from_memory2(bufferPtr, bufferSize, 0, 0, 0, 0, 0, 0, 0);
    lib._free(bufferPtr);

    if (modPtr === 0) {
      setStatus("Error: Failed to load module (invalid format?)");
      return;
    }

    currentModulePtr.current = modPtr;

    // Read metadata
    const titlePtr = lib._openmpt_module_get_metadata(modPtr, lib.stringToUTF8("title"));
    const title = lib.UTF8ToString(titlePtr);
    lib._openmpt_free_string(titlePtr);

    const numOrders = lib._openmpt_module_get_num_orders(modPtr);
    const numChannels = lib._openmpt_module_get_num_channels(modPtr);
    const initialBpm = lib._openmpt_module_get_current_estimated_bpm(modPtr);

    // TIMING FIX: Initialize BPM ref
    workletBpmRef.current = initialBpm || 125;

    setModuleInfo({
      title: title || fileName,
      order: 0,
      row: 0,
      bpm: initialBpm,
      numChannels
    });

    // Cache patterns
    const matrices: PatternMatrix[] = [];
    let totalRows = 0;
    for (let i = 0; i < numOrders; i++) {
      const patIdx = lib._openmpt_module_get_order_pattern(modPtr, i);
      const matrix = getPatternMatrix(lib, modPtr, patIdx, i);
      matrices.push(matrix);
      totalRows += matrix.numRows;
    }
    patternMatricesRef.current = matrices;
    setTotalPatternRows(totalRows);

    // Initial state
    setSequencerMatrix(matrices[0] ?? null);
    setSequencerCurrentRow(0);
    setSequencerGlobalRow(0);
    setChannelStates(new Array(numChannels).fill({ volume: 0, pan: 128, freq: 0, trigger: 0, noteAge: 0, activeEffect: 0, effectValue: 0, isMuted: 0 }));
    channelStatesRef.current = new Array(numChannels).fill(null).map(() => ({ volume: 0, pan: 128, freq: 0, trigger: 0, noteAge: 0, activeEffect: 0, effectValue: 0, isMuted: 0 }));

    // TIMING FIX: Reset timing refs on new module
    audioClockStartRef.current = 0;
    workletTimeAtStartRef.current = 0;
    driftAccumulatorRef.current = 0;
    lastCorrectedTimeRef.current = 0;
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
      lastUpdateTimestamp: 0
    };

    setIsModuleLoaded(true);
    setStatus(`Loaded "${title || fileName}"`);

    // REMOVED AUTO-PLAY FROM HERE.
    // It prevented the AudioContext from securely starting because it lacked a user gesture on page load.
  }, []);

  // TIMING FIX: Improved updateUI with drift compensation and proper interpolation
  const updateUI = useCallback(() => {
    // Use ref so this callback always sees the current isPlaying state
    if (!isPlayingRef.current) return;

    const lib = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    const audioCtx = audioContextRef.current;

    let order = 0;
    let row = 0;
    let time = 0;
    let rowFraction = 0;
    let currentBpm = workletBpmRef.current;

    if ((activeEngine === 'worklet' || activeEngine === 'native-worklet') && (audioWorkletNodeRef.current || nativeEngineRef.current)) {
      // Use state from worklet (JS or native)
      order = workletOrderRef.current;
      row = workletRowRef.current;
      time = workletTimeRef.current;
      currentBpm = workletBpmRef.current;

      // TIMING FIX: Use audio context time for accurate interpolation
      if (audioCtx && lastWorkletUpdateRef.current > 0) {
        const now = audioCtx.currentTime;
        const elapsedSinceWorkletUpdate = now - lastWorkletUpdateRef.current;

        // Only interpolate if the worklet update is recent (within 100ms)
        if (elapsedSinceWorkletUpdate < 0.1) {
          // Calculate expected row progress based on BPM
          // Rows per second = BPM / 60 / 4 (assuming 4 rows per beat)
          const rowsPerSecond = currentBpm / 60 / 4;
          rowFraction = Math.min(1, elapsedSinceWorkletUpdate * rowsPerSecond);

          // TIMING FIX: Apply drift correction
          const expectedTime = workletTimeRef.current + elapsedSinceWorkletUpdate;
          const drift = time - expectedTime;
          driftAccumulatorRef.current = driftAccumulatorRef.current * 0.9 + drift * 0.1;

          // Update sync debug info
          if (Math.abs(driftAccumulatorRef.current) > MAX_DRIFT_SECONDS) {
            // Apply correction
            time = expectedTime + driftAccumulatorRef.current * 0.5;
            lastCorrectedTimeRef.current = now;
          } else {
            time = expectedTime;
          }
        } else {
          // Worklet hasn't updated recently - use last known values
          rowFraction = 0;
        }
      }
    } else {
      // No ScriptProcessor fallback; if no worklet state yet, keep prior UI values
      if (!lib || modPtr === 0) return;
      order = lib._openmpt_module_get_current_order(modPtr);
      row = lib._openmpt_module_get_current_row(modPtr);
      time = lib._openmpt_module_get_position_seconds(modPtr);
    }

    // TIMING FIX: Check for pending seek acknowledgment
    if (pendingSeekRef.current && !seekAcknowledgedRef.current) {
      const seekAge = audioCtx ? audioCtx.currentTime - pendingSeekRef.current.timestamp : 0;
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

    setModuleInfo((prev: ModuleInfo) => ({ ...prev, order, row, bpm: currentBpm }));
    setSequencerCurrentRow(row);
    setPlaybackSeconds(time);

    // Update global row (approximate)
    let globalRow = 0;
    for (let i = 0; i < order; i++) {
      globalRow += patternMatricesRef.current[i]?.numRows || 64;
    }
    setSequencerGlobalRow(globalRow + row);

    // TIMING FIX: Smooth row fraction for visual display
    const smoothedRowFraction = rowFraction * ROW_INTERPOLATION_SMOOTHING + (playbackRowFraction * (1 - ROW_INTERPOLATION_SMOOTHING));
    setPlaybackRowFraction(smoothedRowFraction);

    // Compute note ages for hardware choke in shader (only update React state when integer ages change)
    const currentMatrix = patternMatricesRef.current[order];
    const numChannels = channelStatesRef.current.length;
    if (currentMatrix && numChannels > 0) {
      const playheadRow = row + smoothedRowFraction;
      const noteAges = computeNoteAges(currentMatrix, playheadRow);
      let changed = false;
      for (let c = 0; c < numChannels; c++) {
        const newAge = noteAges[c] ?? 1000;
        const oldAge = channelStatesRef.current[c]?.noteAge ?? 1000;
        if (Math.floor(newAge) !== Math.floor(oldAge)) {
          changed = true;
        }
        const existing = channelStatesRef.current[c];
        channelStatesRef.current[c] = {
          volume: existing?.volume ?? 0,
          pan: existing?.pan ?? 128,
          freq: existing?.freq ?? 0,
          trigger: existing?.trigger ?? 0,
          noteAge: newAge,
          activeEffect: existing?.activeEffect ?? 0,
          effectValue: existing?.effectValue ?? 0,
          isMuted: existing?.isMuted ?? 0,
        };
      }
      if (changed) {
        setChannelStates([...channelStatesRef.current]);
      }
    }

    // Calculate beat phase based on actual audio time
    const beatPhaseValue = (time * 2) % 1;
    setBeatPhase(beatPhaseValue);

    // TIMING FIX: Atomic update of playbackStateRef with timestamp
    const now = audioCtx?.currentTime || performance.now() / 1000;
    playbackStateRef.current = {
      playheadRow: row + smoothedRowFraction,
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
      row: row,
      mode: activeEngine
    }));

    lastUpdateTimeRef.current = performance.now() / 1000;
    animationFrameHandle.current = requestAnimationFrame(updateUI);
  }, [isPlaying, activeEngine, sequencerMatrix, kickTrigger, grooveAmount, playbackRowFraction]);

  // Keep updateUIRef always pointing to the latest updateUI so
  // startAudioPlayback can schedule the most current callback.
  updateUIRef.current = updateUI;

  const stopMusic = useCallback((destroy: boolean = false) => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (animationFrameHandle.current) cancelAnimationFrame(animationFrameHandle.current);

    // Pause native engine if active
    if (nativeEngineRef.current) {
      nativeEngineRef.current.pause();
    }

    if (audioContextRef.current) {
      audioContextRef.current.suspend();
    }

    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
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
    pendingSeekRef.current = null;
    seekAcknowledgedRef.current = true;

    if (destroy && currentModulePtr.current !== 0 && libopenmptRef.current) {
      libopenmptRef.current._openmpt_module_destroy(currentModulePtr.current);
      currentModulePtr.current = 0;
      setIsModuleLoaded(false);
    }

    setStatus("Stopped.");
  }, []);

  // TIMING FIX: Improved seekToStep with proper synchronization
  const seekToStepWrapper = useCallback((step: number) => {
    // Main thread update (for UI immediate response)
    const lib = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    if (!lib || modPtr === 0) return;

    let acc = 0;
    let targetOrder = 0;
    let targetRow = 0;
    const numOrders = lib._openmpt_module_get_num_orders(modPtr);
    for (let o = 0; o < numOrders; o++) {
      const m = patternMatricesRef.current[o];
      const rows = m ? m.numRows : lib._openmpt_module_get_pattern_num_rows(modPtr, lib._openmpt_module_get_order_pattern(modPtr, o));
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

    // Update main thread libopenmpt position
    lib._openmpt_module_set_position_order_row(modPtr, targetOrder, targetRow);

    // TIMING FIX: Update worklet refs immediately for UI consistency
    workletOrderRef.current = targetOrder;
    workletRowRef.current = targetRow;

    setModuleInfo((prev: ModuleInfo) => ({ ...prev, order: targetOrder, row: targetRow }));
    setSequencerCurrentRow(targetRow);
    setSequencerGlobalRow(step);

    // TIMING FIX: Reset drift accumulator on seek
    driftAccumulatorRef.current = 0;
    lastWorkletUpdateRef.current = audioCtx ? audioCtx.currentTime : 0;

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
      workletTimeRef, lastWorkletUpdateRef, workletBpmRef, pendingSeekRef,
      seekAcknowledgedRef, spFallbackTriggered, scriptProcessorRef,
      spLeftBufPtr, spRightBufPtr, isPlayingRef, animationFrameHandle,
      currentModulePtr, channelStatesRef, patternMatricesRef,
      audioClockStartRef, workletTimeAtStartRef, driftAccumulatorRef,
      updateUIRef,
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

        // AUDIO-001 FIX: Enhanced AudioWorklet support check with detailed diagnostics
        console.log("[INIT] Testing AudioWorklet support...");
        try {
          const hasWorkletSupport = checkWorkletSupport();
          
          console.log('[INIT] AudioWorklet diagnostics:', {
            hasWorkletSupport,
            workletUrl: WORKLET_URL,
            userAgent: navigator.userAgent.substring(0, 50) + '...',
          });

          // AUDIO-001 FIX: Verify the worklet file is accessible
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
          const nativeGlueUrl = `${import.meta.env.BASE_URL}worklets/openmpt-native.js`;
          console.log('[INIT] Probing for native engine at:', nativeGlueUrl);
          const probeResp = await fetch(nativeGlueUrl, { method: 'HEAD' });
          if (probeResp.ok) {
            console.log('[INIT] Native C++/Wasm AudioWorklet engine available');
            const engine = new OpenMPTWorkletEngine();
            await engine.init();
            nativeEngineRef.current = engine;
            setIsNativeWorkletAvailable(true);
            setActiveEngine('native-worklet');
            console.log('[INIT] Native engine initialized');
          } else {
            console.log('[INIT] Native engine not found (status:', probeResp.status, ')');
          }
        } catch (nativeErr) {
          console.log('[INIT] Native C++/Wasm engine not available (using JS fallback):', nativeErr);
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

  // Load default module (only if user hasn't loaded one)
  useEffect(() => {
    if (isReady && !userModuleLoadedRef.current) {
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
    totalPatternRows, playbackSeconds, playbackRowFraction, channelStates, beatPhase, grooveAmount, kickTrigger, activeChannels,
    isLooping, setIsLooping, seekToStep: seekToStepWrapper, panValue, setPanValue,
    activeEngine, isWorkletSupported, toggleAudioEngine, syncDebug,
    analyserNode: analyserRef.current,
    // PERFORMANCE OPTIMIZATION: Export ref for high-frequency updates
    // PatternDisplay reads directly from this to this ref - avoids React re-renders
    playbackStateRef,
    // AUDIO-001 FIX: Export worklet diagnostics
    workletLoadError,
  };
}
