// Audio graph setup extracted from useLibOpenMPT.ts to keep that hook under 777 lines.
// startAudioPlayback() contains everything that was inside the play() useCallback.

import type React from 'react';
import { LibOpenMPT, PatternMatrix, ChannelShadowState, ModuleInfo, PatternCell } from '../types';
import { OpenMPTWorkletEngine, NATIVE_RING_BUF_FRAMES } from '../audio-worklet/OpenMPTWorkletEngine';
import type { WorkletPositionData } from '../audio-worklet/types';
import { getWorkletUrl } from './useWorkletLoader';
import { ensureMasterOutputChain } from '../utils/audioMasterGraph';
import { broadcastPcmBlock } from '../utils/projectMBridge';
import { logWorkletDiagnostics } from '../audio-worklet/diagnostics';
import { detectRuntimeBase, withBase } from '../src/lib/paths';
import { applyWorkletPositionSample } from '../utils/playheadPrediction';
import {
  applyNormalizedPosition,
  nativePositionToInput,
} from '../utils/workletPositionAdapter';
import {
  canReuseWorkletNode,
  shouldDisconnectWorkletOnPlay,
  shouldForceWorkletModuleLoad,
  shouldPostInitLib,
} from '../utils/workletAudioLifecycle';
import {
  parseWorkletToMainMessageOrWarn,
  postInitLib,
  postLoad,
  postPause,
  postPlay,
  postSetAudioDiag,
  postSetProjectmPcm,
} from '../audio-worklet/protocol';
import {
  hasProjectMConsumer,
  isAudioDiagEnabled,
  mergeAudioDiag,
} from '../utils/audioDiagOptions';
import { dispatchWorkletToMainMessage } from '../audio-worklet/jsWorkletDispatch';

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
  workletTimestampRef: React.MutableRefObject<number>;
  lastWorkletUpdateRef: React.MutableRefObject<number>;
  workletBpmRef:       React.MutableRefObject<number>;
  workletSpeedRef:     React.MutableRefObject<number>;
  workletRowsPerSecRef: React.MutableRefObject<number>;
  workletPositionSampleRef: React.MutableRefObject<import('../utils/playheadPrediction').WorkletPositionSample | null>;
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
  updateUIRef:         React.MutableRefObject<(() => void) | null>;
  /** SharedArrayBuffer provided to the native engine constructor (may be null in non-isolated contexts). */
  nativeSharedBuffer:  React.MutableRefObject<SharedArrayBuffer | null>;
  /** Callback to lazily create a main-thread libopenmpt module for ScriptProcessor fallback. */
  ensureMainThreadModuleRef: React.MutableRefObject<((data: Uint8Array) => Promise<void>) | null>;
  /** Incremented on each processModuleData — guards stale worklet `loaded` acks. */
  workletModuleTokenRef: React.MutableRefObject<number>;
  lastWorkletModuleTokenSentRef: React.MutableRefObject<number>;
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
  /** Set after processModuleData — always post `load` even if isPlayingRef is still true (#329). */
  forceModuleLoad?:       boolean;
}

// AUDIO-001 FIX COMPLETE: Centralized worklet URL from useWorkletLoader
const WORKLET_URL = getWorkletUrl();

function masterGraphRefs(refs: AudioGraphRefs) {
  return {
    analyserRef: refs.analyserRef,
    stereoPannerRef: refs.stereoPannerRef,
    gainNodeRef: refs.gainNodeRef,
  };
}

/** Re-assert analyser → panner → gain → destination and apply live levels. */
function wireMasterOutput(
  ctx: AudioContext,
  refs: AudioGraphRefs,
  volume: number,
  pan: number,
): void {
  ensureMasterOutputChain(ctx, masterGraphRefs(refs));
  if (refs.stereoPannerRef.current) {
    refs.stereoPannerRef.current.pan.value = pan;
  }
  if (refs.gainNodeRef.current) {
    refs.gainNodeRef.current.gain.value = volume;
  }
}

/** Exact module bytes for worklet load — safe when Uint8Array is a subarray. */
function moduleBytesFromFileData(fileData: Uint8Array | null): ArrayBuffer | null {
  if (!fileData || fileData.byteLength === 0) return null;
  const copy = new Uint8Array(fileData.byteLength);
  copy.set(fileData);
  return copy.buffer;
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

  const moduleToken = refs.workletModuleTokenRef.current;
  const moduleNeedsWorkletLoad = shouldForceWorkletModuleLoad(
    moduleToken,
    refs.lastWorkletModuleTokenSentRef.current,
    config.forceModuleLoad,
  );

  if (refs.isPlayingRef.current && refs.audioWorkletNodeRef.current) {
    // Hot module reload (#329): stopMusic clears isPlayingRef, but a concurrent
    // `loaded` ack can flip it back before loadModule's play() runs — never skip
    // posting `load` when the module token advanced.
    if (moduleNeedsWorkletLoad) {
      const moduleBuf = moduleBytesFromFileData(refs.fileDataRef.current);
      if (moduleBuf) {
        console.log('[PLAY] Hot reload while playing — posting load to worklet:', moduleBuf.byteLength, 'bytes');
        refs.lastWorkletModuleTokenSentRef.current = moduleToken;
        refs.audioWorkletNodeRef.current.port.postMessage(postLoad(moduleBuf));
        callbacks.setStatus('Loading audio engine...');
      }
      return;
    }

    // Recover from "UI playing / worklet paused" races: stopMusic pauses the
    // processor but a stale React render used to clear isPlayingRef. Always
    // nudge the worklet + resume the context instead of hard-ignoring.
    console.log('[PLAY] Already marked playing — ensuring worklet render + context resume');
    try {
      refs.audioWorkletNodeRef.current.port.postMessage(postPlay());
    } catch { /* ignore */ }
    const existingCtx = refs.audioContextRef.current;
    if (existingCtx?.state === 'suspended') {
      try { await existingCtx.resume(); } catch { /* ignore */ }
    }
    if (refs.gainNodeRef.current) {
      refs.gainNodeRef.current.gain.value = config.volume;
    }
    if (refs.stereoPannerRef.current) {
      refs.stereoPannerRef.current.pan.value = config.panValue;
    }
    if (existingCtx) {
      wireMasterOutput(existingCtx, refs, config.volume, config.panValue);
    }
    if (!refs.animationFrameHandle.current && refs.updateUIRef.current) {
      refs.animationFrameHandle.current = requestAnimationFrame(refs.updateUIRef.current);
    }
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
      refs.workletLoadedRef.current = false;

      // AUDIO-001 FIX COMPLETE: Detailed log right after AudioContext creation
      const ctx = refs.audioContextRef.current;
      console.log('[AudioEngine] AudioContext created', {
        state: ctx.state,
        sampleRate: ctx.sampleRate,
        baseLatency: ctx.baseLatency,
        outputLatency: ctx.outputLatency ?? 0,
        timestamp: performance.now(),
      });
    }

    const ctx = refs.audioContextRef.current;
    console.log('[PLAY] AudioContext state:', ctx.state);
    
    // AUDIO-001 FIX COMPLETE: Log diagnostics
    logWorkletDiagnostics(config.WORKLET_URL, ctx);

    if (ctx.state === 'suspended') {
      console.log('[PLAY] Resuming suspended AudioContext...');
      await ctx.resume();
      console.log('[PLAY] AudioContext resumed, new state:', ctx.state);
    }

    // TIMING FIX: Initialize audio clock reference
    refs.audioClockStartRef.current = ctx.currentTime;
    refs.workletTimeAtStartRef.current = refs.workletTimeRef.current || 0;
    refs.driftAccumulatorRef.current = 0;

    // Setup common nodes
    if (!refs.stereoPannerRef.current) {
      console.log('[PLAY] Creating StereoPanner node...');
      refs.stereoPannerRef.current = ctx.createStereoPanner();
    }
    refs.stereoPannerRef.current.pan.value = config.panValue;

    if (!refs.gainNodeRef.current) {
      console.log('[PLAY] Creating Gain node...');
      refs.gainNodeRef.current = ctx.createGain();
    }
    // Always re-apply volume — App slider can change while the GainNode lives on.
    refs.gainNodeRef.current.gain.value = config.volume;

    if (!refs.analyserRef.current) {
      console.log('[PLAY] Creating Analyser node...');
      refs.analyserRef.current = ctx.createAnalyser();
      refs.analyserRef.current.fftSize = 2048;
      refs.analyserRef.current.smoothingTimeConstant = 0.8;
    }
    wireMasterOutput(ctx, refs, config.volume, config.panValue);

    // Disconnect previous source unless we can hot-reload module data into the
    // existing JS worklet node (avoids re-init of shared-scope libopenmpt WASM).
    const reuseWorkletNode = canReuseWorkletNode({
      activeEngine: config.activeEngine,
      workletLoaded: refs.workletLoadedRef.current,
      hasWorkletNode: refs.audioWorkletNodeRef.current != null,
    });

    const staleWorkletNode = refs.audioWorkletNodeRef.current;
    if (shouldDisconnectWorkletOnPlay(staleWorkletNode != null, reuseWorkletNode) && staleWorkletNode) {
      console.log('[PLAY] Disconnecting previous AudioWorkletNode...');
      try { staleWorkletNode.port.postMessage(postPause()); } catch { /* ignore */ }
      try { staleWorkletNode.port.onmessage = null; } catch { /* ignore */ }
      try { staleWorkletNode.disconnect(); } catch { /* ignore */ }
      refs.audioWorkletNodeRef.current = null;
    }

    let currentEngineToTry = config.activeEngine;

    if (currentEngineToTry === 'native-worklet' && config.isNativeWorkletAvailable) {
      // ── Native C++/Wasm AudioWorklet engine (Phase 2) ──
      console.log('[PLAY] Using native C++/Wasm AudioWorklet engine...');
      try {
        const engine = refs.nativeEngineRef.current!;

        // Load module data into the native engine
        const buf = moduleBytesFromFileData(refs.fileDataRef.current);
        if (buf) {
          console.log('[PLAY] Sending module data to native engine:', buf.byteLength, 'bytes');
          await engine.load(buf);
        }

        // Set engine parameters
        engine.setVolume(config.volume);
        engine.setLoop(config.isLooping);

        // ── Bridge native engine output to main-thread audio graph ─────────────
        //
        // Without bridging the C++ engine streams audio directly to its own
        // AudioContext destination, bypassing the shared GainNode / AnalyserNode /
        // StereoPannerNode chain.  Two strategies are attempted in priority order:
        //
        //   Strategy A — WASM ring buffer (crossOriginIsolated required):
        //     C++ writes samples into a shared-memory ring buffer.
        //     A bridge AudioWorkletNode on the main context reads the ring buffer
        //     and outputs via the shared audio graph.  Zero extra latency.
        //
        //   Strategy B — MediaStream bridge (fallback, always available):
        //     C++ AudioWorkletNode → MediaStreamDestinationNode (C++ ctx)
        //     → MediaStream → MediaStreamAudioSourceNode (main ctx)
        //     → AnalyserNode → GainNode → destination.
        //     Adds ~few-ms latency but works without WASM rebuild.

        let bridgeEstablished = false;

        // Strategy A: WASM ring buffer
        const wasmSAB = engine.getWasmMemory();
        const ringByteOffset = engine.getRingBufByteOffset();
        if (wasmSAB && ringByteOffset > 0) {
          try {
            const bridgeUrl = withBase('worklets/native-bridge-processor.js');
            await ctx.audioWorklet.addModule(bridgeUrl);
            const bridgeNode = new AudioWorkletNode(ctx, 'native-bridge-processor', {
              numberOfInputs: 0,
              numberOfOutputs: 1,
              outputChannelCount: [2],
              processorOptions: {
                wasmMemory: wasmSAB,
                ringBufByteOffset: ringByteOffset,
                frameCapacity: NATIVE_RING_BUF_FRAMES,
              },
            });
            bridgeNode.connect(refs.analyserRef.current!);
            wireMasterOutput(ctx, refs, config.volume, config.panValue);
            // Store bridge node so stopMusic() can disconnect it
            refs.audioWorkletNodeRef.current = bridgeNode;
            bridgeEstablished = true;
            console.log('[PLAY] Native engine: ring-buffer bridge active (Strategy A)');
          } catch (ringErr) {
            console.warn('[PLAY] Ring-buffer bridge failed, trying MediaStream bridge:', ringErr);
          }
        }

        // Strategy B: MediaStream bridge
        if (!bridgeEstablished) {
          try {
            const mediaSrc = await engine.bridgeToAudioGraph(ctx, refs.analyserRef.current!);
            if (mediaSrc) {
              wireMasterOutput(ctx, refs, config.volume, config.panValue);
              bridgeEstablished = true;
              console.log('[PLAY] Native engine: MediaStream bridge active (Strategy B)');
            }
          } catch (msErr) {
            console.warn('[PLAY] MediaStream bridge failed:', msErr);
          }
        }

        if (!bridgeEstablished) {
          console.warn('[PLAY] Native engine audio not routed through main graph '
            + '(volume/analyser will not work). Ensure WASM was built with ring-buffer support '
            + 'or that emscriptenGetAudioObject is available.');
        }

        // Shared-memory PositionInfo is refreshed every quantum (pre-render
        // snapshot + frame clock). Both engines use applyNormalizedPosition.
        engine.on('position', (data: WorkletPositionData) => {
          const input = nativePositionToInput(data, ctx.currentTime);
          const applied = applyNormalizedPosition(refs, input, {
            channelStates: refs.channelStatesRef.current,
            channelVU: data.channelVU,
            numChannels: data.numChannels,
          });

          // TIMING FIX: Check for seek acknowledgment
          if (refs.pendingSeekRef.current &&
              applied.order === refs.pendingSeekRef.current.order &&
              applied.rowInt === refs.pendingSeekRef.current.row) {
            refs.seekAcknowledgedRef.current = true;
            refs.pendingSeekRef.current = null;
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

        // Native engine started successfully — start UI and exit
        refs.isPlayingRef.current = true;
        callbacks.setIsPlaying(true);
        callbacks.setStatus("Playing...");
        refs.animationFrameHandle.current = requestAnimationFrame(refs.updateUIRef.current!);
        return;
      } catch (e) {
        console.error("[PLAY] Failed to start native engine:", e);
        console.warn("[PLAY] Falling back to JS AudioWorklet engine");
        callbacks.setActiveEngine('worklet');
        currentEngineToTry = 'worklet';
      }
    }

    if (currentEngineToTry === 'worklet' && config.isWorkletSupported) {
      console.log('[PLAY] Using AudioWorklet engine...');

      try {
        // AUDIO-001 FIX COMPLETE: Enhanced worklet module loading with better error handling
        if (ctx.audioWorklet && !refs.workletLoadedRef.current) {
          // Use centralized WORKLET_URL for consistency
          const workletUrl = WORKLET_URL || config.WORKLET_URL;
          
          console.log('[PLAY] ==================================================');
          console.log('[PLAY] Loading AudioWorklet module...');
          console.log('[PLAY] Resolved URL:', workletUrl);
          console.log('[PLAY] AudioContext state:', ctx.state);
          console.log('[PLAY] ==================================================');
          
          try {
            // AUDIO-001 FIX COMPLETE: Add timeout for worklet loading to detect hanging
            const loadTimeout = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('Worklet module load timeout (10s)')), 10000);
            });
            
            const protocolUrl = withBase('worklets/worklet-protocol-constants.js?v=2');
            const loadProtocol = ctx.audioWorklet.addModule(protocolUrl);
            const loadWorklet = ctx.audioWorklet.addModule(workletUrl);
            await Promise.race([
              Promise.all([loadProtocol, loadWorklet]),
              loadTimeout,
            ]);
            
            refs.workletLoadedRef.current = true;
            console.log('[PLAY] ✅ AudioWorklet module loaded successfully');
          } catch (loadError) {
            console.error('[PLAY] ❌ Failed to load AudioWorklet module:', loadError);
            console.error('[PLAY] URL attempted:', workletUrl);
            
            // AUDIO-001 FIX COMPLETE: Provide helpful diagnostics for common issues
            const errorMsg = (loadError as Error).message || 'Unknown error';
            
            // Check for 404 errors
            if (errorMsg.includes('404') || errorMsg.includes('Not Found')) {
              console.error('[PLAY] This appears to be a 404 error.');
              console.error('[PLAY] Ensure the worklet file exists at:', workletUrl);
              console.error('[PLAY] The file should be in public/worklets/ directory.');
            }
            
            // Check for common CORS issues
            if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
              console.error('[PLAY] This appears to be a CORS or network issue.');
              console.error('[PLAY] Ensure the server sends proper CORS headers for the worklet file.');
            }
            
            // Check for MIME type issues
            if (errorMsg.includes('MIME') || errorMsg.includes('application/javascript')) {
              console.error('[PLAY] This appears to be a MIME type issue.');
              console.error('[PLAY] Ensure the server serves .js files with Content-Type: application/javascript');
            }
            
            throw loadError;
          }
        } else {
          console.log('[PLAY] Worklet module already loaded (skipping addModule)');
        }

        let node: AudioWorkletNode;
        let libJsText: string | undefined;
        let libWasmBuffer: ArrayBuffer | null = null;

        if (reuseWorkletNode && refs.audioWorkletNodeRef.current) {
          node = refs.audioWorkletNodeRef.current;
          console.log('[PLAY] Reusing existing AudioWorkletNode (hot module reload)');
        } else {
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
        // Pass base URL so the worklet can resolve WASM/co-located assets correctly
        processorOptions.baseUrl = detectRuntimeBase();
        
        // AUDIO-001 FIX COMPLETE: Wrap node creation in try-catch for better diagnostics
        try {
          node = new AudioWorkletNode(ctx, 'openmpt-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions,
          });
        } catch (nodeError) {
          console.error('[PLAY] ❌ Failed to create AudioWorkletNode:', nodeError);
          console.error('[PLAY] This may indicate the worklet module failed to register properly.');
          throw nodeError;
        }
        
        console.log('[PLAY] AudioWorkletNode created:', node);

        // Fetch libopenmpt glue on the main thread and forward to the worklet.
        // AudioWorklet classic scripts cannot use import() or importScripts(), so we
        // do the fetch here where fetch() is always available.
        //
        // Production glue (`libopenmpt-audioworklet.js`) is a wasm2js build: the
        // entire runtime is embedded in the ~5 MB JS file. A sibling
        // `libopenmpt.wasm` is NOT required and must NOT be seeded as wasmBinary
        // (that overwrites wasm2js's empty binary and can break init).
        // Optional real `.wasm` is only fetched when the glue is a classic
        // Emscripten binary build (no isWasm2js marker).
        console.log('[PLAY] Fetching libopenmpt assets for worklet...');
        const workletBaseUrl = withBase('worklets/');
        try {
          const jsResp = await fetch(workletBaseUrl + 'libopenmpt-audioworklet.js');
          if (!jsResp.ok) {
            throw new Error(`HTTP ${jsResp.status} for libopenmpt-audioworklet.js`);
          }
          libJsText = await jsResp.text();
          if (!libJsText.trim()) {
            throw new Error('libopenmpt-audioworklet.js is empty');
          }

          // Emscripten wasm2js emits `isWasm2js:!0` (minified) or `isWasm2js: true`.
          const isWasm2js =
            /isWasm2js\s*:\s*!\s*0/.test(libJsText) ||
            /isWasm2js\s*:\s*true/.test(libJsText);

          if (isWasm2js) {
            console.log(
              '[PLAY] libopenmpt-audioworklet.js is wasm2js — JS only,',
              libJsText.length,
              'chars; skipping sibling .wasm fetch',
            );
          } else {
            const wasmResp = await fetch(workletBaseUrl + 'libopenmpt.wasm');
            if (!wasmResp.ok) {
              throw new Error(`HTTP ${wasmResp.status} for libopenmpt.wasm`);
            }
            libWasmBuffer = await wasmResp.arrayBuffer();
            const head = new Uint8Array(libWasmBuffer, 0, Math.min(8, libWasmBuffer.byteLength));
            // WebAssembly binary magic: \0asm (0x00 0x61 0x73 0x6d)
            const isWasmMagic =
              head.length >= 4 &&
              head[0] === 0x00 &&
              head[1] === 0x61 &&
              head[2] === 0x73 &&
              head[3] === 0x6d;
            if (!isWasmMagic) {
              const preview = new TextDecoder('utf-8', { fatal: false })
                .decode(head)
                .replace(/\s+/g, ' ')
                .slice(0, 40);
              throw new Error(
                `libopenmpt.wasm is not a valid WebAssembly binary ` +
                  `(missing \\0asm magic; starts with ${JSON.stringify(preview)}). ` +
                  `Refusing to seed corrupt HTML/text as wasmBinary.`,
              );
            }
            console.log(
              '[PLAY] libopenmpt assets fetched — JS:',
              libJsText.length,
              'chars, WASM:',
              libWasmBuffer.byteLength,
              'bytes',
            );
          }
        } catch (fetchErr) {
          console.error('[PLAY] Failed to fetch libopenmpt assets:', fetchErr);
          throw fetchErr;
        }
        } // end first-time node + lib fetch

        node.port.onmessage = async (e) => {
          const message = parseWorkletToMainMessageOrWarn(e.data, '[PLAY]');
          if (!message) return;

          const result = dispatchWorkletToMainMessage({
            refs,
            message,
            audioContextCurrentTime: ctx.currentTime,
          });

          switch (result.kind) {
            case 'position':
              break;

            case 'loaded-stale':
              console.log('[PLAY] Ignoring stale worklet loaded ack (token mismatch)');
              return;

            case 'loaded-accepted': {
              console.log("[PLAY] Worklet loaded module – starting animation");
              refs.isPlayingRef.current = true;
              callbacks.setIsPlaying(true);
              callbacks.setStatus("Playing...");
              if (refs.gainNodeRef.current) {
                refs.gainNodeRef.current.gain.value = config.volume;
              }
              if (refs.stereoPannerRef.current) {
                refs.stereoPannerRef.current.pan.value = config.panValue;
              }
              if (ctx.state === 'suspended') {
                try { await ctx.resume(); } catch { /* ignore */ }
              }
              if (refs.animationFrameHandle.current) cancelAnimationFrame(refs.animationFrameHandle.current);
              refs.animationFrameHandle.current = requestAnimationFrame(refs.updateUIRef.current!);
              node.port.postMessage(postPlay());
              break;
            }

            case 'ended':
              console.log('[PLAY] Worklet reported module ended');
              if (config.isLooping) {
                callbacks.seekToStepWrapper(0);
              } else {
                callbacks.stopMusic(false);
              }
              break;

            case 'error': {
              console.error("[PLAY] Worklet error:", result.message);
              if (result.shouldAttemptSpFallback) {
                refs.spFallbackTriggered.current = true;
                console.warn('[PLAY] Worklet WASM init failed — falling back to ScriptProcessorNode');
                try { node.port.postMessage(postPause()); } catch (_e) { /* ignore */ }
                try { node.port.onmessage = null; } catch (_e) { /* ignore */ }
                try { node.disconnect(); } catch (_e) { /* ignore */ }
                refs.audioWorkletNodeRef.current = null;

                if (refs.currentModulePtr.current === 0 && refs.ensureMainThreadModuleRef.current && refs.fileDataRef.current) {
                  await refs.ensureMainThreadModuleRef.current(refs.fileDataRef.current);
                }

                const lib = refs.libopenmptRef.current;
                const modPtr = refs.currentModulePtr.current;
                if (lib && modPtr) {
                  const SP_BUFFER = 4096;
                  const spNode = ctx.createScriptProcessor(SP_BUFFER, 0, 2);
                  const leftPtr  = lib._malloc(4 * SP_BUFFER);
                  const rightPtr = lib._malloc(4 * SP_BUFFER);
                  refs.spLeftBufPtr.current  = leftPtr;
                  refs.spRightBufPtr.current = rightPtr;
                  lib._openmpt_module_set_render_param(modPtr, 2, 4);

                  // Cached heap views — recreate only when Emscripten grows HEAPF32.
                  let spHeapBuf: ArrayBuffer | null = null;
                  let spLeftView: Float32Array | null = null;
                  let spRightView: Float32Array | null = null;

                  spNode.onaudioprocess = (audioEvt: AudioProcessingEvent) => {
                    const outL = audioEvt.outputBuffer.getChannelData(0);
                    const outR = audioEvt.outputBuffer.getChannelData(1);
                    const mPtr = refs.currentModulePtr.current;
                    const mLib = refs.libopenmptRef.current;
                    if (!mLib || !mPtr) { outL.fill(0); outR.fill(0); return; }

                    let written = mLib._openmpt_module_read_float_stereo(
                      mPtr, ctx.sampleRate, SP_BUFFER, leftPtr, rightPtr
                    );
                    if (written === 0 && config.isLooping) {
                      mLib._openmpt_module_set_position_order_row(mPtr, 0, 0);
                      written = mLib._openmpt_module_read_float_stereo(
                        mPtr, ctx.sampleRate, SP_BUFFER, leftPtr, rightPtr
                      );
                    }
                    if (written > 0) {
                      const heap = mLib.HEAPF32.buffer as ArrayBuffer;
                      if (spHeapBuf !== heap || !spLeftView || !spRightView) {
                        spHeapBuf = heap;
                        spLeftView = new Float32Array(heap, leftPtr, SP_BUFFER);
                        spRightView = new Float32Array(heap, rightPtr, SP_BUFFER);
                      }
                      for (let i = 0; i < written; i++) {
                        outL[i] = spLeftView[i]!;
                        outR[i] = spRightView[i]!;
                      }
                      if (written < SP_BUFFER) { outL.fill(0, written); outR.fill(0, written); }
                    } else {
                      outL.fill(0); outR.fill(0);
                    }

                    const spTime = ctx.currentTime;
                    applyWorkletPositionSample(refs, {
                      order: mLib._openmpt_module_get_current_order(mPtr),
                      row: mLib._openmpt_module_get_current_row(mPtr),
                      positionSeconds: mLib._openmpt_module_get_position_seconds(mPtr),
                      workletTime: spTime,
                      bpm: mLib._openmpt_module_get_current_estimated_bpm(mPtr),
                      speed: mLib._openmpt_module_get_current_speed(mPtr),
                    });
                  };

                  spNode.connect(refs.analyserRef.current!);
                  wireMasterOutput(ctx, refs, config.volume, config.panValue);
                  refs.scriptProcessorRef.current = spNode;

                  refs.isPlayingRef.current = true;
                  callbacks.setIsPlaying(true);
                  callbacks.setStatus("Playing (ScriptProcessor fallback)...");
                  if (refs.animationFrameHandle.current) cancelAnimationFrame(refs.animationFrameHandle.current);
                  refs.animationFrameHandle.current = requestAnimationFrame(refs.updateUIRef.current!);
                } else {
                  callbacks.setStatus("Error: no module loaded for ScriptProcessor fallback");
                }
              } else if (!refs.spFallbackTriggered.current) {
                callbacks.setStatus("Worklet error: " + result.message);
              }
              break;
            }

            case 'seek-ack':
              break;

            case 'diagnostic':
              console.warn(`[PLAY] Worklet ${result.subtype}:`, result.raw);
              break;

            case 'projectm-pcm': {
              const buf = result.buffer;
              const ch = result.channels;
              if (buf instanceof Float32Array && (ch === 1 || ch === 2)) {
                broadcastPcmBlock(buf, ch);
              }
              break;
            }

            case 'audio-diag': {
              const snapshot = mergeAudioDiag(window.__AUDIO_DIAG__, result.diag);
              window.__AUDIO_DIAG__ = snapshot;
              if (result.diag.wrapOverruns > 0) {
                console.warn(
                  `[AudioDiag] process() overran the ${snapshot.budgetMs.toFixed(2)} ms quantum ` +
                  `on a pattern boundary: ${result.diag.wrapMaxProcessMs.toFixed(2)} ms ` +
                  `(order ${result.diag.order}, row ${result.diag.row})`,
                );
              }
              break;
            }

            case 'ignored':
              break;

            default: {
              const _exhaustive: never = result;
              return _exhaustive;
            }
          }
        };

        // Send glue (+ optional real WASM) to worklet first (must arrive before 'load').
        // Transfer wasm buffer only when present; wasm2js path sends JS alone.
        if (shouldPostInitLib(reuseWorkletNode, libJsText) && libJsText) {
          if (libWasmBuffer) {
            node.port.postMessage(
              postInitLib(libJsText, libWasmBuffer),
              [libWasmBuffer],
            );
          } else {
            node.port.postMessage(postInitLib(libJsText));
          }
        }

        // Opt-in per-quantum extras. Both default to off inside the worklet, so
        // these must be re-sent for a reused node as well.
        node.port.postMessage(postSetProjectmPcm(hasProjectMConsumer()));
        node.port.postMessage(postSetAudioDiag(isAudioDiagEnabled()));

        const moduleBuf = moduleBytesFromFileData(refs.fileDataRef.current);
        if (moduleBuf) {
          console.log('[PLAY] Sending module data to worklet:', moduleBuf.byteLength, 'bytes');
          refs.lastWorkletModuleTokenSentRef.current = refs.workletModuleTokenRef.current;
          node.port.postMessage(postLoad(moduleBuf));
        } else {
          console.error("[PLAY] No buffer to send to worklet!");
        }

        console.log('[PLAY] Connecting audio graph: worklet -> analyser -> panner -> gain -> destination');
        if (!reuseWorkletNode) {
          try { node.disconnect(); } catch { /* ignore stale edges */ }
          node.connect(refs.analyserRef.current!);
        } else {
          console.log('[PLAY] Hot reload — keeping existing worklet wiring; re-asserting master output chain');
        }
        wireMasterOutput(ctx, refs, config.volume, config.panValue);

        refs.audioWorkletNodeRef.current = node;
        // Show a loading state while the 4.8 MB WASM finishes initialising.
        // isPlaying will be set to true via the 'loaded' message handler above.
        callbacks.setStatus("Loading audio engine...");
        console.log('[PLAY] AudioWorklet setup complete – waiting for WASM loaded event');
      } catch (e) {
        console.error("[PLAY] Failed to create/load AudioWorkletNode:", e);
        refs.workletLoadedRef.current = false;
        
        // AUDIO-001 FIX COMPLETE: Better error messages based on error type
        const errorMsg = (e as Error).message || 'Unknown error';
        if (errorMsg.includes('timeout')) {
          callbacks.setStatus("Error: AudioWorklet load timeout (check network)");
        } else if (errorMsg.includes('404') || errorMsg.includes('Not Found')) {
          callbacks.setStatus("Error: Worklet file not found (check deployment)");
        } else {
          callbacks.setStatus("Error: AudioWorklet failed to start (no ScriptProcessor fallback).");
        }
        return;
      }
    } else {
      callbacks.setStatus("Error: AudioWorklet not supported/available.");
      return;
    }



  } catch (e) {
    console.error("[PLAY] Play error:", e);
    callbacks.setStatus("Error starting playback");
  }
}
