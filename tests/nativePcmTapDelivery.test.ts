/**
 * #pcm-tap-drops: OpenMPTWorkletEngine.copyPcmChunk() used to grab only the
 * newest NATIVE_PCM_CHUNK_FRAMES (128) stereo frames from the C++ ring on
 * every ~16 ms poll tick, while the audio thread writes a full quantum
 * (MAX_QUANTUM, 128 frames) roughly every ~2.7-2.9 ms — about 5-6 quanta per
 * tick. Reading a fixed 128-frame window silently dropped the rest.
 *
 * This drives the real copyPcmChunk() against a fake WASM heap standing in
 * for the ring buffer (no real wasm build needed — the ring's byte layout is
 * plain, documented linear memory), simulating the audio thread writing
 * quanta between polls, and checks that delivery keeps up with rendering.
 */
import { describe, expect, it } from 'vitest';
import { OpenMPTWorkletEngine, NATIVE_RING_BUF_FRAMES } from '../audio-worklet/OpenMPTWorkletEngine';
import type { EmscriptenOpenMPTModule } from '../audio-worklet/types';

const QUANTUM_FRAMES = 128;
const RING_BASE_OFFSET = 64; // arbitrary non-zero byte offset, like a real heap allocation

/** A fake WASM heap holding just the ring buffer the C++ side would allocate. */
function makeFakeRing(capacityFrames: number) {
  const byteSize = RING_BASE_OFFSET + 8 + capacityFrames * 2 * 4;
  const heapBuf = new ArrayBuffer(byteSize);
  const HEAPF32 = new Float32Array(heapBuf);
  const f32Index = (RING_BASE_OFFSET + 8) / 4;
  let writeHead = 0;
  let nextSample = 1;

  /** Simulate audio_process_cb writing one MAX_QUANTUM-frame block. */
  function writeQuantum(): void {
    for (let i = 0; i < QUANTUM_FRAMES; i++) {
      const pos = (writeHead + i) % capacityFrames;
      // Monotonically increasing markers so dropped-frame gaps are detectable.
      HEAPF32[f32Index + pos * 2] = nextSample;
      HEAPF32[f32Index + pos * 2 + 1] = -nextSample;
      nextSample++;
    }
    writeHead = (writeHead + QUANTUM_FRAMES) % capacityFrames;
  }

  return { HEAPF32, writeQuantum, getWriteHead: () => writeHead };
}

function makeEngineWithFakeRing(capacityFrames: number) {
  const engine = new OpenMPTWorkletEngine();
  const ring = makeFakeRing(capacityFrames);
  const fakeModule = {
    HEAPF32: ring.HEAPF32,
    _get_ring_write_head: () => ring.getWriteHead(),
  } as unknown as EmscriptenOpenMPTModule;

  // Reach past private fields the same way other tests in this suite avoid
  // driving the full init()/attachAudioContext() (real dynamic wasm import).
  const internals = engine as unknown as { module: EmscriptenOpenMPTModule | null; ringBufPtr: number };
  internals.module = fakeModule;
  internals.ringBufPtr = RING_BASE_OFFSET;

  return { engine, ring };
}

describe('native PCM tap frame delivery (copyPcmChunk)', () => {
  it('delivers at least 95% of rendered frames across many poll ticks', () => {
    const { engine, ring } = makeEngineWithFakeRing(NATIVE_RING_BUF_FRAMES);
    engine.setPcmCapture(true);

    // First call after enabling capture syncs to "now" without emitting.
    expect(engine.copyPcmChunk()).toBeNull();

    const TICKS = 500;
    const QUANTA_PER_TICK = 6; // ~16 ms / ~2.7 ms — matches the real audio-thread cadence
    let rendered = 0;
    let delivered = 0;

    for (let tick = 0; tick < TICKS; tick++) {
      for (let q = 0; q < QUANTA_PER_TICK; q++) {
        ring.writeQuantum();
        rendered += QUANTUM_FRAMES;
      }
      const chunk = engine.copyPcmChunk();
      if (chunk) delivered += chunk.samplesPerChannel;
    }

    expect(delivered / rendered).toBeGreaterThanOrEqual(0.95);
  });

  it('never re-delivers or skips a frame while the ring has not wrapped (contiguous markers)', () => {
    const { engine, ring } = makeEngineWithFakeRing(NATIVE_RING_BUF_FRAMES);
    engine.setPcmCapture(true);
    expect(engine.copyPcmChunk()).toBeNull();

    ring.writeQuantum();
    ring.writeQuantum();
    ring.writeQuantum();
    const chunk = engine.copyPcmChunk();
    expect(chunk).not.toBeNull();
    expect(chunk!.samplesPerChannel).toBe(QUANTUM_FRAMES * 3);

    // The L-channel markers are the monotonically increasing sequence written
    // by writeQuantum() — contiguous, no gaps, no repeats.
    const buf = chunk!.buffer;
    const first = buf[0]!;
    for (let i = 0; i < chunk!.samplesPerChannel; i++) {
      expect(buf[i * 2]).toBe(first + i);
    }
  });

  it('resyncs instead of reading stale/overwritten frames when the writer laps the reader', () => {
    const cap = 250; // small, non-multiple-of-128 ring so a lap doesn't land writeHead back on 0
    const { engine, ring } = makeEngineWithFakeRing(cap);
    engine.setPcmCapture(true);
    expect(engine.copyPcmChunk()).toBeNull();

    // Write far more than the ring holds without polling in between.
    for (let i = 0; i < 10; i++) ring.writeQuantum(); // 1280 frames into a 256-frame ring

    const chunk = engine.copyPcmChunk();
    expect(chunk).not.toBeNull();
    // Never more than the ring can actually hold.
    expect(chunk!.samplesPerChannel).toBeLessThanOrEqual(cap - 1);
    // What it does return is genuinely the newest data (still monotonic), not
    // garbage from reading a bogus range.
    const buf = chunk!.buffer;
    for (let i = 1; i < chunk!.samplesPerChannel; i++) {
      expect(buf[i * 2]!).toBeGreaterThan(buf[(i - 1) * 2]!);
    }
  });
});
