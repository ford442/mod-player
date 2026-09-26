/**
 * #ended-repeats: audio_process_cb re-stamps the "ended" sentinel
 * (currentRow = -1) and g_positionReady on *every* subsequent quantum once
 * the module has finished rendering — not just the first one — so polling it
 * without an edge-trigger fires 'ended' again on every ~16 ms tick forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenMPTWorkletEngine } from '../audio-worklet/OpenMPTWorkletEngine';
import { encodePositionInfoFixture } from '../audio-worklet/positionInfoLayout';
import type { EmscriptenOpenMPTModule } from '../audio-worklet/types';

const PTR = 8; // poll_position() never returns 0 for "data ready" — 0 means "nothing new"

function endedFixtureBuffer(): Uint8Array {
  const raw = new Uint8Array(encodePositionInfoFixture({
    positionMs: 0,
    currentRow: -1, // the "ended" sentinel
    currentPattern: 0,
    currentOrder: 0,
    bpm: 125,
    numChannels: 2,
  }));
  const padded = new Uint8Array(PTR + raw.byteLength);
  padded.set(raw, PTR);
  return padded;
}

function makeEndedEngine(): OpenMPTWorkletEngine {
  const engine = new OpenMPTWorkletEngine();
  const fakeModule = {
    HEAPU8: endedFixtureBuffer(),
    // Every poll returns fresh "ready" data, exactly like the real audio
    // thread re-stamping g_positionReady on every post-ended quantum.
    _poll_position: () => PTR,
  } as unknown as EmscriptenOpenMPTModule;
  (engine as unknown as { module: EmscriptenOpenMPTModule | null }).module = fakeModule;
  return engine;
}

describe('OpenMPTWorkletEngine "ended" edge-trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits "ended" exactly once across many poll ticks of the same sentinel', () => {
    const engine = makeEndedEngine();
    let endedCount = 0;
    engine.on('ended', () => { endedCount++; });

    (engine as unknown as { startPolling: () => void }).startPolling();

    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(16);
    }

    expect(endedCount).toBe(1);
  });
});
