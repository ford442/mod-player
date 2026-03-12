import { useState, useEffect, useRef, useCallback } from 'react';
import { LibOpenMPT, ModuleInfo, PatternMatrix, ChannelShadowState } from '../types';
import { OpenMPTWorkletEngine } from '../audio-worklet/OpenMPTWorkletEngine';
import type { WorkletPositionData } from '../audio-worklet/types';

interface SyncDebugInfo {
  mode: string;
  bufferMs: number;
  driftMs: number;
  row: number;
  starvationCount: number;
}

// Constants
const DEFAULT_ROWS = 64;
const DEFAULT_CHANNELS = 4;
// Use Vite BASE_URL for correct resolution under subdirectory deployment
const DEFAULT_MODULE_URL = `${import.meta.env.BASE_URL}4-mat_madness.mod`;

// Runtime base URL detection for subdirectory deployment (e.g., /xm-player/)
// Vite's BASE_URL may be '/' at build time, so we detect actual path from window.location
const detectRuntimeBase = (): string => {
  const viteBase = import.meta.env.BASE_URL;
  // If Vite base is explicitly set (not root), use it
  if (viteBase && viteBase !== '/') {
    return viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
  }
  // Otherwise detect from current URL path
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  if (pathSegments.length > 0) {
    return `/${pathSegments[0]}/`;
  }
  return '/';
};

const RUNTIME_BASE_URL = detectRuntimeBase();
const WORKLET_URL = `${RUNTIME_BASE_URL}worklets/openmpt-worklet.js`;
console.log('[AudioWorklet] Worklet URL resolved:', WORKLET_URL, '(Vite BASE_URL:', import.meta.env.BASE_URL, ', Runtime base:', RUNTIME_BASE_URL, ')');
// const SAMPLE_RATE = 44100;

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

  // Track if user has manually loaded a module (to prevent default from overwriting)
  const userModuleLoadedRef = useRef<boolean>(false);

  // Native C++/Wasm AudioWorklet engine (Phase 2)
  const nativeEngineRef = useRef<OpenMPTWorkletEngine | null>(null);

  // Sync isPlayingRef with the latest React state every render
  isPlayingRef.current = isPlaying;

  // PERFORMANCE OPTIMIZATION: Mutable ref for high-frequency playback data
  // This prevents React re-renders 60 times/second - PatternDisplay reads directly from this ref
  const playbackStateRef = useRef<{
    playheadRow: number;
    currentOrder: number;
    timeSec: number;
    beatPhase: number;
    kickTrigger: number;
    grooveAmount: number;
    // TIMING FIX: Add timestamp for drift detection
    lastUpdateTimestamp: number;
  }>({
    playheadRow: 0,
    currentOrder: 0,
    timeSec: 0,
    beatPhase: 0,
    kickTrigger: 0,
    grooveAmount: 0.5,
    lastUpdateTimestamp: 0
  });

  // Helpers
  const getPatternMatrix = useCallback((modPtr: number, patternIndex: number, orderIndex: number): PatternMatrix => {
    const lib = libopenmptRef.current;
    if (!lib) return { order: orderIndex, patternIndex, numRows: DEFAULT_ROWS, numChannels: DEFAULT_CHANNELS, rows: [] };

    const numRows = lib._openmpt_module_get_pattern_num_rows(modPtr, patternIndex);
    const numChannels = lib._openmpt_module_get_num_channels(modPtr);
    const rows: any[][] = [];

    // Pre-allocate rows
    for (let r = 0; r < numRows; r++) {
      const rowData: any[] = [];
      for (let c = 0; c < numChannels; c++) {
        const note = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 0); // Note
        const inst = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 1); // Instrument
        const volCmd = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 2); // VolCmd
        const volVal = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 3); // VolVal
        const effCmd = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 4); // EffectCmd
        const effVal = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 5); // EffectVal

        rowData.push({
          type: note > 0 ? 'note' : 'empty',
          text: "",
          note, inst, volCmd, volVal, effCmd, effVal
        });
      }
      rows.push(rowData);
    }

    return {
      order: orderIndex,
      patternIndex,
      numRows,
      numChannels,
      rows
    };
  }, []);

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
        try { audioContextRef.current.suspend(); } catch (e) { }
      }
      if (audioWorkletNodeRef.current) {
        try { audioWorkletNodeRef.current.disconnect(); } catch (e) { }
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
      const matrix = getPatternMatrix(modPtr, patIdx, i);
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

    setIsModuleLoaded(true);
    setStatus(`Loaded "${title || fileName}"`);

    // REMOVED AUTO-PLAY FROM HERE. 
    // It prevented the AudioContext from securely starting because it lacked a user gesture on page load.
  }, [getPatternMatrix]);

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

    setModuleInfo(prev => ({ ...prev, order, row, bpm: currentBpm }));
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
    setSyncDebug(prev => ({
      ...prev,
      driftMs: Math.round(driftAccumulatorRef.current * 1000),
      row: row,
      mode: activeEngine
    }));

    lastUpdateTimeRef.current = performance.now() / 1000;
    animationFrameHandle.current = requestAnimationFrame(updateUI);
  }, [isPlaying, activeEngine, sequencerMatrix, kickTrigger, grooveAmount, playbackRowFraction]);

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
    
    setModuleInfo(prev => ({ ...prev, order: targetOrder, row: targetRow }));
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
    if (!libopenmptRef.current) {
      console.error("[PLAY] libopenmpt not initialized");
      setStatus("Error: Audio library not ready");
      return;
    }
    if (!fileDataRef.current) {
      console.error("[PLAY] No module data available (fileDataRef is null)");
      setStatus("Error: No module loaded");
      return;
    }

    console.log('[PLAY] Starting playback...', {
      engine: activeEngine,
      isWorkletSupported,
      hasFileData: !!fileDataRef.current,
      fileDataLength: fileDataRef.current?.length
    });

    try {
      if (!audioContextRef.current) {
        console.log('[PLAY] Creating new AudioContext...');
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
        // New context: worklet module needs to be (re)loaded
        workletLoadedRef.current = false;
      }

      const ctx = audioContextRef.current;
      console.log('[PLAY] AudioContext state:', ctx.state);

      if (ctx.state === 'suspended') {
        console.log('[PLAY] Resuming suspended AudioContext...');
        await ctx.resume();
        console.log('[PLAY] AudioContext resumed, new state:', ctx.state);
      }

      // TIMING FIX: Initialize audio clock reference
      audioClockStartRef.current = ctx.currentTime;
      workletTimeAtStartRef.current = 0;
      driftAccumulatorRef.current = 0;

      // Setup common nodes
      if (!stereoPannerRef.current) {
        console.log('[PLAY] Creating StereoPanner node...');
        stereoPannerRef.current = ctx.createStereoPanner();
        stereoPannerRef.current.pan.value = panValue;
      }
      if (!gainNodeRef.current) {
        console.log('[PLAY] Creating Gain node...');
        gainNodeRef.current = ctx.createGain();
        gainNodeRef.current.gain.value = volume;
      }
      if (!analyserRef.current) {
        console.log('[PLAY] Creating Analyser node...');
        analyserRef.current = ctx.createAnalyser();
        analyserRef.current.fftSize = 2048;
        analyserRef.current.smoothingTimeConstant = 0.8;
      }

      // Disconnect previous source
      if (audioWorkletNodeRef.current) {
        console.log('[PLAY] Disconnecting previous AudioWorkletNode...');
        audioWorkletNodeRef.current.disconnect();
        audioWorkletNodeRef.current = null;
      }

      if (activeEngine === 'native-worklet' && isNativeWorkletAvailable) {
        // ── Native C++/Wasm AudioWorklet engine (Phase 2) ──
        console.log('[PLAY] Using native C++/Wasm AudioWorklet engine...');
        try {
          const engine = nativeEngineRef.current!;

          // Load module data into the native engine
          const buf = fileDataRef.current?.buffer;
          if (buf) {
            console.log('[PLAY] Sending module data to native engine:', buf.byteLength, 'bytes');
            await engine.load(buf as ArrayBuffer);
          }

          // Set engine parameters
          engine.setVolume(volume);
          engine.setLoop(isLooping);

          // Listen for position updates from the native engine
          engine.on('position', (data: WorkletPositionData) => {
            workletOrderRef.current = data.currentOrder;
            workletRowRef.current = data.currentRow;
            workletTimeRef.current = data.positionMs / 1000;
            lastWorkletUpdateRef.current = ctx.currentTime;

            // TIMING FIX: Update BPM ref from worklet
            if (data.bpm && data.bpm > 0) {
              workletBpmRef.current = data.bpm;
            }

            // TIMING FIX: Check for seek acknowledgment
            if (pendingSeekRef.current && 
                data.currentOrder === pendingSeekRef.current.order && 
                data.currentRow === pendingSeekRef.current.row) {
              seekAcknowledgedRef.current = true;
              pendingSeekRef.current = null;
            }

            // Update channel VU data
            const numCh = data.numChannels;
            for (let c = 0; c < numCh && c < channelStatesRef.current.length; c++) {
              const existing = channelStatesRef.current[c];
              channelStatesRef.current[c] = {
                volume: data.channelVU[c] || 0,
                pan: existing?.pan ?? 128,
                freq: existing?.freq ?? 0,
                trigger: (data.channelVU[c] || 0) > 0.5 ? 1 : 0,
                noteAge: existing?.noteAge ?? 0,
                activeEffect: existing?.activeEffect ?? 0,
                effectValue: existing?.effectValue ?? 0,
                isMuted: existing?.isMuted ?? 0,
              };
            }

            // When the engine supplies new pattern data (on order/pattern change),
            // convert it to a PatternMatrix and update the sequencer display.
            if (data.patternData) {
              const pd = data.patternData;
              const rows = pd.rows.map((row) =>
                Array.from({ length: pd.numChannels }, (_, c): import('../types').PatternCell => {
                  const noteVal = row.notes[c];
                  const instVal = row.instruments[c];
                  const volCmdVal = row.volCmds[c];
                  const volVal = row.volVals[c];
                  const effCmdVal = row.effCmds[c];
                  const effVal = row.effVals[c];
                  const hasNote = (noteVal ?? 0) > 0;
                  const hasInst = (instVal ?? 0) > 0;
                  const hasEffect = (effCmdVal ?? 0) > 0 || (effVal ?? 0) > 0;
                  const type = hasNote ? 'note' : hasInst ? 'instrument' : hasEffect ? 'effect' : 'empty';
                  return {
                    type,
                    text: '',
                    note: noteVal && noteVal > 0 ? noteVal : undefined,
                    inst: instVal && instVal > 0 ? instVal : undefined,
                    volCmd: volCmdVal && volCmdVal > 0 ? volCmdVal : undefined,
                    volVal: volVal && volVal > 0 ? volVal : undefined,
                    effCmd: effCmdVal && effCmdVal > 0 ? effCmdVal : undefined,
                    effVal: effVal && effVal > 0 ? effVal : undefined,
                  };
                })
              );
              const matrix = {
                order: data.currentOrder,
                patternIndex: pd.patternIndex,
                numRows: pd.numRows,
                numChannels: pd.numChannels,
                rows,
              };
              patternMatricesRef.current[data.currentOrder] = matrix;
              setSequencerMatrix(matrix);
            }
          });

          engine.on('ended', () => {
            console.log('[PLAY] Native engine reported module ended');
            if (isLooping) {
              seekToStepWrapper(0);
            } else {
              stopMusic(false);
            }
          });

          // Start playback
          engine.play();
          console.log('[PLAY] Native C++/Wasm AudioWorklet engine started');
        } catch (e) {
          console.error("[PLAY] Failed to start native engine:", e);
          console.warn("[PLAY] Falling back to JS AudioWorklet engine");
          setActiveEngine('worklet');
          // Continue to existing worklet path below
        }
      } else if (activeEngine === 'worklet' && isWorkletSupported) {
        console.log('[PLAY] Using AudioWorklet engine...');

        try {
          // Load the worklet module only once per AudioContext
          if (ctx.audioWorklet && !workletLoadedRef.current) {
            console.log('[PLAY] ==================================================');
            console.log('[PLAY] Loading AudioWorklet module...');
            console.log('[PLAY] Resolved URL:', WORKLET_URL);
            console.log('[PLAY] BASE_URL:', import.meta.env.BASE_URL);
            console.log('[PLAY] AudioContext state:', ctx.state);
            console.log('[PLAY] ==================================================');
            await ctx.audioWorklet.addModule(WORKLET_URL);
            workletLoadedRef.current = true;
            console.log('[PLAY] ✅ AudioWorklet module loaded successfully');
          } else {
            console.log('[PLAY] Worklet module already loaded (skipping addModule)');
          }

          console.log('[PLAY] Creating AudioWorkletNode...');
          // Shared WASM memory requires cross-origin isolation (COOP/COEP headers).
          // In production without those headers SharedArrayBuffer is unavailable and
          // new WebAssembly.Memory({ shared: true }) throws a TypeError, killing play().
          // The JS AudioWorklet engine manages its own memory, so shared memory is
          // optional here (only needed for the native C++/Wasm engine).
          let wasmMemory = wasmMemoryRef.current;
          const processorOptions: Record<string, unknown> = {};
          if (!wasmMemory && window.crossOriginIsolated) {
            console.log('[PLAY] Allocating shared WASM.Memory for worklet (16MB)');
            wasmMemory = new WebAssembly.Memory({
              initial: 256, // 256 pages = 16 MB
              maximum: 256,
              shared: true
            });
            wasmMemoryRef.current = wasmMemory;
          }
          if (wasmMemory) processorOptions.memory = wasmMemory;
          const node = new AudioWorkletNode(ctx, 'openmpt-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions
          });
          console.log('[PLAY] AudioWorkletNode created:', node);

          node.port.onmessage = (e) => {
            const { type, order, row, positionSeconds, message, bpm } = e.data;
            
            if (type === 'position') {
              workletOrderRef.current = order;
              workletRowRef.current = row;
              workletTimeRef.current = positionSeconds;
              // TIMING FIX: Use audio context time for consistency
              lastWorkletUpdateRef.current = ctx.currentTime;
              
              // TIMING FIX: Update BPM ref from worklet
              if (bpm && bpm > 0) {
                workletBpmRef.current = bpm;
                setModuleInfo(prev => ({ ...prev, bpm }));
              }

              // TIMING FIX: Check for seek acknowledgment
              if (pendingSeekRef.current && 
                  order === pendingSeekRef.current.order && 
                  row === pendingSeekRef.current.row) {
                seekAcknowledgedRef.current = true;
                pendingSeekRef.current = null;
              }
            } else if (type === 'ended') {
              console.log('[PLAY] Worklet reported module ended');
              if (isLooping) {
                seekToStepWrapper(0);
              } else {
                stopMusic(false);
              }
            } else if (type === 'error') {
              console.error("[PLAY] Worklet error:", message);
              // Detect WASM init failure and fall back to ScriptProcessorNode
              if ((message?.includes('Lib init failed') || message?.includes('WASM library init timeout'))
                  && !spFallbackTriggered.current) {
                spFallbackTriggered.current = true;
                console.warn('[PLAY] Worklet WASM init failed — falling back to ScriptProcessorNode');
                try { node.disconnect(); } catch (_e) { /* ignore */ }
                audioWorkletNodeRef.current = null;

                const lib = libopenmptRef.current;
                const modPtr = currentModulePtr.current;
                if (lib && modPtr) {
                  const SP_BUFFER = 4096;
                  const spNode = ctx.createScriptProcessor(SP_BUFFER, 0, 2);
                  const leftPtr = lib._malloc(4 * SP_BUFFER);
                  const rightPtr = lib._malloc(4 * SP_BUFFER);
                  spLeftBufPtr.current = leftPtr;
                  spRightBufPtr.current = rightPtr;
                  // Best-quality interpolation
                  lib._openmpt_module_set_render_param(modPtr, 2, 8);

                  spNode.onaudioprocess = (audioEvt) => {
                    const outL = audioEvt.outputBuffer.getChannelData(0);
                    const outR = audioEvt.outputBuffer.getChannelData(1);
                    const mPtr = currentModulePtr.current;
                    const mLib = libopenmptRef.current;
                    if (!mLib || !mPtr) { outL.fill(0); outR.fill(0); return; }

                    const written = mLib._openmpt_module_read_float_stereo(
                      mPtr, ctx.sampleRate, SP_BUFFER, leftPtr, rightPtr
                    );
                    if (written > 0) {
                      outL.set(new Float32Array(mLib.HEAPF32.buffer, leftPtr, written));
                      outR.set(new Float32Array(mLib.HEAPF32.buffer, rightPtr, written));
                      if (written < SP_BUFFER) { outL.fill(0, written); outR.fill(0, written); }
                    } else {
                      outL.fill(0); outR.fill(0);
                    }

                    // Update position refs for UI
                    workletOrderRef.current = mLib._openmpt_module_get_current_order(mPtr);
                    workletRowRef.current = mLib._openmpt_module_get_current_row(mPtr);
                    workletTimeRef.current = mLib._openmpt_module_get_position_seconds(mPtr);
                    lastWorkletUpdateRef.current = ctx.currentTime;
                  };

                  spNode.connect(analyserRef.current!);
                  scriptProcessorRef.current = spNode;

                  isPlayingRef.current = true;
                  setIsPlaying(true);
                  setStatus("Playing (ScriptProcessor fallback)...");
                  if (animationFrameHandle.current) cancelAnimationFrame(animationFrameHandle.current);
                  animationFrameHandle.current = requestAnimationFrame(updateUI);
                } else {
                  setStatus("Error: no module loaded for ScriptProcessor fallback");
                }
              } else if (!spFallbackTriggered.current) {
                setStatus("Worklet error: " + message);
              }
            } else if (type === 'loaded') {
              // Module is now loaded inside the worklet – safe to start the UI.
              // This deferred start avoids the ~1-2 s off-timing caused by WASM
              // initialisation happening after isPlaying was already set to true.
              console.log("[PLAY] Worklet loaded module – starting animation");
              isPlayingRef.current = true;
              setIsPlaying(true);
              setStatus("Playing...");
              if (animationFrameHandle.current) cancelAnimationFrame(animationFrameHandle.current);
              animationFrameHandle.current = requestAnimationFrame(updateUI);
            } else if (type === 'seekAck') {
              // TIMING FIX: Worklet acknowledged seek
              seekAcknowledgedRef.current = true;
              pendingSeekRef.current = null;
            }
          };

          // Send module data (cloned, not transferred, so fileDataRef remains valid)
          const buf = fileDataRef.current?.buffer;
          if (buf) {
            console.log('[PLAY] Sending module data to worklet:', buf.byteLength, 'bytes');
            node.port.postMessage({ type: 'load', moduleData: buf });
          } else {
            console.error("[PLAY] No buffer to send to worklet!");
          }

          console.log('[PLAY] Connecting audio graph: worklet -> analyser -> panner -> gain -> destination');
          node.connect(analyserRef.current!);
          analyserRef.current!.connect(stereoPannerRef.current!);
          stereoPannerRef.current!.connect(gainNodeRef.current!);
          gainNodeRef.current!.connect(ctx.destination);

          audioWorkletNodeRef.current = node;
          // Show a loading state while the 4.8 MB WASM finishes initialising.
          // isPlaying will be set to true via the 'loaded' message handler above.
          setStatus("Loading audio engine...");
          console.log('[PLAY] AudioWorklet setup complete – waiting for WASM loaded event');
        } catch (e) {
          console.error("[PLAY] Failed to create/load AudioWorkletNode:", e);
          workletLoadedRef.current = false;
          setStatus("Error: AudioWorklet failed to start (no ScriptProcessor fallback).");
          return;
        }
      } else {
        setStatus("Error: AudioWorklet not supported/available.");
        return;
      }

      if (!audioWorkletNodeRef.current && activeEngine === 'native-worklet') {
        isPlayingRef.current = true;
        setIsPlaying(true);
        setStatus("Playing...");
        animationFrameHandle.current = requestAnimationFrame(updateUI);
      }

    } catch (e) {
      console.error("[PLAY] Play error:", e);
      setStatus("Error starting playback");
    }
  }, [activeEngine, isWorkletSupported, isNativeWorkletAvailable, panValue, volume, isLooping, stopMusic, seekToStepWrapper, updateUI]);

  // Keep playRef always pointing to the latest play function
  // so processModuleData (which memoises over different deps) can call it without stale closure
  playRef.current = play;

  const toggleAudioEngine = useCallback(() => {
    // Cycle: native-worklet → worklet → native-worklet (if available)
    let newEngine: 'worklet' | 'native-worklet';
    if (activeEngine === 'native-worklet') {
      newEngine = 'worklet';
    } else {
      newEngine = isNativeWorkletAvailable ? 'native-worklet' : 'worklet';
    }

    if (isPlaying) {
      setRestartPlayback(true);
      stopMusic(false);
    }
    setActiveEngine(newEngine);
    console.log('[toggleEngine]', activeEngine, '→', newEngine);
  }, [activeEngine, isPlaying, isWorkletSupported, isNativeWorkletAvailable, stopMusic]);

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

        // AudioWorklet support check - API only, NO early addModule() probe
        // The actual worklet module is loaded only during playback via addModule()
        console.log("[INIT] Testing AudioWorklet support (API-level only)...");
        try {
          // Simple API capability check without creating AudioContext or loading modules
          const hasWorklet = typeof window !== 'undefined' && 
            'AudioContext' in window && 
            'audioWorklet' in AudioContext.prototype;
          
          if (hasWorklet) {
            setIsWorkletSupported(true);
            setActiveEngine('worklet');
            console.log('✅ [INIT] AudioWorklet API available (module will load at playback time)');
          } else {
            console.warn("⚠️ [INIT] AudioWorklet API not available in this browser");
            setIsWorkletSupported(false);
            setStatus("Error: AudioWorklet not supported in this browser.");
          }
        } catch (e) {
          console.warn("⚠️ [INIT] AudioWorklet API check failed:", e);
          setIsWorkletSupported(false);
          setStatus("Error: AudioWorklet not supported in this browser.");
        }

        // Probe for native C++/Wasm AudioWorklet engine
        // Note: enabling this requires building the wasm engine using
        // ./scripts/build-wasm.sh (Emscripten SDK must be installed).
        try {
          const nativeGlueUrl = `${RUNTIME_BASE_URL}worklets/openmpt-native.js`;
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
    playbackStateRef
  };
}
