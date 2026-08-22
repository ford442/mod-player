import { withBase } from '../../src/lib/paths';
import { NATIVE_RING_BUF_FRAMES } from '../../audio-worklet/OpenMPTWorkletEngine';
import type { PatternMatrix } from '../../types';
import type { NativePcmChunk, WorkletPositionData } from '../../audio-worklet/types';
import { getAudioHeardTime } from '../../utils/playheadPrediction';
import {
  applyNormalizedPosition,
  nativePositionToInput,
} from '../../utils/workletPositionAdapter';
import {
  createNativeClockAnchor,
  NATIVE_BRIDGE_LATENCY_MEDIASTREAM_SEC,
  NATIVE_BRIDGE_LATENCY_RING_SEC,
} from '../../utils/nativeClockAnchor';
import { isNativeLegacyAudioContext } from '../../utils/audioEngineSelection';
import { broadcastPcmBlock } from '../../utils/projectMBridge';
import { publishPcmBlock } from '../../utils/pcmBus';
import { workletPatternToMatrix } from '../../audio-worklet/NativePatternReader';
import { moduleBytesFromFileData, wireMasterOutput } from './masterGraph';
import type { AudioGraphCallbacks, AudioGraphConfig, AudioGraphRefs } from './types';

export type NativePlaybackResult = 'started' | 'fallback-to-js';

/**
 * Start native C++/Wasm AudioWorklet on the shared main AudioContext.
 * Default: C++ node → analyser → panner → gain → destination.
 * Legacy (`?nativeCtx=legacy`): C++ owns a second context + MediaStream/ring bridge.
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
    const legacy = isNativeLegacyAudioContext();

    await engine.attachAudioContext(ctx, { legacy });

    const buf = moduleBytesFromFileData(refs.fileDataRef.current);
    if (buf) {
      console.log('[PLAY] Sending module data to native engine:', buf.byteLength, 'bytes');
      await engine.load(buf);
    }

    engine.setVolume(config.volume);
    engine.setLoop(config.isLooping);

    engine.removeAllListeners();

    let bridgeEstablished = false;
    let bridgeLatencySec = 0;

    if (legacy) {
      bridgeLatencySec = NATIVE_BRIDGE_LATENCY_MEDIASTREAM_SEC;
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
          refs.audioWorkletNodeRef.current = bridgeNode;
          bridgeEstablished = true;
          bridgeLatencySec = NATIVE_BRIDGE_LATENCY_RING_SEC;
          console.log('[PLAY] Native engine: legacy ring-buffer bridge active');
        } catch (ringErr) {
          console.warn('[PLAY] Legacy ring-buffer bridge failed, trying MediaStream:', ringErr);
        }
      }
      if (!bridgeEstablished) {
        try {
          const mediaSrc = await engine.bridgeToAudioGraph(ctx, refs.analyserRef.current!);
          if (mediaSrc) {
            wireMasterOutput(ctx, refs, config.volume, config.panValue);
            bridgeEstablished = true;
            console.log('[PLAY] Native engine: legacy MediaStream bridge active');
          }
        } catch (msErr) {
          console.warn('[PLAY] MediaStream bridge failed:', msErr);
        }
      }
    } else {
      const cppNode = await engine.getOutputNode(3000);
      if (!cppNode) {
        throw new Error('Native AudioWorkletNode not available');
      }
      try { cppNode.disconnect(); } catch { /* not yet connected */ }
      cppNode.connect(refs.analyserRef.current!);
      wireMasterOutput(ctx, refs, config.volume, config.panValue);
      refs.audioWorkletNodeRef.current = cppNode;
      bridgeEstablished = true;
      bridgeLatencySec = 0;
      console.log('[PLAY] Native engine: C++ node on shared AudioContext');
    }

    if (!bridgeEstablished) {
      console.warn('[PLAY] Native engine audio not routed through main graph');
    }

    refs.nativeBridgeLatencyRef.current = bridgeLatencySec;
    refs.nativeClockAnchorRef.current = createNativeClockAnchor(ctx, bridgeLatencySec);

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
