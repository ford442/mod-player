// @ts-nocheck
// Extracted from mod-player-shaders/useLibOpenMPT.ts to keep that hook under 777 lines.
// Contains: processModuleData, startAudioPlayback (play), handleWorkletError.

import { getPatternMatrix } from '../utils/patternExtractor';

// ── processModuleData ──────────────────────────────────────────────────────────
export async function processModuleData(refs, callbacks, fileData, fileName) {
  const {
    libopenmptRef, currentModulePtr, isPlayingRef, animationFrameHandle,
    audioContextRef, audioWorkletNodeRef, fileDataRef, workletBpmRef,
    patternMatricesRef, channelStatesRef, audioClockStartRef,
    workletTimeAtStartRef, driftAccumulatorRef, lastCorrectedTimeRef,
    pendingSeekRef, seekAcknowledgedRef,
  } = refs;
  const {
    setStatus, setIsPlaying, setDurationSeconds, setModuleMetadata,
    setModuleInfo, setTotalPatternRows, setSequencerMatrix,
    setSequencerCurrentRow, setSequencerGlobalRow, setChannelStates,
    setIsModuleLoaded,
  } = callbacks;

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
      try { audioContextRef.current.suspend(); } catch (e) { console.warn(e); }
    }
    if (audioWorkletNodeRef.current) {
      try { audioWorkletNodeRef.current.disconnect(); } catch (e) { console.warn(e); }
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
  const getMetadataStr = (key) => {
    const keyPtr = lib.stringToUTF8(key);
    const valPtr = lib._openmpt_module_get_metadata(modPtr, keyPtr);
    const value = lib.UTF8ToString(valPtr);
    lib._openmpt_free_string(valPtr);
    return value;
  };

  const title    = getMetadataStr("title");
  const artist   = getMetadataStr("artist");
  const tracker  = getMetadataStr("tracker");
  const type     = getMetadataStr("type");
  const comments = getMetadataStr("message");

  const numOrders    = lib._openmpt_module_get_num_orders(modPtr);
  const numChannels  = lib._openmpt_module_get_num_channels(modPtr);
  const initialBpm   = lib._openmpt_module_get_current_estimated_bpm(modPtr);
  const duration     = lib._openmpt_module_get_duration_seconds(modPtr);

  const numInstruments = lib._openmpt_module_get_num_instruments(modPtr);
  const numSamples     = lib._openmpt_module_get_num_samples(modPtr);

  // Read instrument names
  const instruments = [];
  for (let i = 0; i < numInstruments; i++) {
    const namePtr = lib._openmpt_module_get_instrument_name(modPtr, i);
    const name = lib.UTF8ToString(namePtr);
    lib._openmpt_free_string(namePtr);
    instruments.push(name || "");
  }

  // Read sample names
  const samples = [];
  for (let i = 0; i < numSamples; i++) {
    const namePtr = lib._openmpt_module_get_sample_name(modPtr, i);
    const name = lib.UTF8ToString(namePtr);
    lib._openmpt_free_string(namePtr);
    samples.push(name || "");
  }

  // Build order list (pattern sequence)
  const orderList = [];
  for (let i = 0; i < numOrders; i++) {
    orderList.push(lib._openmpt_module_get_order_pattern(modPtr, i));
  }

  const uniquePatterns = new Set(orderList).size;

  workletBpmRef.current = initialBpm || 125;
  setDurationSeconds(duration || 0);

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

  setModuleInfo({
    title: title || fileName,
    order: 0,
    row: 0,
    bpm: initialBpm,
    numChannels,
  });

  // Cache patterns
  const matrices = [];
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

  // Reset timing refs
  audioClockStartRef.current = 0;
  workletTimeAtStartRef.current = 0;
  driftAccumulatorRef.current = 0;
  lastCorrectedTimeRef.current = 0;
  pendingSeekRef.current = null;
  seekAcknowledgedRef.current = true;

  setIsModuleLoaded(true);
  setStatus(`Loaded "${title || fileName}"`);
}

// ── handleWorkletError ────────────────────────────────────────────────────────
export function handleWorkletError(message, node, refs, callbacks) {
  const {
    spFallbackTriggered, audioWorkletNodeRef, libopenmptRef, currentModulePtr,
    audioContextRef, spLeftBufPtr, spRightBufPtr, scriptProcessorRef,
    isPlayingRef, animationFrameHandle, analyserRef, workletOrderRef,
    workletRowRef, workletTimeRef, lastWorkletUpdateRef,
  } = refs;
  const { setStatus, setIsPlaying, updateUI } = callbacks;

  if ((message?.includes('Lib init failed') || message?.includes('WASM library init timeout'))
      && !spFallbackTriggered.current) {
    spFallbackTriggered.current = true;
    console.warn('[PLAY] Worklet WASM init failed - falling back to ScriptProcessorNode');

    try { node.disconnect(); } catch (e) { console.warn(e); }
    audioWorkletNodeRef.current = null;

    const lib = libopenmptRef.current;
    const modPtr = currentModulePtr.current;
    const ctx = audioContextRef.current;

    if (lib && modPtr && ctx) {
      const sampleRate = ctx.sampleRate;
      const SP_BUFFER = 4096;
      const spNode = ctx.createScriptProcessor(SP_BUFFER, 0, 2);
      const leftPtr  = lib._malloc(4 * SP_BUFFER);
      const rightPtr = lib._malloc(4 * SP_BUFFER);
      spLeftBufPtr.current  = leftPtr;
      spRightBufPtr.current = rightPtr;
      lib._openmpt_module_set_render_param(modPtr, 2, 8);

      spNode.onaudioprocess = (audioEvt) => {
        const outL = audioEvt.outputBuffer.getChannelData(0);
        const outR = audioEvt.outputBuffer.getChannelData(1);
        const mPtr = currentModulePtr.current;
        const mLib = libopenmptRef.current;
        if (!mLib || !mPtr) { outL.fill(0); outR.fill(0); return; }

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
        workletRowRef.current   = mLib._openmpt_module_get_current_row(mPtr);
        workletTimeRef.current  = mLib._openmpt_module_get_position_seconds(mPtr);
        lastWorkletUpdateRef.current = ctx.currentTime;
      };

      spNode.connect(analyserRef.current);
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
}

// ── startAudioPlayback (play) ─────────────────────────────────────────────────
export async function startAudioPlayback(refs, callbacks, config) {
  const {
    libopenmptRef, fileDataRef, audioContextRef, workletLoadedRef,
    stereoPannerRef, gainNodeRef, analyserRef, audioWorkletNodeRef,
    nativeEngineRef, wasmMemoryRef, workletOrderRef, workletRowRef,
    workletTimeRef, lastWorkletUpdateRef, workletBpmRef, pendingSeekRef,
    seekAcknowledgedRef, spFallbackTriggered, isPlayingRef,
    animationFrameHandle, patternMatricesRef, channelStatesRef,
    audioClockStartRef, workletTimeAtStartRef, driftAccumulatorRef,
    workletBufferHealthRef, workletStarvationCountRef, workletSampleRateRef,
  } = refs;
  const {
    setStatus, setIsPlaying, setActiveEngine, setModuleInfo, setSequencerMatrix,
    stopMusic, seekToStepWrapper, updateUI, startAudioPump,
  } = callbacks;
  const {
    activeEngine, isWorkletSupported, isNativeWorkletAvailable,
    panValue, volume, isLooping, WORKLET_URL,
  } = config;

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
    fileDataLength: fileDataRef.current?.length,
  });

  try {
    if (!audioContextRef.current) {
      console.log('[PLAY] Creating new AudioContext...');
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'playback',
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
        const engine = nativeEngineRef.current;
        const buf = fileDataRef.current?.buffer;
        if (buf) {
          await engine.load(buf);
        }
        engine.setVolume(volume);
        engine.setLoop(isLooping);

        engine.on('position', (data) => {
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
              Array.from({ length: pd.numChannels }, (_, c) => {
                const noteVal   = row.notes[c];
                const instVal   = row.instruments[c];
                const volCmdVal = row.volCmds[c];
                const volValItem = row.volVals[c];
                const effCmdVal = row.effCmds[c];
                const effVal    = row.effVals[c];
                const hasNote   = (noteVal ?? 0) > 0;
                const hasInst   = (instVal ?? 0) > 0;
                const hasEffect = (effCmdVal ?? 0) > 0 || (effVal ?? 0) > 0;
                const type = hasNote ? 'note' : hasInst ? 'instrument' : hasEffect ? 'effect' : 'empty';
                return {
                  type, text: '',
                  note:   noteVal   && noteVal > 0   ? noteVal   : undefined,
                  inst:   instVal   && instVal > 0   ? instVal   : undefined,
                  volCmd: volCmdVal && volCmdVal > 0 ? volCmdVal : undefined,
                  volVal: volValItem && volValItem > 0 ? volValItem : undefined,
                  effCmd: effCmdVal && effCmdVal > 0 ? effCmdVal : undefined,
                  effVal: effVal    && effVal > 0    ? effVal    : undefined,
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
        const processorOptions = {};
        if (!wasmMemory && window.crossOriginIsolated) {
          console.log('[PLAY] Allocating shared WASM.Memory (16MB)');
          wasmMemory = new WebAssembly.Memory({
            initial: 256,
            maximum: 256,
            shared: true,
          });
          wasmMemoryRef.current = wasmMemory;
        }
        if (wasmMemory) processorOptions.memory = wasmMemory;

        const node = new AudioWorkletNode(ctx, 'openmpt-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions,
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
            console.log('[PLAY] Worklet loaded, sample rate:', sampleRate);
            workletSampleRateRef.current = sampleRate;

            // Start audio pump to feed the ring buffer
            startAudioPump();

            isPlayingRef.current = true;
            setIsPlaying(true);
            setStatus("Playing...");
            animationFrameHandle.current = requestAnimationFrame(updateUI);
          } else if (type === 'starvation') {
            console.warn('[PLAY] Buffer starvation detected:', starvationCount);
          } else if (type === 'error') {
            console.error("[PLAY] Worklet error:", message);
            handleWorkletError(message, node, refs, callbacks);
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
        node.connect(analyserRef.current);
        analyserRef.current.connect(stereoPannerRef.current);
        stereoPannerRef.current.connect(gainNodeRef.current);
        gainNodeRef.current.connect(ctx.destination);

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
}
