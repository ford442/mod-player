import type { LibOpenMPT } from '../../types';
import { applyWorkletPositionSample, type WorkletPositionInput } from '../../utils/playheadPrediction';
import { postPause } from '../../audio-worklet/protocol';
import { OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH } from '../../utils/openmptRenderParams';
import { resolveJsInterpolationLength } from '../../utils/jsInterpolation';
import { mallocOrThrow } from '../../utils/wasmHeap';
import { wireMasterOutput } from './masterGraph';
import type { AudioGraphCallbacks, AudioGraphConfig, AudioGraphRefs } from './types';

/** Where the module is before a block renders, tagged with the time that block starts playing. */
function snapshotPosition(lib: LibOpenMPT, modPtr: number, blockTime: number): WorkletPositionInput {
  return {
    order: lib._openmpt_module_get_current_order(modPtr),
    row: lib._openmpt_module_get_current_row(modPtr),
    positionSeconds: lib._openmpt_module_get_position_seconds(modPtr),
    workletTime: blockTime,
    bpm: lib._openmpt_module_get_current_estimated_bpm(modPtr),
    speed: lib._openmpt_module_get_current_speed(modPtr),
  };
}

/**
 * Tear down a failed JS worklet node and start ScriptProcessorNode fallback
 * using the main-thread libopenmpt module.
 */
export async function runScriptProcessorFallback(
  refs: AudioGraphRefs,
  callbacks: AudioGraphCallbacks,
  config: Pick<AudioGraphConfig, 'volume' | 'panValue' | 'isLooping'>,
  ctx: AudioContext,
  node: AudioWorkletNode,
): Promise<void> {
  refs.spFallbackTriggered.current = true;
  // Claim playback for the fallback right away, before the awaits below: in PlayerEngine
  // `spFallbackTriggered` is a view of this, and it guards against a second fallback meanwhile.
  // It stays claimed if the fallback cannot start (no module) — like the guard always did — until stop.
  refs.playbackEngineRef.current = 'scriptprocessor';
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
    let leftPtr: number;
    let rightPtr: number;
    try {
      // Reuse buffers a previous fallback start left (stopMusic frees them).
      leftPtr = refs.spLeftBufPtr.current || mallocOrThrow(lib, 4 * SP_BUFFER, 'ScriptProcessor buffer');
      refs.spLeftBufPtr.current = leftPtr;
      rightPtr = refs.spRightBufPtr.current || mallocOrThrow(lib, 4 * SP_BUFFER, 'ScriptProcessor buffer');
      refs.spRightBufPtr.current = rightPtr;
    } catch (err) {
      console.error('[PLAY] ScriptProcessor fallback could not allocate its buffers:', err);
      callbacks.setStatus('Error: out of memory for the ScriptProcessor fallback');
      callbacks.setIsPlaying(false);
      return;
    }
    const spNode = ctx.createScriptProcessor(SP_BUFFER, 0, 2);
    // The same filter the worklet renders with (?interp= / localStorage, default Sinc+LP), so the
    // fallback does not change the sound.
    lib._openmpt_module_set_render_param(
      modPtr,
      OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH,
      resolveJsInterpolationLength(),
    );

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
      // Paused: render silence without advancing the module, so resume continues from the same
      // row. Pause latency here is one SPN buffer (4096 frames), unlike the worklet's one quantum.
      if (refs.isPausedRef.current) { outL.fill(0); outR.fill(0); return; }

      // Position is sampled BEFORE rendering, like the worklet's pre-render snapshot: it is where
      // this block starts, and the block starts playing at `playbackTime`. Sampled after the
      // render it described the block's end (4096 frames, ~85 ms later), so the playhead led the
      // audio by a whole buffer.
      // The worklet tags its snapshot with `currentTime` inside process(), i.e. the time the quantum
      // it is about to render plays; a ScriptProcessor block plays at `playbackTime`, not now.
      const playbackTime = audioEvt.playbackTime;
      const blockTime = Number.isFinite(playbackTime) && playbackTime > 0 ? playbackTime : ctx.currentTime;
      let snapshot = snapshotPosition(mLib, mPtr, blockTime);
      let written = mLib._openmpt_module_read_float_stereo(
        mPtr, ctx.sampleRate, SP_BUFFER, leftPtr, rightPtr
      );
      if (written === 0 && config.isLooping) {
        mLib._openmpt_module_set_position_order_row(mPtr, 0, 0);
        snapshot = snapshotPosition(mLib, mPtr, blockTime);
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

      applyWorkletPositionSample(refs, snapshot);
    };

    spNode.connect(refs.masterInputRef.current!);
    wireMasterOutput(ctx, refs, config.volume, config.panValue);
    refs.scriptProcessorRef.current = spNode;

    if (refs.isPausedRef.current) {
      // Started (e.g. after a worklet fault) while paused: the callback above already renders silence.
      callbacks.setStatus("Paused.");
    } else {
      // Reported, not written: isPlayingRef is a view of the transport FSM (pitfall 17).
      callbacks.setIsPlaying(true);
      callbacks.setStatus("Playing (ScriptProcessor fallback)...");
    }
    if (refs.animationFrameHandle.current) cancelAnimationFrame(refs.animationFrameHandle.current);
    refs.animationFrameHandle.current = requestAnimationFrame(refs.updateUIRef.current!);
  } else {
    callbacks.setStatus("Error: no module loaded for ScriptProcessor fallback");
  }
}
