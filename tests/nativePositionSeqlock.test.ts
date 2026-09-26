/**
 * #position-torn-read: PositionInfo's bytes are read directly out of live
 * WASM memory (not through a function call that could hand back a consistent
 * snapshot), and the audio thread can write a fresh update between any two of
 * those field reads. cpp/worklet_processor.cpp's g_positionSeq is a seqlock
 * over that struct; OpenMPTWorkletEngine.pollPositionOnce() must check it
 * before and after decoding and retry when a write raced the read.
 */
import { describe, expect, it, vi } from 'vitest';
import { OpenMPTWorkletEngine } from '../audio-worklet/OpenMPTWorkletEngine';
import { encodePositionInfoFixture } from '../audio-worklet/positionInfoLayout';
import type { EmscriptenOpenMPTModule } from '../audio-worklet/types';

// poll_position() returns 0 (falsy) to mean "no new data" — a real pointer is
// never 0, so pad the fixture and use a non-zero offset, matching how a real
// heap allocation would never land at address 0 either.
const PTR = 8;
const RAW_FIXTURE = encodePositionInfoFixture({
  positionMs: 1000,
  currentRow: 5,
  currentPattern: 0,
  currentOrder: 2,
  bpm: 125,
  numChannels: 4,
  channelVU: [0.1, 0.2, 0.3, 0.4],
  audioFramesRendered: 48000,
  rowFraction: 5.5,
  speed: 6,
  sampleRate: 48000,
});
const FIXTURE = new Uint8Array(PTR + RAW_FIXTURE.byteLength);
FIXTURE.set(new Uint8Array(RAW_FIXTURE), PTR);

function makeEngineWithFakeModule(overrides: Partial<EmscriptenOpenMPTModule>): OpenMPTWorkletEngine {
  const engine = new OpenMPTWorkletEngine();
  const fakeModule = {
    HEAPU8: FIXTURE,
    _poll_position: () => PTR,
    ...overrides,
  } as unknown as EmscriptenOpenMPTModule;
  (engine as unknown as { module: EmscriptenOpenMPTModule | null }).module = fakeModule;
  return engine;
}

describe('OpenMPTWorkletEngine position seqlock retry', () => {
  it('decodes immediately when the seq is stable (even, unchanged) across the read', () => {
    const seq = vi.fn(() => 4);
    const engine = makeEngineWithFakeModule({ _get_position_seq: seq });

    const data = engine.getPosition();
    expect(data?.currentRow).toBe(5);
    expect(data?.currentOrder).toBe(2);
    // Exactly one before/after pair — no wasted retries when nothing raced it.
    expect(seq).toHaveBeenCalledTimes(2);
  });

  it('retries without decoding while the seq is odd (a write is in progress)', () => {
    const calls: number[] = [3, 3, 4, 4]; // odd, odd -> retry; then stable even pair
    let i = 0;
    const seq = vi.fn(() => calls[i++] ?? 4);
    const engine = makeEngineWithFakeModule({ _get_position_seq: seq });

    const data = engine.getPosition();
    expect(data?.currentRow).toBe(5);
  });

  it('retries when the seq changes between the before- and after-read (a write raced the decode)', () => {
    const calls = [2, 6, 6, 6]; // first attempt: before=2, after=6 (raced) -> retry; second: 6/6 stable
    let i = 0;
    const seq = vi.fn(() => calls[i++] ?? 6);
    const engine = makeEngineWithFakeModule({ _get_position_seq: seq });

    const data = engine.getPosition();
    expect(data?.currentRow).toBe(5);
    expect(seq).toHaveBeenCalledTimes(4);
  });

  it('falls back to a best-effort decode rather than returning null forever if it never stabilizes', () => {
    const seq = vi.fn(() => 1); // permanently odd — pathological, should not happen in practice
    const engine = makeEngineWithFakeModule({ _get_position_seq: seq });

    const data = engine.getPosition();
    // Still returns *something* usable instead of starving the UI of position
    // updates entirely.
    expect(data?.currentRow).toBe(5);
  });

  it('older native builds without _get_position_seq fall back to a single best-effort read', () => {
    const engine = makeEngineWithFakeModule({});
    const data = engine.getPosition();
    expect(data?.currentRow).toBe(5);
  });
});
