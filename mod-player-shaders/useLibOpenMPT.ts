// @ts-nocheck

/// <reference types="vite/client" />

import { useState, useEffect, useRef, useCallback } from 'react';
import { ModuleMetadata, PatternMatrix } from '../types';
import { OpenMPTWorkletEngine } from '../audio-worklet/OpenMPTWorkletEngine';
import { getPatternMatrix } from './utils/patternExtractor';
import { processModuleData as processModuleDataFn, startAudioPlayback } from './hooks/useAudioGraph';

interface SyncDebugInfo {
  mode: string;
  bufferMs: number;
  driftMs: number;
  row: number;
  starvationCount: number;
}

const DEFAULT_MODULE_URL = './4-mat_madness.mod';

const detectRuntimeBase = (): string => {
  const viteBase = import.meta.env.BASE_URL;
  if (viteBase && viteBase !== '/') {
    return viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
  }
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  if (pathSegments.length > 0) return `/${pathSegments[0]}/`;
  return '/';
};

const RUNTIME_BASE_URL = detectRuntimeBase();
const WORKLET_URL = `${RUNTIME_BASE_URL}worklets/openmpt-worklet.js`;
console.log('[AudioWorklet] Worklet URL resolved:', WORKLET_URL);

const MAX_DRIFT_SECONDS = 0.1;
const ROW_INTERPOLATION_SMOOTHING = 0.3;
const AUDIO_PUMP_INTERVAL_MS = 20;
const CHUNK_SIZE_FRAMES = 2048;
const PRE_BUFFER_CHUNKS = 10;

export function useLibOpenMPT(initialVolume: number = 0.4) {
  const [status, setStatus] = useState("Initializing...");
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isModuleLoaded, setIsModuleLoaded] = useState(false);
  const [moduleInfo, setModuleInfo] = useState({ title: "None", order: 0, row: 0, bpm: 125, numChannels: 0 });
  const [moduleMetadata, setModuleMetadata] = useState<ModuleMetadata | null>(null);
  const [patternData] = useState<any>(null);
  const [sequencerMatrix, setSequencerMatrix] = useState(null);
  const [sequencerCurrentRow, setSequencerCurrentRow] = useState(0);
  const [sequencerGlobalRow, setSequencerGlobalRow] = useState(0);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [playbackRowFraction, setPlaybackRowFraction] = useState(0);
  const [totalPatternRows, setTotalPatternRows] = useState(0);
  const [channelStates, setChannelStates] = useState<any[]>([]);
  const [beatPhase, setBeatPhase] = useState(0);
  const [grooveAmount] = useState(0);
  const [kickTrigger] = useState(0);
  const [activeChannels] = useState([]);
  const [isLooping, setIsLooping] = useState(true);
  const [panValue, setPanValue] = useState(0);
  const [volume] = useState(initialVolume);
  const [activeEngine, setActiveEngine] = useState<'worklet' | 'native-worklet'>('worklet');
  const [isWorkletSupported, setIsWorkletSupported] = useState(false);
  const [isNativeWorkletAvailable, setIsNativeWorkletAvailable] = useState(false);
  const [restartPlayback, setRestartPlayback] = useState(false);
  const [syncDebug, setSyncDebug] = useState({ mode: "none", bufferMs: 0, driftMs: 0, row: 0, starvationCount: 0 });

  const libopenmptRef = useRef<any>(null);
  const currentModulePtr = useRef<any>(0);
  const audioContextRef = useRef<any>(null);
  const scriptProcessorRef = useRef<any>(null);
  const spLeftBufPtr = useRef(0);
  const spRightBufPtr = useRef(0);
  const spFallbackTriggered = useRef(false);
  const audioWorkletNodeRef = useRef(null);
  const wasmMemoryRef = useRef<any>(null);
  const stereoPannerRef = useRef<any>(null);
  const gainNodeRef = useRef<any>(null);
  const analyserRef = useRef<any>(null);
  const fileDataRef = useRef(null);
  const animationFrameHandle = useRef(0);
  const lastUpdateTimeRef = useRef(0);

  const workletOrderRef = useRef(0);
  const workletRowRef = useRef(0);
  const workletTimeRef = useRef(0);
  const workletBpmRef = useRef(125);
  const lastWorkletUpdateRef = useRef(0);

  const audioPumpIntervalRef = useRef(null);
  const audioChunkBuffersRef = useRef({ left: null, right: null });
  const workletSampleRateRef = useRef(0);
  const workletBufferHealthRef = useRef(0);
  const workletStarvationCountRef = useRef(0);

  const audioClockStartRef = useRef(0);
  const workletTimeAtStartRef = useRef(0);
  const driftAccumulatorRef = useRef(0);
  const lastCorrectedTimeRef = useRef(0);
  const pendingSeekRef = useRef<{ order: number; row: number; timestamp: number } | null>(null);
  const seekAcknowledgedRef = useRef(true);

  const patternMatricesRef = useRef([]);
  const channelStatesRef = useRef([]);
  const mutedChannelsRef = useRef<boolean[]>([]);

  const isPlayingRef = useRef(false);
  const playRef = useRef<(() => Promise<any>) | null>(null);
  const workletLoadedRef = useRef(false);
  const userModuleLoadedRef = useRef(false);
  const nativeEngineRef = useRef(null);

  const playbackStateRef = useRef({
    playheadRow: 0, currentOrder: 0, timeSec: 0, beatPhase: 0,
    kickTrigger: 0, grooveAmount: 0.5, lastUpdateTimestamp: 0,
  });

  isPlayingRef.current = isPlaying;

  const loadModule = useCallback(async (fileData: Uint8Array, fileName: string) => {
    if (!libopenmptRef.current) return;
    userModuleLoadedRef.current = true;
    setStatus(`Loading "${fileName}"...`);
    await _processModuleData(fileData, fileName);
    if (playRef.current) playRef.current();
  }, []);

  // Thin wrapper – body extracted to hooks/useAudioGraph.ts
  const _processModuleData = useCallback(async (fileData, fileName) => {
    await processModuleDataFn(
      {
        libopenmptRef, currentModulePtr, isPlayingRef, animationFrameHandle,
        audioContextRef, audioWorkletNodeRef, fileDataRef, workletBpmRef,
        patternMatricesRef, channelStatesRef, audioClockStartRef,
        workletTimeAtStartRef, driftAccumulatorRef, lastCorrectedTimeRef,
        pendingSeekRef, seekAcknowledgedRef,
      },
      {
        setStatus, setIsPlaying, setDurationSeconds, setModuleMetadata,
        setModuleInfo, setTotalPatternRows, setSequencerMatrix,
        setSequencerCurrentRow, setSequencerGlobalRow, setChannelStates,
        setIsModuleLoaded,
      },
      fileData, fileName,
    );
  }, []);

  const startAudioPump = useCallback(() => {
    if (audioPumpIntervalRef.current) clearInterval(audioPumpIntervalRef.current);
    const lib: any = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    if (!lib || !modPtr) return;

    if (!audioChunkBuffersRef.current.left) {
      audioChunkBuffersRef.current.left  = lib._malloc(4 * CHUNK_SIZE_FRAMES);
      audioChunkBuffersRef.current.right = lib._malloc(4 * CHUNK_SIZE_FRAMES);
    }

    const leftPtr  = audioChunkBuffersRef.current.left;
    const rightPtr = audioChunkBuffersRef.current.right;
    const sampleRate = audioContextRef.current?.sampleRate || 48000;
    console.log('[AudioPump] Starting with sample rate:', sampleRate);

    let prebufferCount = 0;
    let isPrebuffering = true;
    lib._openmpt_module_set_render_param(modPtr, 2, 8);

    audioPumpIntervalRef.current = setInterval(() => {
      if (!isPlayingRef.current || !currentModulePtr.current) return;
      const chunksToPump = isPrebuffering ? PRE_BUFFER_CHUNKS : 2;

      for (let i = 0; i < chunksToPump; i++) {
        const written = lib._openmpt_module_read_float_stereo(
          currentModulePtr.current, sampleRate, CHUNK_SIZE_FRAMES, leftPtr, rightPtr
        );
        if (written === 0) {
          if (isLooping) {
            lib._openmpt_module_set_position_order_row(currentModulePtr.current, 0, 0);
          } else {
            if (audioPumpIntervalRef.current) {
              clearInterval(audioPumpIntervalRef.current);
              audioPumpIntervalRef.current = null;
            }
            stopMusic(false);
          }
          return;
        }
        const leftData  = new Float32Array(lib.HEAPF32.buffer, leftPtr, written);
        const rightData = new Float32Array(lib.HEAPF32.buffer, rightPtr, written);
        if (audioWorkletNodeRef.current) {
          audioWorkletNodeRef.current.port.postMessage({
            type: 'audioData',
            audioData: [new Float32Array(leftData), new Float32Array(rightData)],
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

  const stopAudioPump = useCallback(() => {
    if (audioPumpIntervalRef.current) {
      clearInterval(audioPumpIntervalRef.current);
      audioPumpIntervalRef.current = null;
      console.log('[AudioPump] Stopped');
    }
  }, []);

  const updateUI = useCallback(() => {
    if (!isPlayingRef.current) return;
    const lib: any = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    const audioCtx = audioContextRef.current;

    let order = 0, row = 0, time = 0, rowFraction = 0;
    let currentBpm = workletBpmRef.current;

    if ((activeEngine === 'worklet' || activeEngine === 'native-worklet') && (audioWorkletNodeRef.current || nativeEngineRef.current)) {
      order = workletOrderRef.current;
      row = workletRowRef.current;
      time = workletTimeRef.current;
      currentBpm = workletBpmRef.current;

      if (audioCtx && lastWorkletUpdateRef.current > 0) {
        const now = audioCtx.currentTime;
        const elapsed = now - lastWorkletUpdateRef.current;
        if (elapsed < 0.1) {
          rowFraction = Math.min(1, elapsed * (currentBpm / 60 / 4));
          const expectedTime = workletTimeRef.current + elapsed;
          const drift = time - expectedTime;
          driftAccumulatorRef.current = driftAccumulatorRef.current * 0.9 + drift * 0.1;
          if (Math.abs(driftAccumulatorRef.current) > MAX_DRIFT_SECONDS) {
            time = expectedTime + driftAccumulatorRef.current * 0.5;
            lastCorrectedTimeRef.current = now;
          } else {
            time = expectedTime;
          }
        }
      }
    } else {
      if (!lib || modPtr === 0) return;
      order = lib._openmpt_module_get_current_order(modPtr);
      row   = lib._openmpt_module_get_current_row(modPtr);
      time  = lib._openmpt_module_get_position_seconds(modPtr);
    }

    if (pendingSeekRef.current && !seekAcknowledgedRef.current) {
      const seekAge = audioCtx ? audioCtx.currentTime - pendingSeekRef.current.timestamp : 0;
      if (seekAge > 0.5) { seekAcknowledgedRef.current = true; pendingSeekRef.current = null; }
    }

    if (sequencerMatrix?.order !== order) {
      const newMatrix = patternMatricesRef.current[order];
      if (newMatrix) setSequencerMatrix(newMatrix);
    }

    setModuleInfo(prev => ({ ...prev, order, row, bpm: currentBpm }));
    setSequencerCurrentRow(row);
    setPlaybackSeconds(time);

    let globalRow = 0;
    for (let i = 0; i < order; i++) globalRow += patternMatricesRef.current[i]?.numRows || 64;
    setSequencerGlobalRow(globalRow + row);

    const smoothedRowFraction = rowFraction * ROW_INTERPOLATION_SMOOTHING + (playbackRowFraction * (1 - ROW_INTERPOLATION_SMOOTHING));
    setPlaybackRowFraction(smoothedRowFraction);

    const beatPhaseValue = (time * 2) % 1;
    setBeatPhase(beatPhaseValue);

    const now = audioCtx?.currentTime || performance.now() / 1000;
    playbackStateRef.current = {
      playheadRow: row + smoothedRowFraction, currentOrder: order, timeSec: time,
      beatPhase: beatPhaseValue, kickTrigger, grooveAmount, lastUpdateTimestamp: now,
    };

    setSyncDebug(prev => ({
      ...prev,
      driftMs: Math.round(driftAccumulatorRef.current * 1000),
      row, mode: activeEngine,
      bufferMs: Math.round(workletBufferHealthRef.current * 5000),
      starvationCount: workletStarvationCountRef.current,
    }));

    lastUpdateTimeRef.current = performance.now() / 1000;
    animationFrameHandle.current = requestAnimationFrame(updateUI);
  }, [isPlaying, activeEngine, sequencerMatrix, kickTrigger, grooveAmount, playbackRowFraction]);

  const stopMusic = useCallback((destroy: boolean = false) => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (animationFrameHandle.current) cancelAnimationFrame(animationFrameHandle.current);
    stopAudioPump();
    if (nativeEngineRef.current) nativeEngineRef.current.pause();
    if (audioContextRef.current) audioContextRef.current.suspend();
    if (audioWorkletNodeRef.current) { audioWorkletNodeRef.current.disconnect(); audioWorkletNodeRef.current = null; }
    if (scriptProcessorRef.current) { scriptProcessorRef.current.disconnect(); scriptProcessorRef.current = null; }
    if (spLeftBufPtr.current && libopenmptRef.current) { libopenmptRef.current._free(spLeftBufPtr.current); spLeftBufPtr.current = 0; }
    if (spRightBufPtr.current && libopenmptRef.current) { libopenmptRef.current._free(spRightBufPtr.current); spRightBufPtr.current = 0; }
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

  const muteChannel = useCallback((channel: number, muted: boolean) => {
    const lib: any = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    if (!lib || modPtr === 0) return;
    lib._openmpt_module_set_channel_mute(modPtr, channel, muted ? 1 : 0);
    const currentMuted = [...mutedChannelsRef.current];
    currentMuted[channel] = muted;
    mutedChannelsRef.current = currentMuted;
    if (channelStatesRef.current[channel]) channelStatesRef.current[channel].isMuted = muted ? 1 : 0;
    console.log(`[Mute] Channel ${channel + 1} ${muted ? 'muted' : 'unmuted'}`);
  }, []);

  const soloChannel = useCallback((channel: number) => {
    const lib: any = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    if (!lib || modPtr === 0) return;
    const numChannels = lib._openmpt_module_get_num_channels(modPtr);
    const isCurrentlySolo = mutedChannelsRef.current.filter(m => !m).length === 1 && !mutedChannelsRef.current[channel];
    for (let i = 0; i < numChannels; i++) {
      const shouldMute = !isCurrentlySolo && i !== channel;
      lib._openmpt_module_set_channel_mute(modPtr, i, shouldMute ? 1 : 0);
      mutedChannelsRef.current[i] = shouldMute;
      if (channelStatesRef.current[i]) channelStatesRef.current[i].isMuted = shouldMute ? 1 : 0;
    }
    console.log(isCurrentlySolo ? '[Solo] Released' : `[Solo] Channel ${channel + 1} soloed`);
  }, []);

  const isChannelMuted = useCallback((channel: number): boolean => {
    return mutedChannelsRef.current[channel] ?? false;
  }, []);

  const currentOrderRef = useRef(0);

  const goToPattern = useCallback((orderIndex: number) => {
    const lib: any = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    if (!lib || modPtr === 0) return;
    const numOrders = lib._openmpt_module_get_num_orders(modPtr);
    const clampedOrder = Math.max(0, Math.min(orderIndex, numOrders - 1));
    lib._openmpt_module_set_position_order_row(modPtr, clampedOrder, 0);
    currentOrderRef.current = clampedOrder;
    workletOrderRef.current = clampedOrder;
    workletRowRef.current = 0;
    setSequencerCurrentRow(0);
    setModuleInfo(prev => ({ ...prev, order: clampedOrder, row: 0 }));
    const newMatrix = patternMatricesRef.current[clampedOrder];
    if (newMatrix) setSequencerMatrix(newMatrix);
    console.log(`[Navigation] Jumped to pattern ${clampedOrder + 1}/${numOrders}`);
  }, []);

  const previousPattern = useCallback(() => { goToPattern(currentOrderRef.current - 1); }, [goToPattern]);
  const nextPattern     = useCallback(() => { goToPattern(currentOrderRef.current + 1); }, [goToPattern]);

  const seekToStepWrapper = useCallback((step: number) => {
    const lib: any = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    if (!lib || modPtr === 0) return;

    let acc = 0, targetOrder = 0, targetRow = 0;
    const numOrders = lib._openmpt_module_get_num_orders(modPtr);
    for (let o = 0; o < numOrders; o++) {
      const m = patternMatricesRef.current[o];
      const rows = m ? m.numRows : lib._openmpt_module_get_pattern_num_rows(modPtr, lib._openmpt_module_get_order_pattern(modPtr, o));
      if (step < acc + rows) { targetOrder = o; targetRow = step - acc; break; }
      acc += rows;
    }

    const audioCtx = audioContextRef.current;
    pendingSeekRef.current = { order: targetOrder, row: targetRow, timestamp: audioCtx ? audioCtx.currentTime : performance.now() / 1000 };
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
      audioWorkletNodeRef.current.port.postMessage({ type: 'seek', order: targetOrder, row: targetRow, timestamp: audioCtx ? audioCtx.currentTime : 0 });
    }
  }, [activeEngine]);

  // Thin wrapper – body extracted to hooks/useAudioGraph.ts
  const play = useCallback(async () => {
    await startAudioPlayback(
      {
        libopenmptRef, fileDataRef, audioContextRef, workletLoadedRef,
        stereoPannerRef, gainNodeRef, analyserRef, audioWorkletNodeRef,
        nativeEngineRef, wasmMemoryRef, workletOrderRef, workletRowRef,
        workletTimeRef, lastWorkletUpdateRef, workletBpmRef, pendingSeekRef,
        seekAcknowledgedRef, spFallbackTriggered, isPlayingRef,
        animationFrameHandle, patternMatricesRef, channelStatesRef,
        audioClockStartRef, workletTimeAtStartRef, driftAccumulatorRef,
        workletBufferHealthRef, workletStarvationCountRef, workletSampleRateRef,
        scriptProcessorRef, spLeftBufPtr, spRightBufPtr, currentModulePtr,
      },
      {
        setStatus, setIsPlaying, setActiveEngine, setModuleInfo, setSequencerMatrix,
        stopMusic, seekToStepWrapper, updateUI, startAudioPump,
      },
      { activeEngine, isWorkletSupported, isNativeWorkletAvailable, panValue, volume, isLooping, WORKLET_URL },
    );
  }, [activeEngine, isWorkletSupported, isNativeWorkletAvailable, panValue, volume, isLooping, stopMusic, seekToStepWrapper, updateUI, startAudioPump]);

  playRef.current = play;

  const toggleAudioEngine = useCallback(() => {
    let newEngine: 'worklet' | 'native-worklet';
    if (activeEngine === 'native-worklet') {
      newEngine = 'worklet';
    } else {
      newEngine = isNativeWorkletAvailable ? 'native-worklet' : 'worklet';
    }
    if (isPlaying) { setRestartPlayback(true); stopMusic(false); }
    setActiveEngine(newEngine);
    console.log('[toggleEngine]', activeEngine, '→', newEngine);
  }, [activeEngine, isPlaying, isWorkletSupported, isNativeWorkletAvailable, stopMusic]);

  useEffect(() => {
    if (restartPlayback) { setRestartPlayback(false); play(); }
  }, [restartPlayback, play]);

  useEffect(() => {
    const init = async () => {
      if (!window.libopenmptReady) {
        setStatus("Error: libopenmpt initialization script not found.");
        return;
      }
      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Initialization timed out')), 15000));
        const lib = await Promise.race([window.libopenmptReady, timeoutPromise]);

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

        try {
          const hasWorklet = typeof window !== 'undefined' && 'AudioContext' in window && 'audioWorklet' in AudioContext.prototype;
          if (hasWorklet) {
            setIsWorkletSupported(true);
            setActiveEngine('worklet');
          } else {
            setIsWorkletSupported(false);
            setStatus("Error: AudioWorklet not supported.");
          }
        } catch (e) {
          setIsWorkletSupported(false);
        }

        try {
          const nativeGlueUrl = `${RUNTIME_BASE_URL}worklets/openmpt-native.js`;
          const probeResp = await fetch(nativeGlueUrl, { method: 'HEAD' });
          if (probeResp.ok) {
            const engine = new OpenMPTWorkletEngine();
            await engine.init();
            nativeEngineRef.current = engine;
            setIsNativeWorkletAvailable(true);
            setActiveEngine('native-worklet');
          }
        } catch (nativeErr) {
          setIsNativeWorkletAvailable(false);
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
      if (nativeEngineRef.current) { nativeEngineRef.current.destroy(); nativeEngineRef.current = null; }
      if (audioWorkletNodeRef.current) audioWorkletNodeRef.current.disconnect();
      if (stereoPannerRef.current) stereoPannerRef.current.disconnect();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') audioContextRef.current.close();
      if (currentModulePtr.current !== 0 && libopenmptRef.current) libopenmptRef.current._openmpt_module_destroy(currentModulePtr.current);
      cancelAnimationFrame(animationFrameHandle.current);
    };
  }, [stopAudioPump]);

  useEffect(() => { if (stereoPannerRef.current) stereoPannerRef.current.pan.value = panValue; }, [panValue]);
  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = volume;
    if (nativeEngineRef.current) nativeEngineRef.current.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (isReady && !userModuleLoadedRef.current) {
      const loadDefault = async () => {
        const fileName = DEFAULT_MODULE_URL.split('/').pop() || 'default.mod';
        setStatus(`Fetching "${fileName}"...`);
        try {
          const response = await fetch(DEFAULT_MODULE_URL);
          if (!response.ok) throw new Error(`Failed: ${response.statusText}`);
          const fileData = new Uint8Array(await response.arrayBuffer());
          await _processModuleData(fileData, fileName);
        } catch (e) {
          console.error("Failed to load default module:", e);
          setStatus(`Error fetching default module.`);
        }
      };
      loadDefault();
    }
  }, [isReady, _processModuleData]);

  return {
    status, isReady, isPlaying, isModuleLoaded, moduleInfo, moduleMetadata, patternData,
    loadFile: loadModule, play, stopMusic, sequencerMatrix, sequencerCurrentRow, sequencerGlobalRow,
    totalPatternRows, playbackSeconds, durationSeconds, playbackRowFraction, channelStates,
    beatPhase, grooveAmount, kickTrigger, activeChannels,
    isLooping, setIsLooping, seekToStep: seekToStepWrapper, panValue, setPanValue,
    activeEngine, isWorkletSupported, toggleAudioEngine, syncDebug,
    analyserNode: analyserRef.current,
    playbackStateRef,
    muteChannel, soloChannel, isChannelMuted,
    previousPattern, nextPattern, goToPattern,
  };
}
