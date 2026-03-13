import { useState, useEffect, useRef, useCallback } from 'react';
import { LibOpenMPT, ModuleInfo, ModuleMetadata, PatternMatrix, ChannelShadowState, PlaybackState } from '../types';
import { OpenMPTWorkletEngine } from '../audio-worklet/OpenMPTWorkletEngine';
import type { WorkletPositionData } from '../audio-worklet/types';
import { decodeEffectCode } from '../utils/effectCodes';

interface SyncDebugInfo {
  mode: string;
  bufferMs: number;
  driftMs: number;
  row: number;
  starvationCount: number;
}

// Use './' so the URL resolves relative to the page, correct in any deployment path
const DEFAULT_MODULE_URL = './4-mat_madness.mod';

// Runtime base URL detection for subdirectory deployment (e.g., /xm-player/)
const detectRuntimeBase = (): string => {
  const viteBase = import.meta.env.BASE_URL;
  if (viteBase && viteBase !== '/') {
    return viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
  }
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  if (pathSegments.length > 0) {
    return `/${pathSegments[0]}/`;
  }
  return '/';
};

const RUNTIME_BASE_URL = detectRuntimeBase();
const WORKLET_URL = `${RUNTIME_BASE_URL}worklets/openmpt-worklet.js`;
console.log('[AudioWorklet] Worklet URL resolved:', WORKLET_URL, '(Vite BASE_URL:', import.meta.env.BASE_URL, ', Runtime base:', RUNTIME_BASE_URL, ')');

// TIMING FIX: Maximum allowed drift before correction (in seconds)
const MAX_DRIFT_SECONDS = 0.1;
// TIMING FIX: Row interpolation smoothing factor
const ROW_INTERPOLATION_SMOOTHING = 0.3;

// Ring buffer audio pump settings
const AUDIO_PUMP_INTERVAL_MS = 20; // Pump every 20ms
const CHUNK_SIZE_FRAMES = 2048; // Render this many frames per chunk
const PRE_BUFFER_CHUNKS = 10; // Pre-buffer this many chunks before starting

export function useLibOpenMPT(initialVolume: number = 0.4) {
  const [status, setStatus] = useState("Initializing...");
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isModuleLoaded, setIsModuleLoaded] = useState(false);
  const [moduleInfo, setModuleInfo] = useState({ title: "None", order: 0, row: 0, bpm: 125, numChannels: 0 });
  const [moduleMetadata, setModuleMetadata] = useState<ModuleMetadata | null>(null);
  const [patternData, _setPatternData] = useState(null);
  const [sequencerMatrix, setSequencerMatrix] = useState(null);
  const [sequencerCurrentRow, setSequencerCurrentRow] = useState(0);
  const [sequencerGlobalRow, setSequencerGlobalRow] = useState(0);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [playbackRowFraction, setPlaybackRowFraction] = useState(0);
  const [totalPatternRows, setTotalPatternRows] = useState(0);
  const [channelStates, setChannelStates] = useState([]);
  const [beatPhase, setBeatPhase] = useState(0);
  const [grooveAmount, _setGrooveAmount] = useState(0);
  const [kickTrigger, _setKickTrigger] = useState(0);
  const [activeChannels, _setActiveChannels] = useState([]);
  const [isLooping, setIsLooping] = useState(true);
  const [panValue, setPanValue] = useState(0);
  const [volume, _setVolume] = useState(initialVolume);
  const [activeEngine, setActiveEngine] = useState<'worklet' | 'native-worklet'>('worklet');
  const [isWorkletSupported, setIsWorkletSupported] = useState(false);
  const [isNativeWorkletAvailable, setIsNativeWorkletAvailable] = useState(false);
  const [restartPlayback, setRestartPlayback] = useState(false);
  const [syncDebug, setSyncDebug] = useState({ mode: "none", bufferMs: 0, driftMs: 0, row: 0, starvationCount: 0 });

  const libopenmptRef = useRef(null);
  const currentModulePtr = useRef(0);
  const audioContextRef = useRef(null);
  
  // ScriptProcessorNode fallback
  const scriptProcessorRef = useRef(null);
  const spLeftBufPtr = useRef(0);
  const spRightBufPtr = useRef(0);
  const spFallbackTriggered = useRef(false);
  
  const audioWorkletNodeRef = useRef(null);
  const wasmMemoryRef = useRef(null);
  const stereoPannerRef = useRef(null);
  const gainNodeRef = useRef(null);
  const analyserRef = useRef(null);

  const fileDataRef = useRef(null);

  const animationFrameHandle = useRef(0);
  const lastUpdateTimeRef = useRef(0);

  // Worklet state tracking
  const workletOrderRef = useRef(0);
  const workletRowRef = useRef(0);
  const workletTimeRef = useRef(0);
  const workletBpmRef = useRef(125);
  const lastWorkletUpdateRef = useRef(0);

  // Data pump for ring buffer
  const audioPumpIntervalRef = useRef(null);
  const audioChunkBuffersRef = useRef({ left: null, right: null });
  const workletSampleRateRef = useRef(0);
  const workletBufferHealthRef = useRef(0);
  const workletStarvationCountRef = useRef(0);

  // Timing refs
  const audioClockStartRef = useRef(0);
  const workletTimeAtStartRef = useRef(0);
  const driftAccumulatorRef = useRef(0);
  const lastCorrectedTimeRef = useRef(0);
  const pendingSeekRef = useRef<{ order: number; row: number; timestamp: number } | null>(null);
  const seekAcknowledgedRef = useRef(true);

  const patternMatricesRef = useRef([]);
  const channelStatesRef = useRef([]);
  const mutedChannelsRef = useRef<boolean[]>([]);

  // Stable refs
  const isPlayingRef = useRef(false);
  const playRef = useRef<(() => Promise) | null>(null);
  const workletLoadedRef = useRef(false);
  const userModuleLoadedRef = useRef(false);

  // Native engine
  const nativeEngineRef = useRef(null);

  // Playback state ref for high-frequency updates
  const playbackStateRef = useRef({
    playheadRow: 0,
    currentOrder: 0,
    timeSec: 0,
    beatPhase: 0,
    kickTrigger: 0,
    grooveAmount: 0.5,
    lastUpdateTimestamp: 0
  });

  isPlayingRef.current = isPlaying;

  const getPatternMatrix = useCallback((modPtr: number, patternIndex: number, orderIndex: number): PatternMatrix => {
    const lib = libopenmptRef.current;
    if (!lib) return { order: orderIndex, patternIndex, numRows: 64, numChannels: 4, rows: [] };

    const numRows = lib._openmpt_module_get_pattern_num_rows(modPtr, patternIndex);
    const numChannels = lib._openmpt_module_get_num_channels(modPtr);
    const rows: any[][] = [];

    for (let r = 0; r < numRows; r++) {
      const rowData: any[] = [];
      for (let c = 0; c < numChannels; c++) {
        const note = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 0);
        const inst = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 1);
        const volCmd = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 2);
        const volVal = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 3);
        const effCmd = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 4);
        const effVal = lib._openmpt_module_get_pattern_row_channel_command(modPtr, patternIndex, r, c, 5);

        // Decode effect to activeEffect ID for visualization (0-15)
        const activeEffect = decodeEffectCode(effCmd, effVal);

        rowData.push({
          type: note > 0 ? 'note' : 'empty',
          text: "",
          note, inst, volCmd, volVal, effCmd, effVal,
          activeEffect
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
    userModuleLoadedRef.current = true;
    setStatus(`Loading "${fileName}"...`);
    await processModuleData(fileData, fileName);
    if (playRef.current) playRef.current();
  }, []);

  const processModuleData = useCallback(async (fileData: Uint8Array, fileName: string) => {
    const lib = libopenmptRef.current;
    if (!lib) {
      console.error("[processModuleData] libopenmpt not initialized");
      return;
    }

    console.log("[processModuleData] Processing module:", fileName, "size:", fileData.byteLength);

    if (isPlayingRef.current) {
      console.log("[processModuleData] Stopping current playback");
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

    fileDataRef.current = fileData;

    // Load module into MAIN thread instance
    const bufferSize = fileData.byteLength;
    const bufferPtr = lib._malloc(bufferSize);
    lib.HEAPU8.set(fileData, bufferPtr);

    const modPtr = lib._openmpt_module_create_from_memory2(bufferPtr, bufferSize, 0, 0, 0, 0, 0, 0, 0);
    lib._free(bufferPtr);

    if (modPtr === 0) {
      setStatus("Error: Failed to load module (invalid format?)");
      return;
    }

    currentModulePtr.current = modPtr;

    // Read metadata
    const getMetadata = (key: string): string => {
      const keyPtr = lib.stringToUTF8(key);
      const valPtr = lib._openmpt_module_get_metadata(modPtr, keyPtr);
      const value = lib.UTF8ToString(valPtr);
      lib._openmpt_free_string(valPtr);
      return value;
    };

    const title = getMetadata("title");
    const artist = getMetadata("artist");
    const tracker = getMetadata("tracker");
    const type = getMetadata("type"); // XM/IT/S3M/MOD format
    const comments = getMetadata("message"); // Module comments/message

    const numOrders = lib._openmpt_module_get_num_orders(modPtr);
    const numChannels = lib._openmpt_module_get_num_channels(modPtr);
    const initialBpm = lib._openmpt_module_get_current_estimated_bpm(modPtr);
    const duration = lib._openmpt_module_get_duration_seconds(modPtr);

    // Get instrument and sample counts
    const numInstruments = lib._openmpt_module_get_num_instruments(modPtr);
    const numSamples = lib._openmpt_module_get_num_samples(modPtr);

    // Read instrument names
    const instruments: string[] = [];
    for (let i = 0; i < numInstruments; i++) {
      const namePtr = lib._openmpt_module_get_instrument_name(modPtr, i);
      const name = lib.UTF8ToString(namePtr);
      lib._openmpt_free_string(namePtr);
      instruments.push(name || "");
    }

    // Read sample names
    const samples: string[] = [];
    for (let i = 0; i < numSamples; i++) {
      const namePtr = lib._openmpt_module_get_sample_name(modPtr, i);
      const name = lib.UTF8ToString(namePtr);
      lib._openmpt_free_string(namePtr);
      samples.push(name || "");
    }

    // Build order list (pattern sequence)
    const orderList: number[] = [];
    for (let i = 0; i < numOrders; i++) {
      orderList.push(lib._openmpt_module_get_order_pattern(modPtr, i));
    }

    // Count unique patterns
    const uniquePatterns = new Set(orderList).size;

    workletBpmRef.current = initialBpm || 125;
    setDurationSeconds(duration || 0);

    // Set full metadata
    setModuleMetadata({
      title: title || fileName,
      artist: artist || "",
      tracker: tracker || "",
      numChannels,
      numOrders,
      numPatterns: uniquePatterns,
      numInstruments,
      numSamples,
      durationSeconds: duration || 0,
      currentBpm: initialBpm || 125,
      instruments,
      samples,
      format: type || "Unknown",
      comments: comments || "",
      orderList,
    });
    const duration = lib._openmpt_module_get_duration_seconds(modPtr);

    workletBpmRef.current = initialBpm || 125;
    setDurationSeconds(duration || 0);

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

    // Reset timing refs
    audioClockStartRef.current = 0;
    workletTimeAtStartRef.current = 0;
    driftAccumulatorRef.current = 0;
    lastCorrectedTimeRef.current = 0;
    pendingSeekRef.current = null;
    seekAcknowledgedRef.current = true;

    setIsModuleLoaded(true);
    setStatus(`Loaded "${title || fileName}"`);
  }, [getPatternMatrix]);

  // Start the audio data pump for ring buffer
  const startAudioPump = useCallback(() => {
    if (audioPumpIntervalRef.current) {
      clearInterval(audioPumpIntervalRef.current);
    }

    const lib = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    if (!lib || !modPtr) return;

    // Allocate chunk buffers if not already done
    if (!audioChunkBuffersRef.current.left) {
      audioChunkBuffersRef.current.left = lib._malloc(4 * CHUNK_SIZE_FRAMES);
      audioChunkBuffersRef.current.right = lib._malloc(4 * CHUNK_SIZE_FRAMES);
    }

    const leftPtr = audioChunkBuffersRef.current.left;
    const rightPtr = audioChunkBuffersRef.current.right;
    
    // Get actual sample rate from AudioContext
    const sampleRate = audioContextRef.current?.sampleRate || 48000;
    console.log('[AudioPump] Starting with sample rate:', sampleRate);

    let prebufferCount = 0;
    let isPrebuffering = true;

    // Set best quality interpolation on the main thread module too
    lib._openmpt_module_set_render_param(modPtr, 2, 8);

    audioPumpIntervalRef.current = setInterval(() => {
      if (!isPlayingRef.current || !currentModulePtr.current) return;

      // Pump multiple chunks per interval to keep buffer full
      const chunksToPump = isPrebuffering ? PRE_BUFFER_CHUNKS : 2;
      
      for (let i = 0; i < chunksToPump; i++) {
        // Render audio from libopenmpt using the CORRECT sample rate
        const written = lib._openmpt_module_read_float_stereo(
          currentModulePtr.current,
          sampleRate, // FIXED: Use actual AudioContext sample rate, not hardcoded 44100
          CHUNK_SIZE_FRAMES,
          leftPtr,
          rightPtr
        );

        if (written === 0) {
          // Module ended
          if (isLooping) {
            // Seek back to start
            lib._openmpt_module_set_position_order_row(currentModulePtr.current, 0, 0);
          } else {
            // Stop playback
            if (audioPumpIntervalRef.current) {
              clearInterval(audioPumpIntervalRef.current);
              audioPumpIntervalRef.current = null;
            }
            stopMusic(false);
          }
          return;
        }

        // Copy data to send to worklet
        const leftData = new Float32Array(lib.HEAPF32.buffer, leftPtr, written);
        const rightData = new Float32Array(lib.HEAPF32.buffer, rightPtr, written);

        // Send to worklet
        if (audioWorkletNodeRef.current) {
          audioWorkletNodeRef.current.port.postMessage({
            type: 'audioData',
            audioData: [
              new Float32Array(leftData), // Clone the data
              new Float32Array(rightData)
            ]
          });
        }
      }

      if (isPrebuffering) {
        prebufferCount += chunksToPump;
        if (prebufferCount >= PRE_BUFFER_CHUNKS) {
          isPrebuffering = false;
          console.log('[AudioPump] Pre-buffering complete, starting playback');
        }
      }
    }, AUDIO_PUMP_INTERVAL_MS);

    console.log('[AudioPump] Started pumping audio every', AUDIO_PUMP_INTERVAL_MS, 'ms');
  }, [isLooping]);

  // Stop the audio data pump
  const stopAudioPump = useCallback(() => {
    if (audioPumpIntervalRef.current) {
      clearInterval(audioPumpIntervalRef.current);
      audioPumpIntervalRef.current = null;
      console.log('[AudioPump] Stopped');
    }
  }, []);

  const updateUI = useCallback(() => {
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
      order = workletOrderRef.current;
      row = workletRowRef.current;
      time = workletTimeRef.current;
      currentBpm = workletBpmRef.current;

      if (audioCtx && lastWorkletUpdateRef.current > 0) {
        const now = audioCtx.currentTime;
        const elapsedSinceWorkletUpdate = now - lastWorkletUpdateRef.current;

        if (elapsedSinceWorkletUpdate < 0.1) {
          const rowsPerSecond = currentBpm / 60 / 4;
          rowFraction = Math.min(1, elapsedSinceWorkletUpdate * rowsPerSecond);

          const expectedTime = workletTimeRef.current + elapsedSinceWorkletUpdate;
          const drift = time - expectedTime;
          driftAccumulatorRef.current = driftAccumulatorRef.current * 0.9 + drift * 0.1;

          if (Math.abs(driftAccumulatorRef.current) > MAX_DRIFT_SECONDS) {
            time = expectedTime + driftAccumulatorRef.current * 0.5;
            lastCorrectedTimeRef.current = now;
          } else {
            time = expectedTime;
          }
        } else {
          rowFraction = 0;
        }
      }
    } else {
      if (!lib || modPtr === 0) return;
      order = lib._openmpt_module_get_current_order(modPtr);
      row = lib._openmpt_module_get_current_row(modPtr);
      time = lib._openmpt_module_get_position_seconds(modPtr);
    }

    if (pendingSeekRef.current && !seekAcknowledgedRef.current) {
      const seekAge = audioCtx ? audioCtx.currentTime - pendingSeekRef.current.timestamp : 0;
      if (seekAge > 0.5) {
        seekAcknowledgedRef.current = true;
        pendingSeekRef.current = null;
      }
    }

    if (sequencerMatrix?.order !== order) {
      const newMatrix = patternMatricesRef.current[order];
      if (newMatrix) setSequencerMatrix(newMatrix);
    }

    setModuleInfo(prev => ({ ...prev, order, row, bpm: currentBpm }));
    setSequencerCurrentRow(row);
    setPlaybackSeconds(time);

    let globalRow = 0;
    for (let i = 0; i < order; i++) {
      globalRow += patternMatricesRef.current[i]?.numRows || 64;
    }
    setSequencerGlobalRow(globalRow + row);

    const smoothedRowFraction = rowFraction * ROW_INTERPOLATION_SMOOTHING + (playbackRowFraction * (1 - ROW_INTERPOLATION_SMOOTHING));
    setPlaybackRowFraction(smoothedRowFraction);

    const beatPhaseValue = (time * 2) % 1;
    setBeatPhase(beatPhaseValue);

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

    // Update sync debug with buffer health from worklet
    setSyncDebug(prev => ({
      ...prev,
      driftMs: Math.round(driftAccumulatorRef.current * 1000),
      row: row,
      mode: activeEngine,
      bufferMs: Math.round(workletBufferHealthRef.current * 5000), // 5 seconds max
      starvationCount: workletStarvationCountRef.current
    }));

    lastUpdateTimeRef.current = performance.now() / 1000;
    animationFrameHandle.current = requestAnimationFrame(updateUI);
  }, [isPlaying, activeEngine, sequencerMatrix, kickTrigger, grooveAmount, playbackRowFraction]);

  const stopMusic = useCallback((destroy: boolean = false) => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (animationFrameHandle.current) cancelAnimationFrame(animationFrameHandle.current);

    // Stop audio pump
    stopAudioPump();

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
  }, [stopAudioPump]);

  // Mute/solo functionality
  const muteChannel = useCallback((channel: number, muted: boolean) => {
    const lib = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    if (!lib || modPtr === 0) return;

    // Update libopenmpt mute state (0 = unmuted, 1 = muted)
    lib._openmpt_module_set_channel_mute(modPtr, channel, muted ? 1 : 0);

    // Update local tracking
    const currentMuted = [...mutedChannelsRef.current];
    currentMuted[channel] = muted;
    mutedChannelsRef.current = currentMuted;

    // Update channel states for visualization
    if (channelStatesRef.current[channel]) {
      channelStatesRef.current[channel].isMuted = muted ? 1 : 0;
    }

    console.log(`[Mute] Channel ${channel + 1} ${muted ? 'muted' : 'unmuted'}`);
  }, []);

  const soloChannel = useCallback((channel: number) => {
    const lib = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    if (!lib || modPtr === 0) return;

    const numChannels = lib._openmpt_module_get_num_channels(modPtr);
    const isCurrentlySolo = mutedChannelsRef.current.filter(m => !m).length === 1 && !mutedChannelsRef.current[channel];

    if (isCurrentlySolo) {
      // Unsolo - unmute all channels
      for (let i = 0; i < numChannels; i++) {
        lib._openmpt_module_set_channel_mute(modPtr, i, 0);
        mutedChannelsRef.current[i] = false;
        if (channelStatesRef.current[i]) {
          channelStatesRef.current[i].isMuted = 0;
        }
      }
      console.log('[Solo] Released - all channels unmuted');
    } else {
      // Solo this channel - mute all others
      for (let i = 0; i < numChannels; i++) {
        const shouldMute = i !== channel;
        lib._openmpt_module_set_channel_mute(modPtr, i, shouldMute ? 1 : 0);
        mutedChannelsRef.current[i] = shouldMute;
        if (channelStatesRef.current[i]) {
          channelStatesRef.current[i].isMuted = shouldMute ? 1 : 0;
        }
      }
      console.log(`[Solo] Channel ${channel + 1} soloed`);
    }
  }, []);

  const isChannelMuted = useCallback((channel: number): boolean => {
    return mutedChannelsRef.current[channel] ?? false;
  }, []);

  // Pattern navigation
  const currentOrderRef = useRef(0);
  
  const goToPattern = useCallback((orderIndex: number) => {
    const lib = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    if (!lib || modPtr === 0) return;

    const numOrders = lib._openmpt_module_get_num_orders(modPtr);
    const clampedOrder = Math.max(0, Math.min(orderIndex, numOrders - 1));
    
    // Seek to start of the specified pattern
    lib._openmpt_module_set_position_order_row(modPtr, clampedOrder, 0);
    currentOrderRef.current = clampedOrder;
    
    // Update UI state
    workletOrderRef.current = clampedOrder;
    workletRowRef.current = 0;
    setSequencerCurrentRow(0);
    setModuleInfo(prev => ({ ...prev, order: clampedOrder, row: 0 }));
    
    // Update the matrix display
    const newMatrix = patternMatricesRef.current[clampedOrder];
    if (newMatrix) setSequencerMatrix(newMatrix);
    
    console.log(`[Navigation] Jumped to pattern ${clampedOrder + 1}/${numOrders}`);
  }, []);

  const previousPattern = useCallback(() => {
    goToPattern(currentOrderRef.current - 1);
  }, [goToPattern]);

  const nextPattern = useCallback(() => {
    goToPattern(currentOrderRef.current + 1);
  }, [goToPattern]);

  const seekToStepWrapper = useCallback((step: number) => {
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

    const audioCtx = audioContextRef.current;
    pendingSeekRef.current = {
      order: targetOrder,
      row: targetRow,
      timestamp: audioCtx ? audioCtx.currentTime : performance.now() / 1000
    };
    seekAcknowledgedRef.current = false;

    lib._openmpt_module_set_position_order_row(modPtr, targetOrder, targetRow);

    workletOrderRef.current = targetOrder;
    workletRowRef.current = targetRow;

    setModuleInfo(prev => ({ ...prev, order: targetOrder, row: targetRow }));
    setSequencerCurrentRow(targetRow);
    setSequencerGlobalRow(step);

    driftAccumulatorRef.current = 0;
    lastWorkletUpdateRef.current = audioCtx ? audioCtx.currentTime : 0;

    if (activeEngine === 'native-worklet' && nativeEngineRef.current) {
      nativeEngineRef.current.seek(targetOrder, targetRow);
      seekAcknowledgedRef.current = true;
    } else if (activeEngine === 'worklet' && audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.postMessage({
        type: 'seek',
        order: targetOrder,
        row: targetRow,
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
      console.error("[PLAY] No module data available");
      setStatus("Error: No module loaded");
      return;
    }

    console.log('[PLAY] Starting playback...', {
      engine: activeEngine,
      hasFileData: !!fileDataRef.current,
      fileDataLength: fileDataRef.current?.length
    });

    try {
      if (!audioContextRef.current) {
        console.log('[PLAY] Creating new AudioContext...');
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ 
          latencyHint: 'playback'
        });
        workletLoadedRef.current = false;
      }

      const ctx = audioContextRef.current;
      console.log('[PLAY] AudioContext state:', ctx.state, 'sample rate:', ctx.sampleRate);

      if (ctx.state === 'suspended') {
        await ctx.resume();
        console.log('[PLAY] AudioContext resumed');
      }

      audioClockStartRef.current = ctx.currentTime;
      workletTimeAtStartRef.current = 0;
      driftAccumulatorRef.current = 0;

      // Setup audio nodes
      if (!stereoPannerRef.current) {
        stereoPannerRef.current = ctx.createStereoPanner();
        stereoPannerRef.current.pan.value = panValue;
      }
      if (!gainNodeRef.current) {
        gainNodeRef.current = ctx.createGain();
        gainNodeRef.current.gain.value = volume;
      }
      if (!analyserRef.current) {
        analyserRef.current = ctx.createAnalyser();
        analyserRef.current.fftSize = 2048;
        analyserRef.current.smoothingTimeConstant = 0.8;
      }

      if (audioWorkletNodeRef.current) {
        audioWorkletNodeRef.current.disconnect();
        audioWorkletNodeRef.current = null;
      }

      if (activeEngine === 'native-worklet' && isNativeWorkletAvailable) {
        // Native engine path
        console.log('[PLAY] Using native C++/Wasm AudioWorklet engine...');
        try {
          const engine = nativeEngineRef.current!;
          const buf = fileDataRef.current?.buffer;
          if (buf) {
            await engine.load(buf as ArrayBuffer);
          }
          engine.setVolume(volume);
          engine.setLoop(isLooping);

          engine.on('position', (data: WorkletPositionData) => {
            const now = ctx.currentTime;
            workletOrderRef.current = data.currentOrder;
            workletRowRef.current = data.currentRow;
            workletTimeRef.current = data.positionMs / 1000;
            lastWorkletUpdateRef.current = now;

            if (data.bpm && data.bpm > 0) {
              workletBpmRef.current = data.bpm;
            }

            if (pendingSeekRef.current &&
                data.currentOrder === pendingSeekRef.current.order &&
                data.currentRow === pendingSeekRef.current.row) {
              seekAcknowledgedRef.current = true;
              pendingSeekRef.current = null;
            }

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
            if (isLooping) {
              seekToStepWrapper(0);
            } else {
              stopMusic(false);
            }
          });

          engine.play();
          isPlayingRef.current = true;
          setIsPlaying(true);
          setStatus("Playing...");
          animationFrameHandle.current = requestAnimationFrame(updateUI);
        } catch (e) {
          console.error("[PLAY] Failed to start native engine:", e);
          setActiveEngine('worklet');
        }
      } else if (activeEngine === 'worklet' && isWorkletSupported) {
        console.log('[PLAY] Using JS AudioWorklet with ring buffer...');

        try {
          if (ctx.audioWorklet && !workletLoadedRef.current) {
            console.log('[PLAY] Loading AudioWorklet module:', WORKLET_URL);
            await ctx.audioWorklet.addModule(WORKLET_URL);
            workletLoadedRef.current = true;
            console.log('[PLAY] AudioWorklet module loaded');
          }

          // Allocate shared WASM memory if available
          let wasmMemory = wasmMemoryRef.current;
          const processorOptions: Record<string, any> = {};
          if (!wasmMemory && window.crossOriginIsolated) {
            console.log('[PLAY] Allocating shared WASM.Memory (16MB)');
            wasmMemory = new WebAssembly.Memory({
              initial: 256,
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

          // Handle messages from worklet
          node.port.onmessage = (e) => {
            const { type, order, row, positionSeconds, message, bpm, bufferHealth, starvationCount, sampleRate } = e.data;

            if (type === 'position') {
              const now = ctx.currentTime;
              workletOrderRef.current = order;
              workletRowRef.current = row;
              workletTimeRef.current = positionSeconds;
              lastWorkletUpdateRef.current = now;

              if (bpm && bpm > 0) {
                workletBpmRef.current = bpm;
              }

              // Track buffer health from worklet
              if (bufferHealth !== undefined) {
                workletBufferHealthRef.current = bufferHealth;
              }
              if (starvationCount !== undefined) {
                workletStarvationCountRef.current = starvationCount;
              }

              if (pendingSeekRef.current &&
                  order === pendingSeekRef.current.order &&
                  row === pendingSeekRef.current.row) {
                seekAcknowledgedRef.current = true;
                pendingSeekRef.current = null;
              }
            } else if (type === 'ended') {
              if (isLooping) {
                seekToStepWrapper(0);
              } else {
                stopMusic(false);
              }
            } else if (type === 'loaded') {
              // Worklet is ready - start the audio pump
              console.log('[PLAY] Worklet loaded, sample rate:', sampleRate);
              workletSampleRateRef.current = sampleRate;
              
              // Start audio pump to feed the ring buffer
              startAudioPump();
              
              isPlayingRef.current = true;
              setIsPlaying(true);
              setStatus("Playing...");
              animationFrameHandle.current = requestAnimationFrame(updateUI);
            } else if (type === 'needData') {
              // Worklet needs more data - pump will handle this automatically
              log('[PLAY] Worklet requested data refill');
            } else if (type === 'starvation') {
              console.warn('[PLAY] Buffer starvation detected:', starvationCount);
            } else if (type === 'error') {
              console.error("[PLAY] Worklet error:", message);
              handleWorkletError(message, node);
            } else if (type === 'seekAck') {
              seekAcknowledgedRef.current = true;
              pendingSeekRef.current = null;
            }
          };

          // Send module data to worklet
          const buf = fileDataRef.current?.buffer;
          if (buf) {
            console.log('[PLAY] Sending module data to worklet:', buf.byteLength, 'bytes');
            node.port.postMessage({ type: 'load', moduleData: buf });
          }

          // Connect audio graph
          node.connect(analyserRef.current!);
          analyserRef.current!.connect(stereoPannerRef.current!);
          stereoPannerRef.current!.connect(gainNodeRef.current!);
          gainNodeRef.current!.connect(ctx.destination);

          audioWorkletNodeRef.current = node;
          setStatus("Loading audio engine...");

        } catch (e) {
          console.error("[PLAY] Failed to create AudioWorkletNode:", e);
          workletLoadedRef.current = false;
          setStatus("Error: AudioWorklet failed to start.");
        }
      } else {
        setStatus("Error: AudioWorklet not supported.");
      }
    } catch (e) {
      console.error("[PLAY] Play error:", e);
      setStatus("Error starting playback");
    }
  }, [activeEngine, isWorkletSupported, isNativeWorkletAvailable, panValue, volume, isLooping, stopMusic, seekToStepWrapper, updateUI, startAudioPump]);

  // Handle worklet errors with ScriptProcessorNode fallback
  const handleWorkletError = (message: string, node: AudioWorkletNode) => {
    if ((message?.includes('Lib init failed') || message?.includes('WASM library init timeout'))
        && !spFallbackTriggered.current) {
      spFallbackTriggered.current = true;
      console.warn('[PLAY] Worklet WASM init failed - falling back to ScriptProcessorNode');
      
      try { node.disconnect(); } catch (e) { }
      audioWorkletNodeRef.current = null;

      const lib = libopenmptRef.current;
      const modPtr = currentModulePtr.current;
      const ctx = audioContextRef.current;
      
      if (lib && modPtr && ctx) {
        // Use actual sample rate from AudioContext
        const sampleRate = ctx.sampleRate;
        const SP_BUFFER = 4096;
        const spNode = ctx.createScriptProcessor(SP_BUFFER, 0, 2);
        const leftPtr = lib._malloc(4 * SP_BUFFER);
        const rightPtr = lib._malloc(4 * SP_BUFFER);
        spLeftBufPtr.current = leftPtr;
        spRightBufPtr.current = rightPtr;
        lib._openmpt_module_set_render_param(modPtr, 2, 8);

        spNode.onaudioprocess = (audioEvt) => {
          const outL = audioEvt.outputBuffer.getChannelData(0);
          const outR = audioEvt.outputBuffer.getChannelData(1);
          const mPtr = currentModulePtr.current;
          const mLib = libopenmptRef.current;
          if (!mLib || !mPtr) { outL.fill(0); outR.fill(0); return; }

          // FIXED: Use actual AudioContext sample rate
          const written = mLib._openmpt_module_read_float_stereo(
            mPtr, sampleRate, SP_BUFFER, leftPtr, rightPtr
          );
          
          if (written > 0) {
            outL.set(new Float32Array(mLib.HEAPF32.buffer, leftPtr, written));
            outR.set(new Float32Array(mLib.HEAPF32.buffer, rightPtr, written));
            if (written < SP_BUFFER) { outL.fill(0, written); outR.fill(0, written); }
          } else {
            outL.fill(0); outR.fill(0);
          }

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
      }
    } else if (!spFallbackTriggered.current) {
      setStatus("Worklet error: " + message);
    }
  };

  playRef.current = play;

  const toggleAudioEngine = useCallback(() => {
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
        return;
      }

      try {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Initialization timed out')), 15000);
        });

        const lib = await Promise.race([window.libopenmptReady, timeoutPromise]);
        console.log("[INIT] libopenmptReady resolved");

        if (!lib.UTF8ToString) {
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

        // AudioWorklet support check
        try {
          const hasWorklet = typeof window !== 'undefined' &&
            'AudioContext' in window &&
            'audioWorklet' in AudioContext.prototype;

          if (hasWorklet) {
            setIsWorkletSupported(true);
            setActiveEngine('worklet');
            console.log('✅ [INIT] AudioWorklet API available');
          } else {
            console.warn("⚠️ [INIT] AudioWorklet not available");
            setIsWorkletSupported(false);
            setStatus("Error: AudioWorklet not supported.");
          }
        } catch (e) {
          console.warn("⚠️ [INIT] AudioWorklet check failed:", e);
          setIsWorkletSupported(false);
        }

        // Probe for native engine
        try {
          const nativeGlueUrl = `${RUNTIME_BASE_URL}worklets/openmpt-native.js`;
          console.log('[INIT] Probing for native engine at:', nativeGlueUrl);
          const probeResp = await fetch(nativeGlueUrl, { method: 'HEAD' });
          if (probeResp.ok) {
            console.log('[INIT] Native C++/Wasm engine available');
            const engine = new OpenMPTWorkletEngine();
            await engine.init();
            nativeEngineRef.current = engine;
            setIsNativeWorkletAvailable(true);
            setActiveEngine('native-worklet');
          } else {
            console.log('[INIT] Native engine not found');
          }
        } catch (nativeErr) {
          console.log('[INIT] Native engine not available:', nativeErr);
        }
      } catch (e) {
        const error = e as Error;
        setStatus(error.message === 'Initialization timed out' 
          ? "Error: libopenmpt initialization timed out."
          : `Error: ${error.message || 'Audio library failed'}`);
      }
    };
    init();

    return () => {
      stopAudioPump();
      if (nativeEngineRef.current) {
        nativeEngineRef.current.destroy();
        nativeEngineRef.current = null;
      }
      if (audioWorkletNodeRef.current) audioWorkletNodeRef.current.disconnect();
      if (stereoPannerRef.current) stereoPannerRef.current.disconnect();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      if (currentModulePtr.current !== 0 && libopenmptRef.current) {
        libopenmptRef.current._openmpt_module_destroy(currentModulePtr.current);
      }
      cancelAnimationFrame(animationFrameHandle.current);
    };
  }, [stopAudioPump]);

  useEffect(() => {
    if (stereoPannerRef.current) {
      stereoPannerRef.current.pan.value = panValue;
    }
  }, [panValue]);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume;
    }
    if (nativeEngineRef.current) {
      nativeEngineRef.current.setVolume(volume);
    }
  }, [volume]);

  // Load default module
  useEffect(() => {
    if (isReady && !userModuleLoadedRef.current) {
      const loadDefault = async () => {
        const fileName = DEFAULT_MODULE_URL.split('/').pop() || 'default.mod';
        setStatus(`Fetching "${fileName}"...`);
        try {
          const response = await fetch(DEFAULT_MODULE_URL);
          if (!response.ok) throw new Error(`Failed: ${response.statusText}`);
          const arrayBuffer = await response.arrayBuffer();
          const fileData = new Uint8Array(arrayBuffer);
          await processModuleData(fileData, fileName);
        } catch (e) {
          console.error("Failed to load default module:", e);
          setStatus(`Error fetching default module.`);
        }
      };
      loadDefault();
    }
  }, [isReady, processModuleData]);

  return {
    status, isReady, isPlaying, isModuleLoaded, moduleInfo, moduleMetadata, patternData,
    loadFile: loadModule, play, stopMusic, sequencerMatrix, sequencerCurrentRow, sequencerGlobalRow,
    totalPatternRows, playbackSeconds, durationSeconds, playbackRowFraction, channelStates, beatPhase, grooveAmount, kickTrigger, activeChannels,
    isLooping, setIsLooping, seekToStep: seekToStepWrapper, panValue, setPanValue,
    activeEngine, isWorkletSupported, toggleAudioEngine, syncDebug,
    analyserNode: analyserRef.current,
    playbackStateRef,
    // Channel mute/solo
    muteChannel,
    soloChannel,
    isChannelMuted,
    // Pattern navigation
    previousPattern,
    nextPattern,
    goToPattern
  };
}
