import { getWorkletUrl } from '../useWorkletLoader';
import { detectRuntimeBase } from '../../src/lib/paths';
import { broadcastPcmBlock } from '../../utils/projectMBridge';
import {
  pcmBusHasSubscribers,
  publishPcmBlock,
  setPcmDemandListener,
} from '../../utils/pcmBus';
import { shouldPostInitLib } from '../../utils/workletAudioLifecycle';
import { fetchWorkletLibAssets } from '../../utils/workletLibAssets';
import { resolveJsInterpolationLength } from '../../utils/jsInterpolation';
import { OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH } from '../../utils/openmptRenderParams';
import {
  parseWorkletToMainMessageOrWarn,
  postInitLib,
  postLoad,
  postPause,
  postPlay,
  postReturnPcmBuffer,
  postSetAudioDiag,
  postSetProjectmPcm,
  postSetRenderParam,
} from '../../audio-worklet/protocol';
import {
  clearAudioFault,
  noteAudioRestartAttempt,
  setAudioFaulted,
} from '../../utils/audioEngineFaultState';
import {
  hasProjectMConsumer,
  isAudioDiagEnabled,
  mergeAudioDiag,
} from '../../utils/audioDiagOptions';
import { seedPatternDiag } from '../../utils/patternBoundaryDiag';
import { dispatchWorkletToMainMessage } from '../../audio-worklet/jsWorkletDispatch';
import { moduleBytesFromFileData, wireMasterOutput } from './masterGraph';
import { runScriptProcessorFallback } from './scriptProcessorFallback';
import type { AudioGraphCallbacks, AudioGraphConfig, AudioGraphRefs } from './types';

// AUDIO-001 FIX COMPLETE: Centralized worklet URL from useWorkletLoader
const WORKLET_URL = getWorkletUrl();

export type JsWorkletPlaybackResult = 'setup-complete' | 'failed';

/**
 * Tear down a crashed worklet node and either restart it (fresh node, same
 * shared libopenmpt instance in the AudioWorkletGlobalScope — see
 * ensureSharedLibOpenMPT) or, if the restart itself faults again, give up on
 * the worklet path for this session and fall back to ScriptProcessorNode.
 *
 * Triggered by either `node.onprocessorerror` (an error the worklet's own
 * process() try/catch did not catch — e.g. a bug outside _renderQuantum) or a
 * `fatal` WT.error message (process() caught a wasm trap and silenced output).
 */
export async function handleWorkletFault(
  refs: AudioGraphRefs,
  callbacks: AudioGraphCallbacks,
  config: AudioGraphConfig,
  ctx: AudioContext,
  node: AudioWorkletNode,
  reason: 'processor-error' | 'process-trap',
  message: string,
): Promise<void> {
  const attempt = noteAudioRestartAttempt();
  setAudioFaulted(reason, message);
  refs.isPlayingRef.current = false;
  callbacks.setIsPlaying(false);

  console.error(`[PLAY] Worklet faulted (${reason}, attempt ${attempt}): ${message}`);

  // Best-effort teardown — the node is not trusted to respond to anything else.
  try { node.onprocessorerror = null; } catch { /* ignore */ }
  try { node.port.postMessage(postPause()); } catch { /* ignore */ }
  try { node.port.onmessage = null; } catch { /* ignore */ }
  try { node.disconnect(); } catch { /* ignore */ }
  if (refs.audioWorkletNodeRef.current === node) {
    refs.audioWorkletNodeRef.current = null;
  }

  if (attempt > 1) {
    console.error('[PLAY] Worklet restart faulted again — falling back to ScriptProcessorNode');
    callbacks.setStatus('Audio engine crashed — using fallback renderer');
    setAudioFaulted('restart-failed', message);
    await runScriptProcessorFallback(refs, callbacks, config, ctx, node);
    return;
  }

  callbacks.setStatus('Audio engine error — restarting…');
  // Do NOT clear the fault just because this returns 'setup-complete' — that
  // only means the node/message-handler setup ran, not that it's actually
  // rendering. restartAttempts must stay elevated until the 'loaded-accepted'
  // case above confirms the new node is healthy, so a module that traps on
  // every render still reaches the attempt>1 fallback instead of restarting
  // forever.
  await startJsWorkletPlayback(refs, callbacks, config, ctx, false);
}

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
          setTimeout(() => reject(new Error('Worklet module load timeout (30s)')), 30000);
        });

        await Promise.race([ctx.audioWorklet.addModule(workletUrl), loadTimeout]);

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
      // The JS engine's openmpt-processor.ts never reads processorOptions.memory —
      // it manages its own wasm memory internally (see ensureSharedLibOpenMPT).
      // A shared WebAssembly.Memory here was dead weight (16 MB allocated per
      // node, unused); only the native C++/Wasm engine needs shared memory, and
      // it manages its own via emscripten's WASM_WORKERS runtime, not this ref.
      const processorOptions: Record<string, unknown> = {};
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

      // Fetch the real-WASM libopenmpt pair on the main thread and forward it to the worklet.
      // AudioWorklet classic scripts cannot use import() or importScripts() and the worklet
      // scope has no fetch(), so both files are downloaded here (in parallel) and validated
      // (\0asm magic, not-wasm2js, not an HTML 404) before anything is posted.
      console.log('[PLAY] Fetching libopenmpt assets for worklet...');
      try {
        const assets = await fetchWorkletLibAssets();
        libJsText = assets.scriptText;
        libWasmBuffer = assets.wasmBytes;
        console.log(
          '[PLAY] libopenmpt assets fetched — JS:',
          libJsText.length,
          'chars, WASM:',
          libWasmBuffer.byteLength,
          'bytes',
        );
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
          // Only clear the fault once a *render* is actually confirmed — a
          // WT.position message is posted from inside _renderQuantum() after
          // a full quantum has rendered without trapping. 'loaded-accepted'
          // (below) fires on the WT.loaded ack, before MT.play is even sent
          // and well before the worklet's first process() call, so clearing
          // there let a module that traps on its very first render reset
          // restartAttempts to 0 on every restart and loop forever instead of
          // ever reaching the ScriptProcessor fallback — see handleWorkletFault().
          clearAudioFault();
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
          if (result.fatal) {
            // process() caught a wasm trap and silenced output — the instance
            // is not recoverable in place; restart the node (see handleWorkletFault).
            await handleWorkletFault(refs, callbacks, config, ctx, node, 'process-trap', result.message);
          } else if (result.shouldAttemptSpFallback) {
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
            publishPcmBlock(buf, ch, ctx.sampleRate);
          }
          // Both consumers above read `buf` synchronously — safe to hand its
          // buffer straight back to the worklet's allocation pool (#PCM-alloc).
          try {
            node.port.postMessage(postReturnPcmBuffer(buf), [buf.buffer]);
          } catch { /* node torn down mid-flight — the buffer is simply GC'd */ }
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

    // Nothing sets this natively — an uncaught throw inside the processor
    // (a bug outside the process()/try-catch in openmpt-processor.ts, or a
    // browser-level worklet failure) otherwise kills the node silently while
    // the UI keeps showing "Playing". Re-applied even for a reused node: it's
    // a plain property assignment, idempotent, and cheap.
    node.onprocessorerror = (ev) => {
      const detail = ev instanceof ErrorEvent ? ev.message : String(ev);
      void handleWorkletFault(refs, callbacks, config, ctx, node, 'processor-error', detail);
    };

    // Send glue + real WASM to the worklet first (must arrive before 'load'). The wasm buffer is
    // transferred (not copied); a reused node already has libopenmpt, so nothing is re-sent.
    if (shouldPostInitLib(reuseWorkletNode, libJsText) && libJsText && libWasmBuffer) {
      node.port.postMessage(
        postInitLib(libJsText, libWasmBuffer),
        [libWasmBuffer],
      );
    }

    // Interpolation filter (default Sinc+LP; ?interp=4 opts down to cubic). Re-sent for a reused
    // node too so a changed ?interp= / localStorage value takes effect on the next load.
    node.port.postMessage(
      postSetRenderParam(
        OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH,
        resolveJsInterpolationLength(),
      ),
    );

    // Opt-in per-quantum extras. Both default to off inside the worklet, so
    // these must be re-sent for a reused node as well.
    //
    // PCM blocks stay off unless something consumes them: a Project-M
    // popup/iframe, or a pcmBus subscriber (the WebGPU compute analysis pass).
    // The bus can gain its first subscriber after playback starts, so also
    // install a demand listener that flips the stream on and off live.
    node.port.postMessage(postSetProjectmPcm(hasProjectMConsumer() || pcmBusHasSubscribers()));
    setPcmDemandListener((wanted) => {
      try {
        node.port.postMessage(postSetProjectmPcm(hasProjectMConsumer() || wanted));
      } catch {
        /* node torn down — the next start re-installs the listener */
      }
    });
    node.port.postMessage(postSetAudioDiag(isAudioDiagEnabled()));
    seedPatternDiag();

    const moduleBuf = moduleBytesFromFileData(refs.fileDataRef.current);
    if (moduleBuf) {
      console.log('[PLAY] Sending module data to worklet:', moduleBuf.byteLength, 'bytes');
      refs.lastWorkletModuleTokenSentRef.current = refs.workletModuleTokenRef.current;
      node.port.postMessage(postLoad(moduleBuf));
    } else {
      console.error("[PLAY] No buffer to send to worklet!");
    }

    console.log('[PLAY] Connecting audio graph: worklet -> master input -> analyser -> panner -> gain -> destination');
    if (!reuseWorkletNode) {
      try { node.disconnect(); } catch { /* ignore stale edges */ }
      node.connect(refs.masterInputRef.current!);
    } else {
      console.log('[PLAY] Hot reload — keeping existing worklet wiring; re-asserting master output chain');
    }
    wireMasterOutput(ctx, refs, config.volume, config.panValue);

    refs.audioWorkletNodeRef.current = node;
    // Show a loading state while the WASM finishes initialising.
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
