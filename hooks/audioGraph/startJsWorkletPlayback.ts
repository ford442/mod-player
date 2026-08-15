import { getWorkletUrl } from '../useWorkletLoader';
import { detectRuntimeBase, withBase } from '../../src/lib/paths';
import { broadcastPcmBlock } from '../../utils/projectMBridge';
import { shouldPostInitLib } from '../../utils/workletAudioLifecycle';
import {
  parseWorkletToMainMessageOrWarn,
  postInitLib,
  postLoad,
  postPlay,
  postSetAudioDiag,
  postSetProjectmPcm,
} from '../../audio-worklet/protocol';
import {
  hasProjectMConsumer,
  isAudioDiagEnabled,
  mergeAudioDiag,
} from '../../utils/audioDiagOptions';
import { dispatchWorkletToMainMessage } from '../../audio-worklet/jsWorkletDispatch';
import { moduleBytesFromFileData, wireMasterOutput } from './masterGraph';
import { runScriptProcessorFallback } from './scriptProcessorFallback';
import type { AudioGraphCallbacks, AudioGraphConfig, AudioGraphRefs } from './types';

// AUDIO-001 FIX COMPLETE: Centralized worklet URL from useWorkletLoader
const WORKLET_URL = getWorkletUrl();

export type JsWorkletPlaybackResult = 'setup-complete' | 'failed';

/**
 * Load / reuse the JS AudioWorklet node, post initLib + load, wire master graph.
 * Playback becomes "playing" when the worklet posts a accepted `loaded` ack.
 */
export async function startJsWorkletPlayback(
  refs: AudioGraphRefs,
  callbacks: AudioGraphCallbacks,
  config: AudioGraphConfig,
  ctx: AudioContext,
  reuseWorkletNode: boolean,
): Promise<JsWorkletPlaybackResult> {
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
            await runScriptProcessorFallback(refs, callbacks, config, ctx, node);
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
    return 'setup-complete';
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
    return 'failed';
  }
}
