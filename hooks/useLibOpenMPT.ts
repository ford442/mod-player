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
// Use BASE_URL for proper subdirectory deployment support
const DEFAULT_MODULE_URL = `./7DAYS.XM`;
const WORKLET_URL = `./worklets/openmpt-processor.js`;
// const SAMPLE_RATE = 44100;

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
  const [activeChannels, setActiveChannels] = useState<number[]>([]);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [panValue, setPanValue] = useState<number>(0); // -1 to 1
  const [volume, _setVolume] = useState<number>(initialVolume); // 0 to 1
  const [activeEngine, setActiveEngine] = useState<'script' | 'worklet' | 'native-worklet'>('worklet');
  const [isWorkletSupported, setIsWorkletSupported] = useState<boolean>(false);
  const [isNativeWorkletAvailable, setIsNativeWorkletAvailable] = useState<boolean>(false);
  const [restartPlayback, setRestartPlayback] = useState<boolean>(false);
  const [syncDebug, _setSyncDebug] = useState<SyncDebugInfo>({ mode: "none", bufferMs: 0, driftMs: 0, row: 0, starvationCount: 0 });

  const libopenmptRef = useRef<LibOpenMPT | null>(null);
  const currentModulePtr = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const stereoPannerRef = useRef<StereoPannerNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const fileDataRef = useRef<Uint8Array | null>(null);

  const leftBufferPtr = useRef<number>(0);
  const rightBufferPtr = useRef<number>(0);
  const animationFrameHandle = useRef<number>(0);
  const lastUpdateTimeRef = useRef<number>(0);

  // Worklet state tracking
  const workletOrderRef = useRef<number>(0);
  const workletRowRef = useRef<number>(0);
  const workletTimeRef = useRef<number>(0);
  const lastWorkletUpdateRef = useRef<number>(0);

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
      if (scriptNodeRef.current) {
        try { scriptNodeRef.current.disconnect(); } catch (e) { }
        scriptNodeRef.current = null;
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
    setSequencerMatrix(matrices[0]);
    setSequencerCurrentRow(0);
    setSequencerGlobalRow(0);
    setChannelStates(new Array(numChannels).fill({ volume: 0, pan: 128, freq: 0, trigger: 0, noteAge: 0, activeEffect: 0, effectValue: 0, isMuted: 0 }));
    channelStatesRef.current = new Array(numChannels).fill(null).map(() => ({ volume: 0, pan: 128, freq: 0, trigger: 0, noteAge: 0, activeEffect: 0, effectValue: 0, isMuted: 0 }));

    setIsModuleLoaded(true);
    setStatus(`Loaded "${title || fileName}"`);

    // Auto-play using the latest play function (avoids stale closure)
    if (playRef.current) playRef.current();

  }, [getPatternMatrix]);

  const processAudioChunk = useCallback((outputBuffer: AudioBuffer) => {
    // Only used for ScriptProcessor
    const lib = libopenmptRef.current;
    if (!lib || currentModulePtr.current === 0) return;

    const modPtr = currentModulePtr.current;

    if (leftBufferPtr.current === 0) {
      // Just allocate once large enough for script processor chunks (usually 2048-4096)
      leftBufferPtr.current = lib._malloc(4 * 16384);
      rightBufferPtr.current = lib._malloc(4 * 16384);
    }

    const count = outputBuffer.length;
    const framesProcessed = lib._openmpt_module_read_float_stereo(modPtr, outputBuffer.sampleRate, count, leftBufferPtr.current, rightBufferPtr.current);

    if (framesProcessed === 0) {
      if (isLooping) {
        lib._openmpt_module_set_position_order_row(modPtr, 0, 0);
      } else {
        stopMusic(false);
        return;
      }
    }

    const outputL = outputBuffer.getChannelData(0);
    const outputR = outputBuffer.getChannelData(1);

    const heapF32 = lib.HEAPF32;
    const startL = leftBufferPtr.current >> 2;
    const startR = rightBufferPtr.current >> 2;

    for (let i = 0; i < count; i++) {
      outputL[i] = heapF32[startL + i];
      outputR[i] = heapF32[startR + i];
    }
  }, [isLooping]);

  const updateUI = useCallback(() => {
    // Use ref so this callback always sees the current isPlaying state
    if (!isPlayingRef.current) return;

    const lib = libopenmptRef.current;
    const modPtr = currentModulePtr.current;

    let order = 0;
    let row = 0;
    let time = 0;

    if ((activeEngine === 'worklet' || activeEngine === 'native-worklet') && (audioWorkletNodeRef.current || nativeEngineRef.current)) {
      // Use state from worklet (JS or native)
      order = workletOrderRef.current;
      row = workletRowRef.current;
      time = workletTimeRef.current;

      // Extrapolate playback time using the audio clock to eliminate the lag
      // between 60Hz position reports and 60fps display updates.
      // audioContext.currentTime is on the same clock as the worklet, so
      // this gives accurate sub-report-interval position interpolation.
      const audioCtx = audioContextRef.current;
      if (audioCtx && lastWorkletUpdateRef.current > 0) {
        const elapsed = audioCtx.currentTime - lastWorkletUpdateRef.current;
        time = workletTimeRef.current + Math.max(0, elapsed);
      }
    } else {
      // Main thread module (ScriptProcessor)
      if (!lib || modPtr === 0) return;
      order = lib._openmpt_module_get_current_order(modPtr);
      row = lib._openmpt_module_get_current_row(modPtr);
      time = lib._openmpt_module_get_position_seconds(modPtr);
    }

    // Update Pattern Matrix if needed
    if (sequencerMatrix?.order !== order) {
      const newMatrix = patternMatricesRef.current[order];
      if (newMatrix) setSequencerMatrix(newMatrix);
    }

    setModuleInfo(prev => ({ ...prev, order, row }));
    setSequencerCurrentRow(row);
    setPlaybackSeconds(time);

    // Update global row (approximate)
    let globalRow = 0;
    for (let i = 0; i < order; i++) {
      globalRow += patternMatricesRef.current[i]?.numRows || 64;
    }
    setSequencerGlobalRow(globalRow + row);

    setPlaybackRowFraction(row);

    // VU / Channel Data
    if (activeEngine === 'script' && lib && modPtr) {
      const numChannels = lib._openmpt_module_get_num_channels(modPtr);
      const active: number[] = [];
      for (let c = 0; c < numChannels; c++) {
        const vol = lib._openmpt_module_get_current_channel_vu_mono ? lib._openmpt_module_get_current_channel_vu_mono(modPtr, c) : 0;
        if (vol > 0.01) active.push(c);

        channelStatesRef.current[c] = {
          volume: vol,
          pan: 128,
          freq: 0,
          trigger: vol > 0.5 ? 1 : 0,
          noteAge: 0,
          activeEffect: 0,
          effectValue: 0,
          isMuted: 0
        };
      }
      setActiveChannels(active);
    }

    setBeatPhase((time * 2) % 1);
    lastUpdateTimeRef.current = performance.now() / 1000;
    animationFrameHandle.current = requestAnimationFrame(updateUI);
  }, [isPlaying, activeEngine, sequencerMatrix]);

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

    if (scriptNodeRef.current) {
      scriptNodeRef.current.disconnect();
      scriptNodeRef.current = null;
    }

    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }

    if (destroy && currentModulePtr.current !== 0 && libopenmptRef.current) {
      libopenmptRef.current._openmpt_module_destroy(currentModulePtr.current);
      currentModulePtr.current = 0;
      setIsModuleLoaded(false);
    }

    setStatus("Stopped.");
  }, []);

  const seekToStepWrapper = (step: number) => {
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

    lib._openmpt_module_set_position_order_row(modPtr, targetOrder, targetRow);
    setModuleInfo(prev => ({ ...prev, order: targetOrder, row: targetRow }));
    setSequencerCurrentRow(targetRow);
    setSequencerGlobalRow(step);

    // Worklet update
    if (activeEngine === 'native-worklet' && nativeEngineRef.current) {
      nativeEngineRef.current.seek(targetOrder, targetRow);
    } else if (activeEngine === 'worklet' && audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.postMessage({ type: 'seek', order: targetOrder, row: targetRow });
    }
  };

  const play = useCallback(async () => {
    if (!libopenmptRef.current) {
      console.error("❌ [PLAY] libopenmpt not initialized");
      setStatus("Error: Audio library not ready");
      return;
    }
    if (!fileDataRef.current) {
      console.error("❌ [PLAY] No module data available (fileDataRef is null)");
      setStatus("Error: No module loaded");
      return;
    }

    console.log('🎵 [PLAY] Starting playback...', {
      engine: activeEngine,
      isWorkletSupported,
      hasFileData: !!fileDataRef.current,
      fileDataLength: fileDataRef.current?.length
    });

    try {
      if (!audioContextRef.current) {
        console.log('🔧 [PLAY] Creating new AudioContext...');
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
        // New context: worklet module needs to be (re)loaded
        workletLoadedRef.current = false;
      }

      const ctx = audioContextRef.current;
      console.log('🔧 [PLAY] AudioContext state:', ctx.state);

      if (ctx.state === 'suspended') {
        console.log('🔧 [PLAY] Resuming suspended AudioContext...');
        await ctx.resume();
        console.log('✅ [PLAY] AudioContext resumed, new state:', ctx.state);
      }

      // Setup common nodes
      if (!stereoPannerRef.current) {
        console.log('🔧 [PLAY] Creating StereoPanner node...');
        stereoPannerRef.current = ctx.createStereoPanner();
        stereoPannerRef.current.pan.value = panValue;
      }
      if (!gainNodeRef.current) {
        console.log('🔧 [PLAY] Creating Gain node...');
        gainNodeRef.current = ctx.createGain();
        gainNodeRef.current.gain.value = volume;
      }
      if (!analyserRef.current) {
        console.log('🔧 [PLAY] Creating Analyser node...');
        analyserRef.current = ctx.createAnalyser();
        analyserRef.current.fftSize = 2048;
        analyserRef.current.smoothingTimeConstant = 0.8;
      }

      // Disconnect previous sources
      if (scriptNodeRef.current) {
        console.log('🔧 [PLAY] Disconnecting previous ScriptProcessor...');
        scriptNodeRef.current.disconnect();
        scriptNodeRef.current = null;
      }
      if (audioWorkletNodeRef.current) {
        console.log('🔧 [PLAY] Disconnecting previous AudioWorkletNode...');
        audioWorkletNodeRef.current.disconnect();
        audioWorkletNodeRef.current = null;
      }

      if (activeEngine === 'native-worklet' && isNativeWorkletAvailable) {
        // ── Native C++/Wasm AudioWorklet engine (Phase 2) ──
        console.log('🎵 [PLAY] Using native C++/Wasm AudioWorklet engine...');
        try {
          const engine = nativeEngineRef.current!;

          // Load module data into the native engine
          const buf = fileDataRef.current?.buffer;
          if (buf) {
            console.log('📦 [PLAY] Sending module data to native engine:', buf.byteLength, 'bytes');
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
            lastWorkletUpdateRef.current = performance.now() / 1000;

            // Update channel VU data
            const numCh = data.numChannels;
            for (let c = 0; c < numCh && c < channelStatesRef.current.length; c++) {
              channelStatesRef.current[c] = {
                ...channelStatesRef.current[c],
                volume: data.channelVU[c] || 0,
                trigger: (data.channelVU[c] || 0) > 0.5 ? 1 : 0,
              };
            }

            // When the engine supplies new pattern data (on order/pattern change),
            // convert it to a PatternMatrix and update the sequencer display.
            if (data.patternData) {
              const pd = data.patternData;
              const rows = pd.rows.map((row) =>
                Array.from({ length: pd.numChannels }, (_, c): import('../types').PatternCell => {
                  const hasNote = row.notes[c] > 0;
                  const hasInst = row.instruments[c] > 0;
                  const hasEffect = row.effCmds[c] > 0 || row.effVals[c] > 0;
                  const type = hasNote ? 'note' : hasInst ? 'instrument' : hasEffect ? 'effect' : 'empty';
                  return {
                    type,
                    text: '',
                    note: row.notes[c] || undefined,
                    inst: row.instruments[c] || undefined,
                    volCmd: row.volCmds[c] || undefined,
                    volVal: row.volVals[c] || undefined,
                    effCmd: row.effCmds[c] || undefined,
                    effVal: row.effVals[c] || undefined,
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
            console.log('ℹ️ [PLAY] Native engine reported module ended');
            if (isLooping) {
              seekToStepWrapper(0);
            } else {
              stopMusic(false);
            }
          });

          // Start playback
          engine.play();
          console.log('✅ [PLAY] Native C++/Wasm AudioWorklet engine started');
        } catch (e) {
          console.error("❌ [PLAY] Failed to start native engine:", e);
          console.warn("⚠️ [PLAY] Falling back to JS AudioWorklet engine");
          setActiveEngine('worklet');
          // Continue to existing worklet path below
        }
      } else if (activeEngine === 'worklet' && isWorkletSupported) {
        console.log('🎵 [PLAY] Using AudioWorklet engine...');

        try {
          // Load the worklet module only once per AudioContext
          if (ctx.audioWorklet && !workletLoadedRef.current) {
            console.log('🔧 [PLAY] Loading worklet module from:', WORKLET_URL);
            await ctx.audioWorklet.addModule(WORKLET_URL);
            workletLoadedRef.current = true;
            console.log('✅ [PLAY] openmpt-processor loaded successfully');
          } else {
            console.log('ℹ️ [PLAY] Worklet module already loaded (skipping addModule)');
          }

          console.log('🔧 [PLAY] Creating AudioWorkletNode...');
          const node = new AudioWorkletNode(ctx, 'openmpt-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2]
          });
          console.log('✅ [PLAY] AudioWorkletNode created:', node);

          node.port.onmessage = (e) => {
            const { type, order, row, positionSeconds, message } = e.data;
            if (type === 'position') {
              workletOrderRef.current = order;
              workletRowRef.current = row;
              workletTimeRef.current = positionSeconds;
              lastWorkletUpdateRef.current = ctx.currentTime;
              // Live BPM tracking from worklet
              if (e.data.bpm && e.data.bpm > 0) {
                setModuleInfo(prev => ({ ...prev, bpm: e.data.bpm }));
              }
            } else if (type === 'ended') {
              console.log('ℹ️ [PLAY] Worklet reported module ended');
              if (isLooping) {
                seekToStepWrapper(0);
              } else {
                stopMusic(false);
              }
            } else if (type === 'error') {
              console.error("❌ [PLAY] Worklet error:", message);
              setStatus("Worklet error: " + message);
            } else if (type === 'loaded') {
              // Module is now loaded inside the worklet – safe to start the UI.
              // This deferred start avoids the ~1-2 s off-timing caused by WASM
              // initialisation happening after isPlaying was already set to true.
              console.log("✅ [PLAY] Worklet loaded module – starting animation");
              isPlayingRef.current = true;
              setIsPlaying(true);
              setStatus("Playing...");
              if (animationFrameHandle.current) cancelAnimationFrame(animationFrameHandle.current);
              animationFrameHandle.current = requestAnimationFrame(updateUI);
            }
          };

          // Send module data (cloned, not transferred, so fileDataRef remains valid)
          const buf = fileDataRef.current?.buffer;
          if (buf) {
            console.log('📦 [PLAY] Sending module data to worklet:', buf.byteLength, 'bytes');
            node.port.postMessage({ type: 'load', moduleData: buf });
          } else {
            console.error("❌ [PLAY] No buffer to send to worklet!");
          }

          console.log('🔧 [PLAY] Connecting audio graph: worklet -> analyser -> panner -> gain -> destination');
          node.connect(analyserRef.current!);
          analyserRef.current!.connect(stereoPannerRef.current!);
          stereoPannerRef.current!.connect(gainNodeRef.current!);
          gainNodeRef.current!.connect(ctx.destination);

          audioWorkletNodeRef.current = node;
          // Show a loading state while the 4.8 MB WASM finishes initialising.
          // isPlaying will be set to true via the 'loaded' message handler above.
          setStatus("Loading audio engine...");
          console.log('✅ [PLAY] AudioWorklet setup complete – waiting for WASM loaded event');
        } catch (e) {
          console.error("❌ [PLAY] Failed to create/load AudioWorkletNode:", e);
          console.warn("⚠️ [PLAY] Falling back to ScriptProcessorNode");
          // Fall through to ScriptProcessor below (don't call play() recursively)
          workletLoadedRef.current = false;

          const bufferSize = 4096;
          const node = ctx.createScriptProcessor(bufferSize, 0, 2);
          node.onaudioprocess = (ev: AudioProcessingEvent) => processAudioChunk(ev.outputBuffer);

          node.connect(analyserRef.current!);
          analyserRef.current!.connect(stereoPannerRef.current!);
          stereoPannerRef.current!.connect(gainNodeRef.current!);
          gainNodeRef.current!.connect(ctx.destination);

          scriptNodeRef.current = node;
          console.log('✅ [PLAY] ScriptProcessor fallback setup complete');
        }
      } else {
        console.log('🎵 [PLAY] Using ScriptProcessor engine...');
        // ScriptProcessor fallback
        const bufferSize = 4096;
        const node = ctx.createScriptProcessor(bufferSize, 0, 2);
        node.onaudioprocess = (e) => processAudioChunk(e.outputBuffer);

        node.connect(analyserRef.current!);
        analyserRef.current!.connect(stereoPannerRef.current!);
        stereoPannerRef.current!.connect(gainNodeRef.current!);
        gainNodeRef.current!.connect(ctx.destination);

        scriptNodeRef.current = node;
        console.log('✅ [PLAY] ScriptProcessor setup complete');
      }

      // For the JS AudioWorklet path playback is deferred until the worklet sends
      // { type: 'loaded' } (avoids off-timing during WASM startup).
      // For everything else (ScriptProcessor / native worklet) start immediately.
      if (!audioWorkletNodeRef.current) {
        isPlayingRef.current = true;
        setIsPlaying(true);
        setStatus("Playing...");
        animationFrameHandle.current = requestAnimationFrame(updateUI);
      }

    } catch (e) {
      console.error("❌ [PLAY] Play error:", e);
      setStatus("Error starting playback");
    }
  }, [activeEngine, isWorkletSupported, isNativeWorkletAvailable, panValue, volume, processAudioChunk, isLooping, stopMusic]);

  // Keep playRef always pointing to the latest play function
  // so processModuleData (which memoises over different deps) can call it without stale closure
  playRef.current = play;

  const toggleAudioEngine = useCallback(() => {
    // Cycle: native-worklet → worklet → script → native-worklet (if available)
    let newEngine: 'script' | 'worklet' | 'native-worklet';
    if (activeEngine === 'native-worklet') {
      newEngine = isWorkletSupported ? 'worklet' : 'script';
    } else if (activeEngine === 'worklet') {
      newEngine = 'script';
    } else {
      // script → try native first, then worklet
      newEngine = isNativeWorkletAvailable ? 'native-worklet' : (isWorkletSupported ? 'worklet' : 'script');
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
            for (let i = 0; heap[ptr + i] !== 0; i++) str += String.fromCharCode(heap[ptr + i]);
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

        try {
          console.log("[INIT] Testing AudioWorklet support...");
          const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
          await tempCtx.audioWorklet.addModule(WORKLET_URL);
          setIsWorkletSupported(true);
          setActiveEngine('worklet');
          await tempCtx.close();
          console.log('✅ [INIT] AudioWorklet support confirmed');
        } catch (e) {
          console.warn("⚠️ [INIT] AudioWorklet not available (fallback to script processor):", e);
          setIsWorkletSupported(false);
          setActiveEngine('script');
        }

        // Probe for native C++/Wasm AudioWorklet engine
        // Note: enabling this requires building the wasm engine using
        // ./scripts/build-wasm.sh (Emscripten SDK must be installed).
        try {
          const nativeGlueUrl = `./worklets/openmpt-native.js`;
          const probeResp = await fetch(nativeGlueUrl, { method: 'HEAD' });
          if (probeResp.ok) {
            console.log('[INIT] Native C++/Wasm AudioWorklet engine available');
            const engine = new OpenMPTWorkletEngine();
            await engine.init();
            nativeEngineRef.current = engine;
            setIsNativeWorkletAvailable(true);
            setActiveEngine('native-worklet');
            console.log('[INIT] Native engine initialized');
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
      if (scriptNodeRef.current) scriptNodeRef.current.disconnect();
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
    analyserNode: analyserRef.current
  };
}
