/**
 * Zero-allocation check for the compiled character-stage worklet (#453).
 *
 * Kept in its own file on purpose: it must be the only load of the bundle in
 * this isolate. Re-evaluating the same source (as tests/fxCharacterWorklet.test.ts
 * does, once per case) shares compiled code across copies whose classes have
 * different maps, so property access turns megamorphic and double stores box —
 * an artefact a real AudioWorkletGlobalScope, which loads the module once,
 * never sees. Vitest runs each test file in its own isolate.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';
import { afterAll, expect, it } from 'vitest';
import { CHARACTER_PARAM_DESCRIPTORS, characterParamArray } from '../audio-worklet/fxCharacterParams';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scopeGlobals = globalThis as unknown as { currentTime?: number; sampleRate?: number };

afterAll(() => {
  delete scopeGlobals.currentTime;
  delete scopeGlobals.sampleRate;
});

it('process() does not allocate after warm-up, even while params change every quantum', () => {
  type Proc = { process(i: Float32Array[][], o: Float32Array[][], p: Record<string, Float32Array>): boolean };
  class AudioWorkletProcessor {
    port = { onmessage: null, postMessage: () => {} };
  }
  scopeGlobals.sampleRate = 48000;
  scopeGlobals.currentTime = 0;
  let Processor: (new () => Proc) | undefined;
  const source = readFileSync(join(ROOT, 'public/worklets/fx-character-worklet.js'), 'utf8');
  new Function('AudioWorkletProcessor', 'registerProcessor', source)(
    AudioWorkletProcessor,
    (_name: string, ctor: new () => Proc) => {
      Processor = ctor;
    },
  );
  const proc = new Processor!();

  const packed = characterParamArray({
    tapeOn: 1, drive: 0.7, bias: 0.2, ledOn: 1, ledModel: 0, crushOn: 1, crushRate: 9000, crushBits: 7, outputGain: -3,
  });
  const params: Record<string, Float32Array> = {};
  CHARACTER_PARAM_DESCRIPTORS.forEach((d, i) => {
    params[d.name] = new Float32Array([packed[i]!]);
  });
  const noise = (seed: number) => {
    const out = new Float32Array(128);
    let s = seed;
    for (let i = 0; i < 128; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      out[i] = (s / 0xffffffff - 0.5) * 1.2;
    }
    return out;
  };
  const inputs = [[noise(21), noise(22)]];
  const outputs = [[new Float32Array(128), new Float32Array(128)]];
  const drive = params.drive!;
  const bits = params.crushBits!;
  // Drive glides (smoother + curve recompute) and the crusher reconfigures every quantum.
  function run(count: number): void {
    for (let i = 0; i < count; i++) {
      drive[0] = (i % 64) / 64;
      bits[0] = 4 + (i % 8);
      proc.process(inputs, outputs, params);
    }
  }
  function idle(count: number): void {
    for (let i = 0; i < count; i++) {
      drive[0] = (i % 64) / 64;
      bits[0] = 4 + (i % 8);
    }
  }
  // Warm up until TurboFan has both loops and everything they inline.
  for (let r = 0; r < 40; r++) {
    run(200);
    idle(200);
  }

  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  const newSpaceUsed = () =>
    v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;

  const QUANTA = 20_000;
  gc();
  let before = newSpaceUsed();
  idle(QUANTA);
  const baseline = newSpaceUsed() - before;
  gc();
  before = newSpaceUsed();
  run(QUANTA);
  const grown = newSpaceUsed() - before;
  // One boxed double per quantum would already be 16 B × 20 000 ≈ 320 KB, and a
  // scavenge mid-loop would make `grown` negative.
  expect(grown).toBeGreaterThanOrEqual(0);
  expect(grown - baseline).toBeLessThan(16 * 1024);
});
