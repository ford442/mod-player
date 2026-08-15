import { applyWorkletPositionSample } from '../../utils/playheadPrediction';
import { postPause } from '../../audio-worklet/protocol';
import { wireMasterOutput } from './masterGraph';
import type { AudioGraphCallbacks, AudioGraphConfig, AudioGraphRefs } from './types';

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
}
