import type { PatternMatrix, PatternCell } from '../../types';
import { NATIVE_RING_BUF_FRAMES } from '../../audio-worklet/OpenMPTWorkletEngine';
import type { WorkletPositionData } from '../../audio-worklet/types';
import { withBase } from '../../src/lib/paths';
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
import { moduleBytesFromFileData, wireMasterOutput } from './masterGraph';
import type { AudioGraphCallbacks, AudioGraphConfig, AudioGraphRefs } from './types';

export type NativePlaybackResult = 'started' | 'fallback-to-js';

/**
 * Start native C++/Wasm AudioWorklet engine and bridge its output into the
 * main-thread master graph. On failure returns 'fallback-to-js'.
 */
export async function startNativePlayback(
  refs: AudioGraphRefs,
  callbacks: AudioGraphCallbacks,
  config: AudioGraphConfig,
  ctx: AudioContext,
): Promise<NativePlaybackResult> {
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
    let bridgeLatencySec = NATIVE_BRIDGE_LATENCY_MEDIASTREAM_SEC;

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
        bridgeLatencySec = NATIVE_BRIDGE_LATENCY_RING_SEC;
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

    refs.nativeBridgeLatencyRef.current = bridgeLatencySec;
    refs.nativeClockAnchorRef.current = createNativeClockAnchor(ctx, bridgeLatencySec);

    // Shared-memory PositionInfo is refreshed every quantum (pre-render
    // snapshot + frame clock). Both engines use applyNormalizedPosition.
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
    return 'started';
  } catch (e) {
    console.error("[PLAY] Failed to start native engine:", e);
    console.warn("[PLAY] Falling back to JS AudioWorklet engine");
    callbacks.setActiveEngine('worklet');
    return 'fallback-to-js';
  }
}
