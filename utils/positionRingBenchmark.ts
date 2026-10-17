/**
 * Drives the two position paths in a tight loop, for allocation measurement (#492): the Playwright
 * audio smoke runs it under the CDP sampling heap profiler in the real browser, and
 * tests/positionRingAlloc.test.ts under V8's new-space counter. Loaded on demand by the test hooks,
 * so it never ships in the main chunk.
 *
 *   ring:    what the worklet writes (PositionRingWriter) → the consumer the UI loop drains.
 *   message: a `position` message as the worklet posts it → structured clone (what postMessage does)
 *            → zod validation → dispatchWorkletToMainMessage. The pre-#492 path, for comparison.
 */
import type { ChannelShadowState, PatternMatrix } from '../types';
import {
  F_AUDIO_TIME,
  F_BPM,
  F_NUM_VU,
  F_ORDER,
  F_POSITION_SECONDS,
  F_ROW,
  F_ROW_FRACTION,
  F_SAMPLE_RATE,
  F_SAMPLES_WRITTEN,
  F_SPEED,
  createPositionRingBuffer,
} from '../audio-worklet/positionRing';
import { PositionRingWriter } from '../audio-worklet/positionRingWriter';
import { WORKLET_TO_MAIN } from '../audio-worklet/workletProtocolConstants';
import { parseWorkletToMainMessage } from '../audio-worklet/protocol';
import { dispatchWorkletToMainMessage } from '../audio-worklet/jsWorkletDispatch';
import { createPositionRingConsumer } from './positionRingConsumer';
import { createEngineRefs } from '../audio/engine/engineRefs';

const CHANNELS = 32;

/** The engine's real refs bag (its object shapes are what V8 allocates — or not — against). */
function benchRefs(node: AudioWorkletNode) {
  const refs = createEngineRefs({
    transport: { isPlaying: true, isPaused: false },
    activeEngine: () => 'worklet',
  });
  refs.audioWorkletNodeRef.current = node;
  refs.channelStatesRef.current = Array.from({ length: CHANNELS }, (): ChannelShadowState => ({
    volume: 0, pan: 128, freq: 0, trigger: 0, noteAge: 0, activeEffect: 0, effectValue: 0, isMuted: 0,
  }));
  refs.patternMatricesRef.current = [{ numRows: 64 } as PatternMatrix];
  refs.workletModuleTokenRef.current = 1;
  refs.lastWorkletModuleTokenSentRef.current = 1;
  return refs;
}

export interface PositionPathBench {
  /** Run `count` reports through the path. */
  run(count: number): void;
  /** Reports applied so far (sanity: the loop did real work). */
  applied(): number;
}

/** The shared-ring path, set up once; `run` writes and drains `count` reports. */
export function createRingBench(): PositionPathBench {
  const node = {} as AudioWorkletNode;
  const refs = benchRefs(node);
  const buffer = createPositionRingBuffer();
  const writer = new PositionRingWriter(buffer);
  const consumer = createPositionRingConsumer(buffer, node, refs, () => {});
  let tick = 0;
  return {
    run(count: number): void {
      const f = writer.fields;
      const vu = writer.vu;
      for (let i = 0; i < count; i++) {
        tick++;
        const row = tick % 64;
        writer.begin();
        const o = writer.fieldOffset;
        f[o + F_ORDER] = 0;
        f[o + F_ROW] = row;
        f[o + F_ROW_FRACTION] = row + 0.25;
        f[o + F_POSITION_SECONDS] = tick / 60;
        f[o + F_BPM] = 125;
        f[o + F_SPEED] = 6;
        f[o + F_AUDIO_TIME] = tick / 60;
        f[o + F_SAMPLES_WRITTEN] = 128;
        f[o + F_SAMPLE_RATE] = 48000;
        f[o + F_NUM_VU] = CHANNELS;
        const vo = writer.vuOffset;
        for (let c = 0; c < CHANNELS; c++) vu[vo + c] = ((tick + c) % 10) / 10;
        writer.commit();
        consumer.drain();
      }
    },
    applied: () => consumer.stats().samples,
  };
}

/** The `position` message path, for comparison. */
export function createMessageBench(): PositionPathBench {
  const refs = benchRefs({} as AudioWorkletNode);
  const channelVU = new Array<number>(CHANNELS).fill(0.5);
  let tick = 0;
  let applied = 0;
  return {
    run(count: number): void {
      for (let i = 0; i < count; i++) {
        tick++;
        const row = tick % 64;
        const posted = {
          type: WORKLET_TO_MAIN.position, order: 0, row, rowFraction: row + 0.25,
          positionSeconds: tick / 60, bpm: 125, speed: 6, audioTime: tick / 60, workletTime: tick / 60,
          samplesWritten: 128, sampleRate: 48000, channelVU,
        };
        const parsed = parseWorkletToMainMessage(structuredClone(posted));
        if (!parsed.ok) throw new Error(parsed.error);
        dispatchWorkletToMainMessage({ refs, message: parsed.message, audioContextCurrentTime: tick / 60 });
        applied++;
      }
    },
    applied: () => applied,
  };
}
