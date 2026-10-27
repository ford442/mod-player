/**
 * Main-thread side of the shared position ring (#492; audio-worklet/positionRing.ts).
 *
 * The UI loop calls `drain()` once per frame: every report the worklet wrote since the last frame is
 * applied exactly as a `position` message would be (`commitWorkletPositionSample`, channel VU, the
 * pending-seek ack, the paused-meters rule) — without allocating. Two preallocated samples alternate
 * as the current sample (the row-rate estimate compares each new sample with the previous one), the
 * VU is read from the reader's scratch Float32Array, and nothing is created per report.
 */
import type { ChannelShadowState } from '../types';
import { PositionRingReader } from '../audio-worklet/positionRing';
import {
  commitWorkletPositionSample,
  compensateWorkletSampleTime,
  type WorkletPositionRefs,
  type WorkletPositionSample,
} from './playheadPrediction';
import { applyChannelVu } from './workletPositionAdapter';
import { silenceChannelStates } from './transportClock';

type Ref<T> = { current: T };

export interface PositionRingRefs extends WorkletPositionRefs {
  audioWorkletNodeRef: Ref<AudioWorkletNode | null>;
  channelStatesRef: Ref<ChannelShadowState[]>;
  pendingSeekRef: Ref<{ order: number; row: number; timestamp: number } | null>;
  seekAcknowledgedRef: Ref<boolean>;
  isPausedRef: Ref<boolean>;
}

export interface PositionRingStats {
  /** Reports applied. */
  samples: number;
  /** Reports lost to a lap or to a reader more than the ring's depth behind (e.g. a hidden tab). */
  dropped: number;
}

export interface PositionRingConsumer {
  /** The node writing this ring; drain() does nothing once another node replaced it. */
  readonly node: AudioWorkletNode;
  /** Apply every report written since the last call; returns how many. */
  drain(): number;
  /** Drop what is buffered (a restart: those reports describe the previous playback). */
  resync(): void;
  stats(): PositionRingStats;
}

function createSample(): WorkletPositionSample {
  return { order: 0, row: 0, rowInt: 0, positionSeconds: 0, workletTime: 0, bpm: 0, speed: 0 };
}

export function createPositionRingConsumer(
  buffer: SharedArrayBuffer,
  node: AudioWorkletNode,
  refs: PositionRingRefs,
  /** Called once per drain that applied a report: a render was confirmed (clears an engine fault). */
  onRender: () => void,
): PositionRingConsumer {
  const reader = new PositionRingReader(buffer);
  const samples = [createSample(), createSample()];
  let flip = 0;
  let applied = 0;

  return {
    node,
    drain(): number {
      if (refs.audioWorkletNodeRef.current !== node) return 0;
      let count = 0;
      while (reader.next()) {
        const r = reader.sample;
        // Alternate, so the sample being written is never the one the estimate compares against.
        let target = samples[flip]!;
        if (target === refs.workletPositionSampleRef.current) {
          flip ^= 1;
          target = samples[flip]!;
        }
        flip ^= 1;
        target.order = r.order;
        target.rowInt = Math.floor(r.row);
        target.row = Number.isFinite(r.rowFraction) ? r.rowFraction : r.row;
        target.positionSeconds = r.positionSeconds;
        target.workletTime = compensateWorkletSampleTime(r.audioTime, r.samplesWritten, r.sampleRate);
        target.bpm = r.bpm > 0 ? r.bpm : refs.workletBpmRef.current;
        target.speed = r.speed > 0 ? r.speed : refs.workletSpeedRef.current;
        commitWorkletPositionSample(refs, target);
        applyChannelVu(refs.channelStatesRef.current, reader.vu, r.numVu);

        const pending = refs.pendingSeekRef.current;
        if (pending && target.order === pending.order && target.rowInt === pending.row) {
          refs.seekAcknowledgedRef.current = true;
          refs.pendingSeekRef.current = null;
        }
        count++;
      }
      if (count > 0) {
        applied += count;
        // A report already in flight when a pause landed carries VU: keep the meters dark.
        if (refs.isPausedRef.current) silenceChannelStates(refs.channelStatesRef.current);
        onRender();
      }
      return count;
    },
    resync(): void {
      reader.resync();
    },
    stats(): PositionRingStats {
      return { samples: applied, dropped: reader.dropped };
    },
  };
}
