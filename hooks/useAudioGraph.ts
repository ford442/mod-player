// Audio graph setup extracted from useLibOpenMPT.ts to keep that hook under 777 lines.
// startAudioPlayback() contains everything that was inside the play() useCallback.

import type React from 'react';
import { LibOpenMPT, PatternMatrix, ChannelShadowState, ModuleInfo, PatternCell } from '../types';
import { OpenMPTWorkletEngine } from '../audio-worklet/OpenMPTWorkletEngine';
import type { WorkletPositionData } from '../audio-worklet/types';

export interface AudioGraphRefs {
  libopenmptRef:       React.MutableRefObject<LibOpenMPT | null>;
  fileDataRef:         React.MutableRefObject<Uint8Array | null>;
  audioContextRef:     React.MutableRefObject<AudioContext | null>;
  workletLoadedRef:    React.MutableRefObject<boolean>;
  stereoPannerRef:     React.MutableRefObject<StereoPannerNode | null>;
  gainNodeRef:         React.MutableRefObject<GainNode | null>;
  analyserRef:         React.MutableRefObject<AnalyserNode | null>;
  audioWorkletNodeRef: React.MutableRefObject<AudioWorkletNode | null>;
  nativeEngineRef:     React.MutableRefObject<OpenMPTWorkletEngine | null>;
  wasmMemoryRef:       React.MutableRefObject<WebAssembly.Memory | null>;
  workletOrderRef:     React.MutableRefObject<number>;
  workletRowRef:       React.MutableRefObject<number>;
  workletTimeRef:      React.MutableRefObject<number>;
  lastWorkletUpdateRef: React.MutableRefObject<number>;
  workletBpmRef:       React.MutableRefObject<number>;
  pendingSeekRef:      React.MutableRefObject<{ order: number; row: number; timestamp: number } | null>;
  seekAcknowledgedRef: React.MutableRefObject<boolean>;
  spFallbackTriggered: React.MutableRefObject<boolean>;
  scriptProcessorRef:  React.MutableRefObject<ScriptProcessorNode | null>;
  spLeftBufPtr:        React.MutableRefObject<number>;
  spRightBufPtr:       React.MutableRefObject<number>;
  isPlayingRef:        React.MutableRefObject<boolean>;
  animationFrameHandle: React.MutableRefObject<number>;
  currentModulePtr:    React.MutableRefObject<number>;
  channelStatesRef:    React.MutableRefObject<ChannelShadowState[]>;
  patternMatricesRef:  React.MutableRefObject<PatternMatrix[]>;
  audioClockStartRef:  React.MutableRefObject<number>;
  workletTimeAtStartRef: React.MutableRefObject<number>;
  driftAccumulatorRef: React.MutableRefObject<number>;
}

export interface AudioGraphCallbacks {
  setStatus:         (s: string) => void;
  setIsPlaying:      (v: boolean) => void;
  setActiveEngine:   React.Dispatch<React.SetStateAction<'worklet' | 'native-worklet'>>;
  setModuleInfo:     React.Dispatch<React.SetStateAction<ModuleInfo>>;
  setSequencerMatrix: React.Dispatch<React.SetStateAction<PatternMatrix | null>>;
  stopMusic:         (destroy?: boolean) => void;
  seekToStepWrapper: (step: number) => void;
  updateUI:          () => void;
}

export interface AudioGraphConfig {
  activeEngine:           'worklet' | 'native-worklet';
  isWorkletSupported:     boolean;
  isNativeWorkletAvailable: boolean;
  panValue:               number;
  volume:                 number;
  isLooping:              boolean;
  WORKLET_URL:            string;
}

export async function startAudioPlayback(
  refs: AudioGraphRefs,
  callbacks: AudioGraphCallbacks,
  config: AudioGraphConfig
): Promise<void> {
  if (!refs.libopenmptRef.current) {
    console.error("[PLAY] libopenmpt not initialized");
    callbacks.setStatus("Error: Audio library not ready");
    return;
  }
  if (!refs.fileDataRef.current) {
    console.error("[PLAY] No module data available (fileDataRef is null)");
    callbacks.setStatus("Error: No module loaded");
    return;
  }

  console.log('[PLAY] Starting playback...', {
    engine: config.activeEngine,
    isWorkletSupported: config.isWorkletSupported,
    hasFileData: !!refs.fileDataRef.current,
    fileDataLength: refs.fileDataRef.current?.length,
  });

  try {
    if (!refs.audioContextRef.current) {
      console.log('[PLAY] Creating new AudioContext...');
      refs.audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'playback' });
      // New context: worklet module needs to be (re)loaded
      refs.workletLoadedRef.current = false;
    }

    const ctx = refs.audioContextRef.current;
    console.log('[PLAY] AudioContext state:', ctx.state);

    if (ctx.state === 'suspended') {
      console.log('[PLAY] Resuming suspended AudioContext...');
      await ctx.resume();
      console.log('[PLAY] AudioContext resumed, new state:', ctx.state);
    }

    // TIMING FIX: Initialize audio clock reference
    refs.audioClockStartRef.current = ctx.currentTime;
    refs.workletTimeAtStartRef.current = 0;
    refs.driftAccumulatorRef.current = 0;

    // Setup common nodes
    if (!refs.stereoPannerRef.current) {
      console.log('[PLAY] Creating StereoPanner node...');
      refs.stereoPannerRef.current = ctx.createStereoPanner();
      refs.stereoPannerRef.current.pan.value = config.panValue;
    }
    if (!refs.gainNodeRef.current) {
      console.log('[PLAY] Creating Gain node...');
      refs.gainNodeRef.current = ctx.createGain();
      refs.gainNodeRef.current.gain.value = config.volume;
    }
    if (!refs.analyserRef.current) {
      console.log('[PLAY] Creating Analyser node...');
      refs.analyserRef.current = ctx.createAnalyser();
      refs.analyserRef.current.fftSize = 2048;
      refs.analyserRef.current.smoothingTimeConstant = 0.8;
    }

    // Disconnect previous source
    if (refs.audioWorkletNodeRef.current) {
      console.log('[PLAY] Disconnecting previous AudioWorkletNode...');
      refs.audioWorkletNodeRef.current.disconnect();
      refs.audioWorkletNodeRef.current = null;
    }

    if (config.activeEngine === 'native-worklet' && config.isNativeWorkletAvailable) {
      // ── Native C++/Wasm AudioWorklet engine (Phase 2) ──
      console.log('[PLAY] Using native C++/Wasm AudioWorklet engine...');
      try {
        const engine = refs.nativeEngineRef.current!;

        // Load module data into the native engine
        const buf = refs.fileDataRef.current?.buffer;
        if (buf) {
          console.log('[PLAY] Sending module data to native engine:', buf.byteLength, 'bytes');
          await engine.load(buf as ArrayBuffer);
        }

        // Set engine parameters
        engine.setVolume(config.volume);
        engine.setLoop(config.isLooping);

        // Listen for position updates from the native engine
        engine.on('position', (data: WorkletPositionData) => {
          const now = ctx.currentTime;
          refs.workletOrderRef.current = data.currentOrder;
          refs.workletRowRef.current = data.currentRow;
          refs.workletTimeRef.current = data.positionMs / 1000;
          refs.lastWorkletUpdateRef.current = now;

          // TIMING FIX: Update BPM ref from worklet
          if (data.bpm && data.bpm > 0) {
            refs.workletBpmRef.current = data.bpm;
          }

          // TIMING FIX: Check for seek acknowledgment
          if (refs.pendingSeekRef.current &&
              data.currentOrder === refs.pendingSeekRef.current.order &&
              data.currentRow === refs.pendingSeekRef.current.row) {
            refs.seekAcknowledgedRef.current = true;
            refs.pendingSeekRef.current = null;
          }

          // Update channel VU data
          const numCh = data.numChannels;
          for (let c = 0; c < numCh && c < refs.channelStatesRef.current.length; c++) {
            const existing = refs.channelStatesRef.current[c];
            refs.channelStatesRef.current[c] = {
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
              Array.from({ length: pd.numChannels }, (_, c): PatternCell => {
                const noteVal    = row.notes[c];
                const instVal    = row.instruments[c];
                const volCmdVal  = row.volCmds[c];
                const volValItem = row.volVals[c];
                const effCmdVal  = row.effCmds[c];
                const effVal     = row.effVals[c];
                const hasNote    = (noteVal ?? 0) > 0;
                const hasInst    = (instVal ?? 0) > 0;
                const hasEffect  = (effCmdVal ?? 0) > 0 || (effVal ?? 0) > 0;
                const type = hasNote ? 'note' : hasInst ? 'instrument' : hasEffect ? 'effect' : 'empty';
                return {
                  type,
                  text: '',
                  note:   noteVal   && noteVal > 0   ? noteVal   : undefined,
                  inst:   instVal   && instVal > 0   ? instVal   : undefined,
                  volCmd: volCmdVal && volCmdVal > 0 ? volCmdVal : undefined,
                  volVal: volValItem && volValItem > 0 ? volValItem : undefined,
                  effCmd: effCmdVal && effCmdVal > 0 ? effCmdVal : undefined,
                  effVal: effVal    && effVal > 0    ? effVal    : undefined,
                };
              })
            );
            const matrix: PatternMatrix = {
              order: data.currentOrder,
              patternIndex: pd.patternIndex,
              numRows: pd.numRows,
              numChannels: pd.numChannels,
              rows,
            };
            refs.patternMatricesRef.current[data.currentOrder] = matrix;
            callbacks.setSequencerMatrix(matrix);
          }
        });

        engine.on('ended', () => {
          console.log('[PLAY] Native engine reported module ended');
          if (config.isLooping) {
            callbacks.seekToStepWrapper(0);
          } else {
            callbacks.stopMusic(false);
          }
        });

        // Start playback
        engine.play();
        console.log('[PLAY] Native C++/Wasm AudioWorklet engine started');
      } catch (e) {
        console.error("[PLAY] Failed to start native engine:", e);
        console.warn("[PLAY] Falling back to JS AudioWorklet engine");
        callbacks.setActiveEngine('worklet');
        // Continue to existing worklet path below
      }
    } else if (config.activeEngine === 'worklet' && config.isWorkletSupported) {
      console.log('[PLAY] Using AudioWorklet engine...');

      try {
        // Load the worklet module only once per AudioContext
        if (ctx.audioWorklet && !refs.workletLoadedRef.current) {
          console.log('[PLAY] ==================================================');
          console.log('[PLAY] Loading AudioWorklet module...');
          console.log('[PLAY] Resolved URL:', config.WORKLET_URL);
          console.log('[PLAY] AudioContext state:', ctx.state);
          console.log('[PLAY] ==================================================');
          await ctx.audioWorklet.addModule(config.WORKLET_URL);
          refs.workletLoadedRef.current = true;
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
        let wasmMemory = refs.wasmMemoryRef.current;
        const processorOptions: Record<string, unknown> = {};
        if (!wasmMemory && window.crossOriginIsolated) {
          console.log('[PLAY] Allocating shared WASM.Memory for worklet (16MB)');
          wasmMemory = new WebAssembly.Memory({
            initial: 256, // 256 pages = 16 MB
            maximum: 256,
            shared: true,
          });
          refs.wasmMemoryRef.current = wasmMemory;
        }
        if (wasmMemory) processorOptions.memory = wasmMemory;
        const node = new AudioWorkletNode(ctx, 'openmpt-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions,
        });
        console.log('[PLAY] AudioWorkletNode created:', node);

        node.port.onmessage = (e) => {
          const { type, order, row, positionSeconds, message, bpm } = e.data;

          if (type === 'position') {
            const now = ctx.currentTime;
            refs.workletOrderRef.current = order;
            refs.workletRowRef.current = row;
            refs.workletTimeRef.current = positionSeconds;
            // TIMING FIX: Use audio context time for consistency
            refs.lastWorkletUpdateRef.current = now;

            // TIMING FIX: Update BPM ref from worklet
            if (bpm && bpm > 0) {
              refs.workletBpmRef.current = bpm;
              callbacks.setModuleInfo((prev: ModuleInfo) => ({ ...prev, bpm }));
            }

            // TIMING FIX: Check for seek acknowledgment
            if (refs.pendingSeekRef.current &&
                order === refs.pendingSeekRef.current.order &&
                row === refs.pendingSeekRef.current.row) {
              refs.seekAcknowledgedRef.current = true;
              refs.pendingSeekRef.current = null;
            }
          } else if (type === 'ended') {
            console.log('[PLAY] Worklet reported module ended');
            if (config.isLooping) {
              callbacks.seekToStepWrapper(0);
            } else {
              callbacks.stopMusic(false);
            }
          } else if (type === 'error') {
            console.error("[PLAY] Worklet error:", message);
            // Detect WASM init failure and fall back to ScriptProcessorNode
            if ((message?.includes('Lib init failed') || message?.includes('WASM library init timeout'))
                && !refs.spFallbackTriggered.current) {
              refs.spFallbackTriggered.current = true;
              console.warn('[PLAY] Worklet WASM init failed — falling back to ScriptProcessorNode');
              try { node.disconnect(); } catch (_e) { /* ignore */ }
              refs.audioWorkletNodeRef.current = null;

              const lib = refs.libopenmptRef.current;
              const modPtr = refs.currentModulePtr.current;
              if (lib && modPtr) {
                const SP_BUFFER = 4096;
                const spNode = ctx.createScriptProcessor(SP_BUFFER, 0, 2);
                const leftPtr  = lib._malloc(4 * SP_BUFFER);
                const rightPtr = lib._malloc(4 * SP_BUFFER);
                refs.spLeftBufPtr.current  = leftPtr;
                refs.spRightBufPtr.current = rightPtr;
                // Best-quality interpolation
                lib._openmpt_module_set_render_param(modPtr, 2, 8);

                spNode.onaudioprocess = (audioEvt: AudioProcessingEvent) => {
                  const outL = audioEvt.outputBuffer.getChannelData(0);
                  const outR = audioEvt.outputBuffer.getChannelData(1);
                  const mPtr = refs.currentModulePtr.current;
                  const mLib = refs.libopenmptRef.current;
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
                  refs.workletOrderRef.current = mLib._openmpt_module_get_current_order(mPtr);
                  refs.workletRowRef.current   = mLib._openmpt_module_get_current_row(mPtr);
                  refs.workletTimeRef.current  = mLib._openmpt_module_get_position_seconds(mPtr);
                  refs.lastWorkletUpdateRef.current = ctx.currentTime;
                };

                spNode.connect(refs.analyserRef.current!);
                refs.scriptProcessorRef.current = spNode;

                refs.isPlayingRef.current = true;
                callbacks.setIsPlaying(true);
                callbacks.setStatus("Playing (ScriptProcessor fallback)...");
                if (refs.animationFrameHandle.current) cancelAnimationFrame(refs.animationFrameHandle.current);
                refs.animationFrameHandle.current = requestAnimationFrame(callbacks.updateUI);
              } else {
                callbacks.setStatus("Error: no module loaded for ScriptProcessor fallback");
              }
            } else if (!refs.spFallbackTriggered.current) {
              callbacks.setStatus("Worklet error: " + message);
            }
          } else if (type === 'loaded') {
            // Module is now loaded inside the worklet – safe to start the UI.
            // This deferred start avoids the ~1-2 s off-timing caused by WASM
            // initialisation happening after isPlaying was already set to true.
            console.log("[PLAY] Worklet loaded module – starting animation");
            refs.isPlayingRef.current = true;
            callbacks.setIsPlaying(true);
            callbacks.setStatus("Playing...");
            if (refs.animationFrameHandle.current) cancelAnimationFrame(refs.animationFrameHandle.current);
            refs.animationFrameHandle.current = requestAnimationFrame(callbacks.updateUI);
          } else if (type === 'seekAck') {
            // TIMING FIX: Worklet acknowledged seek
            refs.seekAcknowledgedRef.current = true;
            refs.pendingSeekRef.current = null;
          }
        };

        // Send module data (cloned, not transferred, so fileDataRef remains valid)
        const buf = refs.fileDataRef.current?.buffer;
        if (buf) {
          console.log('[PLAY] Sending module data to worklet:', buf.byteLength, 'bytes');
          node.port.postMessage({ type: 'load', moduleData: buf });
        } else {
          console.error("[PLAY] No buffer to send to worklet!");
        }

        console.log('[PLAY] Connecting audio graph: worklet -> analyser -> panner -> gain -> destination');
        node.connect(refs.analyserRef.current!);
        refs.analyserRef.current!.connect(refs.stereoPannerRef.current!);
        refs.stereoPannerRef.current!.connect(refs.gainNodeRef.current!);
        refs.gainNodeRef.current!.connect(ctx.destination);

        refs.audioWorkletNodeRef.current = node;
        // Show a loading state while the 4.8 MB WASM finishes initialising.
        // isPlaying will be set to true via the 'loaded' message handler above.
        callbacks.setStatus("Loading audio engine...");
        console.log('[PLAY] AudioWorklet setup complete – waiting for WASM loaded event');
      } catch (e) {
        console.error("[PLAY] Failed to create/load AudioWorkletNode:", e);
        refs.workletLoadedRef.current = false;
        callbacks.setStatus("Error: AudioWorklet failed to start (no ScriptProcessor fallback).");
        return;
      }
    } else {
      callbacks.setStatus("Error: AudioWorklet not supported/available.");
      return;
    }

    if (!refs.audioWorkletNodeRef.current && config.activeEngine === 'native-worklet') {
      refs.isPlayingRef.current = true;
      callbacks.setIsPlaying(true);
      callbacks.setStatus("Playing...");
      refs.animationFrameHandle.current = requestAnimationFrame(callbacks.updateUI);
    }

  } catch (e) {
    console.error("[PLAY] Play error:", e);
    callbacks.setStatus("Error starting playback");
  }
}
