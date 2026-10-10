/**
 * Drives the COMPILED character-stage worklet (public/worklets/fx-character-worklet.js,
 * #453) — the same file the browser loads — and checks it against the TS
 * kernels and its reset/dispose contract.
 *
 * The bundle is evaluated with `new Function` against real globals rather than
 * in a node:vm context: a contextified sandbox routes every global lookup in
 * the hot loop (`Math`, `sampleRate`, `currentTime`) through a C++ interceptor,
 * which is ~100× slower and allocates — nothing like a real worklet scope.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CHARACTER_MSG_DISPOSE,
  CHARACTER_MSG_RESET,
  CHARACTER_PARAM_DESCRIPTORS,
  CHARACTER_PROCESSOR_NAME,
  characterParamArray,
  type CharacterParamValues,
} from '../audio-worklet/fxCharacterParams';
import { CharacterChannel } from '../audio-worklet/js/fx/characterChannel';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BUNDLE = 'public/worklets/fx-character-worklet.js';
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const SR = 48000;

type Params = Record<string, Float32Array>;
interface Processor {
  port: { onmessage: ((e: { data: unknown }) => void) | null };
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Params): boolean;
}
interface ProcessorCtor {
  new (options?: unknown): Processor;
  readonly parameterDescriptors: unknown;
}

const scopeGlobals = globalThis as unknown as { currentTime?: number; sampleRate?: number };

/** Loads the bundle with the worklet globals it needs; `currentTime` / `sampleRate` are real globals. */
class FakeScope {
  name = '';
  Processor!: ProcessorCtor;

  constructor(sampleRate = SR) {
    class AudioWorkletProcessor {
      port = { onmessage: null as null | ((e: { data: unknown }) => void), postMessage: () => {} };
    }
    scopeGlobals.sampleRate = sampleRate;
    scopeGlobals.currentTime = 0;
    const load = new Function('AudioWorkletProcessor', 'registerProcessor', read(BUNDLE)) as (
      base: typeof AudioWorkletProcessor,
      register: (name: string, ctor: ProcessorCtor) => void,
    ) => void;
    load(AudioWorkletProcessor, (name, ctor) => {
      this.name = name;
      this.Processor = ctor;
    });
  }

  set time(seconds: number) {
    scopeGlobals.currentTime = seconds;
  }
}

afterAll(() => {
  delete scopeGlobals.currentTime;
  delete scopeGlobals.sampleRate;
});

function paramArrays(values: Partial<CharacterParamValues> = {}): Params {
  const packed = characterParamArray(values);
  const out: Params = {};
  CHARACTER_PARAM_DESCRIPTORS.forEach((d, i) => {
    out[d.name] = new Float32Array([packed[i]!]);
  });
  return out;
}

function noise(n: number, seed: number): Float32Array {
  const out = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s / 0xffffffff - 0.5) * 1.2;
  }
  return out;
}

/** Run a processor over [left, right] in blocks, advancing currentTime like the audio clock. */
function runProcessor(
  scope: FakeScope,
  proc: Processor,
  left: Float32Array,
  right: Float32Array | null,
  block: number,
  params: Params,
  startTime = 0,
): [Float32Array, Float32Array] {
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(left.length);
  for (let off = 0; off < left.length; off += block) {
    const n = Math.min(block, left.length - off);
    scope.time = startTime + off / SR;
    const input = right ? [left.subarray(off, off + n), right.subarray(off, off + n)] : [left.subarray(off, off + n)];
    proc.process([input], [[outL.subarray(off, off + n), outR.subarray(off, off + n)]], params);
  }
  return [outL, outR];
}

function runKernel(values: Partial<CharacterParamValues>, input: Float32Array): Float32Array {
  // AudioParams carry float32 values; feed the kernel exactly what the processor sees.
  const ch = new CharacterChannel(SR, characterParamArray(values).map(Math.fround));
  const out = new Float32Array(input.length);
  ch.process(input, out, input.length);
  return out;
}

const ALL_ON: Partial<CharacterParamValues> = {
  tapeOn: 1, drive: 0.7, bias: 0.2, ledOn: 1, ledModel: 0, crushOn: 1, crushRate: 9000, crushBits: 7, outputGain: -3,
};

describe('fx-character worklet bundle (#453)', () => {
  it('is generated, and registers the shared processor name and descriptors', () => {
    expect(read(BUNDLE).startsWith('// generated — do not edit.')).toBe(true);
    const scope = new FakeScope();
    expect(scope.name).toBe(CHARACTER_PROCESSOR_NAME);
    expect(JSON.parse(JSON.stringify(scope.Processor.parameterDescriptors))).toEqual(
      JSON.parse(JSON.stringify(CHARACTER_PARAM_DESCRIPTORS)),
    );
  });

  for (const block of [128, 256, 1024, 2048]) {
    it(`matches the TS kernels bit-for-bit (${block}-frame quanta)`, () => {
      const scope = new FakeScope();
      const proc = new scope.Processor();
      const left = noise(8192, 7);
      const right = noise(8192, 11);
      const [outL, outR] = runProcessor(scope, proc, left, right, block, paramArrays(ALL_ON));
      expect(outL).toEqual(runKernel(ALL_ON, left));
      expect(outR).toEqual(runKernel(ALL_ON, right));
    });
  }

  it('feeds a mono input to both channels', () => {
    const scope = new FakeScope();
    const proc = new scope.Processor();
    const [outL, outR] = runProcessor(scope, proc, noise(2048, 3), null, 128, paramArrays(ALL_ON));
    expect(outR).toEqual(outL);
  });

  it('treats a missing input as silence and keeps running (tails ring out)', () => {
    const scope = new FakeScope();
    const proc = new scope.Processor();
    const params = paramArrays(ALL_ON);
    runProcessor(scope, proc, noise(1024, 5), null, 128, params);
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);
    scope.time = 1024 / SR;
    expect(proc.process([[]], [[outL, outR]], params)).toBe(true);
    expect(outL.some((v) => v !== 0)).toBe(true); // the resampler tail
    for (const v of outL) expect(Number.isFinite(v)).toBe(true);
  });

  it('resets its state after a gap in the render clock (re-enabled after a disconnect)', () => {
    const params = paramArrays(ALL_ON);
    const scope = new FakeScope();
    const proc = new scope.Processor();
    runProcessor(scope, proc, noise(4096, 9), null, 128, params, 0);
    const after = noise(1024, 13);
    const [resumed] = runProcessor(scope, proc, after, null, 128, params, 5); // 5 s later

    const freshScope = new FakeScope();
    const [fresh] = runProcessor(freshScope, new freshScope.Processor(), after, null, 128, params, 0);
    expect(resumed).toEqual(fresh);
  });

  it('a `reset` message starts the next quantum from clean state', () => {
    const params = paramArrays(ALL_ON);
    const scope = new FakeScope();
    const proc = new scope.Processor();
    runProcessor(scope, proc, noise(4096, 9), null, 128, params, 0);
    proc.port.onmessage?.({ data: { type: CHARACTER_MSG_RESET } });
    const after = noise(1024, 13);
    const [resumed] = runProcessor(scope, proc, after, null, 128, params, 4096 / SR);

    const freshScope = new FakeScope();
    const [fresh] = runProcessor(freshScope, new freshScope.Processor(), after, null, 128, params, 0);
    expect(resumed).toEqual(fresh);
  });

  it('returns false after `dispose`', () => {
    const scope = new FakeScope();
    const proc = new scope.Processor();
    proc.port.onmessage?.({ data: { type: CHARACTER_MSG_DISPOSE } });
    expect(proc.process([[]], [[new Float32Array(128), new Float32Array(128)]], paramArrays())).toBe(false);
  });

  // The allocation check lives in tests/fxCharacterAlloc.test.ts: it needs to
  // be the only load of the bundle in its isolate (see that file).
});

describe('@noalloc source guard (#453)', () => {
  const FILES = [
    'audio-worklet/js/fx-character-processor.ts',
    'audio-worklet/js/fx/characterChannel.ts',
    'audio-worklet/js/fx/halfband.ts',
    'audio-worklet/js/fx/crusher.ts',
  ];
  const BANNED: [RegExp, string][] = [
    [/\bnew\s+[A-Z]/, 'new'],
    [/=>/, 'closure'],
    [/\.\.\./, 'spread'],
    [/`/, 'template literal'],
    [/[=(,]\s*\{/, 'object literal'],
    [/[=(,]\s*\[/, 'array literal'],
    [/\.(slice|subarray|map|filter|concat|push|splice|forEach|reduce)\(/, 'allocating array method'],
    [/\b(Array|Object|JSON|String)\s*[.(]/, 'allocating builtin'],
  ];

  for (const file of FILES) {
    it(`${file} has allocation-free @noalloc regions`, () => {
      const src = read(file);
      const regions = [...src.matchAll(/\/\/ @noalloc:begin([\s\S]*?)\/\/ @noalloc:end/g)].map((m) => m[1]!);
      expect(regions.length).toBeGreaterThan(0);
      for (const region of regions) {
        const code = region.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const [pattern, what] of BANNED) {
          expect(code, `${what} in a @noalloc region of ${file}`).not.toMatch(pattern);
        }
      }
    });
  }

  it('numeric kernel fields have numeric initializers (an ES2020 bare field is tagged in V8)', () => {
    for (const file of ['smoothing', 'crusher', 'filters', 'saturator', 'halfband', 'characterChannel']) {
      const src = read(`audio-worklet/js/fx/${file}.ts`);
      expect(src, file).not.toMatch(/^\s*(?:(?:private|public|protected|readonly)\s+)*\w+\s*:\s*number\s*;/m);
    }
  });

  it('process(), every channel stage, both resamplers and the crusher are inside @noalloc regions', () => {
    expect(read(FILES[0]!)).toMatch(/process\([\s\S]*?\): boolean \{\s*\/\/ @noalloc:begin/);
    const channel = read(FILES[1]!);
    for (const fn of ['process', 'loadInput', 'amigaStage', 'tapeStage', 'writeOutput', 'setTargets']) {
      expect(channel, fn).toMatch(new RegExp(`${fn}\\([^)]*\\): void \\{\\s*// @noalloc:begin`));
    }
    expect(read(FILES[2]!).match(/processBlock\([^)]*\): void \{\s*\/\/ @noalloc:begin/g)).toHaveLength(2);
    expect(read(FILES[3]!)).toMatch(/processBlock\([^)]*\): void \{\s*\/\/ @noalloc:begin/);
    expect(read(FILES[3]!)).toMatch(/configureFrom\([^)]*\): void \{\s*\/\/ @noalloc:begin/);
  });
});
