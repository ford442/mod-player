import type { NativePcmChunk, WorkletPositionData } from '../../audio-worklet/types';
import type { PatternMatrix } from '../../types';
import { getAudioHeardTime } from '../../utils/playheadPrediction';
import {
  applyNormalizedPosition,
  nativePositionToInput,
} from '../../utils/workletPositionAdapter';
import { createNativeClockAnchor } from '../../utils/nativeClockAnchor';
import { broadcastPcmBlock } from '../../utils/projectMBridge';
import { publishPcmBlock } from '../../utils/pcmBus';
import { workletPatternToMatrix } from '../../audio-worklet/NativePatternReader';
import { moduleBytesFromFileData, wireMasterOutput } from './masterGraph';
import type { AudioGraphCallbacks, AudioGraphConfig, AudioGraphRefs } from './types';

export type NativePlaybackResult = 'started' | 'fallback-to-js';

/**
 * Start native C++/Wasm AudioWorklet on the shared main AudioContext.
 * C++ node → analyser → panner → gain → destination.
 */
export async function startNativePlayback(
  refs: AudioGraphRefs,
  callbacks: AudioGraphCallbacks,
  config: AudioGraphConfig,
  ctx: AudioContext,
): Promise<NativePlaybackResult> {
  console.log('[PLAY] Using native C++/Wasm AudioWorklet engine...');
  try {
    const engine = refs.nativeEngineRef.current!;

    await engine.attachAudioContext(ctx);

    const buf = moduleBytesFromFileData(refs.fileDataRef.current);
    if (buf) {
      console.log('[PLAY] Sending module data to native engine:', buf.byteLength, 'bytes');
      await engine.load(buf);
    }

    engine.setVolume(config.volume);
    engine.setLoop(config.isLooping);

    engine.removeAllListeners();

    const cppNode = await engine.getOutputNode(3000);
    if (!cppNode) {
      throw new Error('Native AudioWorkletNode not available');
    }
    try { cppNode.disconnect(); } catch { /* not yet connected */ }
    cppNode.connect(refs.analyserRef.current!);
    wireMasterOutput(ctx, refs, config.volume, config.panValue);
    refs.audioWorkletNodeRef.current = cppNode;
    console.log('[PLAY] Native engine: C++ node on shared AudioContext');

    refs.nativeBridgeLatencyRef.current = 0;
    refs.nativeClockAnchorRef.current = createNativeClockAnchor(ctx, 0);

    engine.on('position', (data: WorkletPositionData) => {
      const heardFallback = getAudioHeardTime(ctx);
      const input = nativePositionToInput(data, heardFallback, {
        clockAnchor: refs.nativeClockAnchorRef.current,
        fallbackHeardTime: heardFallback,
      });
      const applied = applyNormalizedPosition(refs, input, {
        channelStates: refs.channelStatesRef.current,
        channelVU: data.channelVU,
        numChannels: data.numChannels,
      });

      if (refs.pendingSeekRef.current &&
          applied.order === refs.pendingSeekRef.current.order &&
          applied.rowInt === refs.pendingSeekRef.current.row) {
        refs.seekAcknowledgedRef.current = true;
        refs.pendingSeekRef.current = null;
      }

      if (data.patternData) {
        const matrix: PatternMatrix = workletPatternToMatrix(data.patternData, applied.order);
        refs.patternMatricesRef.current[applied.order] = matrix;
        callbacks.setSequencerMatrix(matrix);
      }
    });

    engine.on('pcm', (chunk: NativePcmChunk) => {
      if (chunk.buffer instanceof Float32Array && (chunk.channels === 1 || chunk.channels === 2)) {
        broadcastPcmBlock(chunk.buffer, chunk.channels);
        publishPcmBlock(chunk.buffer, chunk.channels, chunk.sampleRate);
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

    engine.play();
    console.log('[PLAY] Native C++/Wasm AudioWorklet engine started');

    refs.isPlayingRef.current = true;
    callbacks.setIsPlaying(true);
    callbacks.setStatus('Playing...');
    refs.animationFrameHandle.current = requestAnimationFrame(refs.updateUIRef.current!);
    return 'started';
  } catch (e) {
    console.error('[PLAY] Failed to start native engine:', e);
    console.warn('[PLAY] Falling back to JS AudioWorklet engine');
    callbacks.setActiveEngine('worklet');
    return 'fallback-to-js';
  }
}
