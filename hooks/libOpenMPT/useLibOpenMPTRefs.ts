import { useMemo } from 'react';
import type { ChannelShadowState, PlaybackState } from '../../types';
import type { Ref } from '../../audio/engine/store';
import { usePlayerEngineInstance } from '../usePlayerEngine';

/** The engine-owned, high-rate state React components read in render loops (never in the snapshot). */
export interface LibOpenMPTReactRefs {
  /** Playhead / beat state, rewritten every UI frame; the GPU renderers read it per frame. */
  playbackStateRef: Ref<PlaybackState>;
  /** Live per-channel VU / note state, mutated in place by the position handlers (pitfall 9). */
  channelStatesRef: Ref<ChannelShadowState[]>;
  oscBufferRef: Ref<Float32Array | null>;
  audioReactiveRef: Ref<Float32Array | null>;
}

/**
 * All that is left of the ~63 refs this hook used to create (#492): the engine owns its state now,
 * and React only needs stable handles to the four high-rate buffers above.
 */
export function useLibOpenMPTRefs(): LibOpenMPTReactRefs {
  const engine = usePlayerEngineInstance();
  return useMemo(
    () => ({
      playbackStateRef: engine.playbackStateRef,
      channelStatesRef: engine.channelStatesRef,
      oscBufferRef: engine.oscBufferRef,
      audioReactiveRef: engine.audioReactiveRef,
    }),
    [engine],
  );
}
