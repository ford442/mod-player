/**
 * #513: a large module load while another plays does not run create on the audio thread.
 *
 * The COMPILED processor (public/worklets/openmpt-worklet.js) runs in a fake AudioWorkletGlobalScope
 * on this thread, booted with the committed shared-memory playback heap (libopenmpt-playback.*).
 * The REAL create worker (workers/openmpt-create.worker.ts) runs on a worker_threads thread, joins
 * that heap, and talks to the processor over a real MessagePort — the same pipeline as the browser,
 * minus the browser. This thread stands in for the audio thread: it keeps calling process() while
 * the worker parses a 16 MiB, 64-channel IT, and no call may take longer than one quantum.
 *
 * The control case runs the same file through the in-worklet path (MT.load) and shows the stall
 * the test exists to catch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAIN_TO_WORKLET as MT, WORKLET_TO_MAIN as WT } from '../audio-worklet/workletProtocolConstants';
import { CREATE_FAILED_MESSAGE, CREATE_WORKER } from '../audio-worklet/createThreadProtocol';
import { synthIt } from '../scripts/lib/synth-it.mjs';
import { FakeScope, QUANTUM, SAMPLE_RATE, read } from './helpers/workletScope';
import { CreateWorkerThread } from './helpers/createWorkerThread';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BUDGET_MS = (QUANTUM / SAMPLE_RATE) * 1000;
const MOD = new Uint8Array(read('public/4-mat_madness.mod'));
const BIG_IT = synthIt(64, { sampleFrames: 2 << 20 }); // ~16 MiB

type ProcessorNode = ReturnType<FakeScope['newNode']>['node'] & {
  modulePtr: number;
  _fadeTarget: number;
};

interface RenderStats {
  quanta: number;
  maxProcessMs: number;
  /** Every process() duration, for the median. */
  processMs: number[];
  /** Worst time between two consecutive quanta — includes any message handler that ran in between. */
  maxGapMs: number;
  peak: number;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

// Reused output buffers: no allocation (and so no GC) inside the timed loop.
const OUT_L = new Float32Array(QUANTUM);
const OUT_R = new Float32Array(QUANTUM);

/** Render one quantum like the audio thread: time the process() call itself. */
function quantum(scope: FakeScope, node: ProcessorNode, stats: RenderStats): void {
  const l = OUT_L;
  const r = OUT_R;
  scope.advance(QUANTUM / SAMPLE_RATE);
  const t0 = performance.now();
  node.process([[]], [[l, r]], {});
  const ms = performance.now() - t0;
  stats.quanta++;
  stats.processMs.push(ms);
  if (ms > stats.maxProcessMs) stats.maxProcessMs = ms;
  for (let i = 0; i < QUANTUM; i++) stats.peak = Math.max(stats.peak, Math.abs(l[i]!), Math.abs(r[i]!));
}

/** Keep rendering (yielding to the event loop between quanta) until `done()` or the deadline. */
async function renderUntil(scope: FakeScope, node: ProcessorNode, done: () => boolean, timeoutMs = 30_000): Promise<RenderStats> {
  const stats: RenderStats = { quanta: 0, maxProcessMs: 0, processMs: [], maxGapMs: 0, peak: 0 };
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('renderUntil: timed out');
    const now = performance.now();
    if (last >= 0 && now - last > stats.maxGapMs) stats.maxGapMs = now - last;
    last = now;
    quantum(scope, node, stats);
    await new Promise<void>((r) => setImmediate(r));
  }
  return stats;
}

async function renderQuanta(scope: FakeScope, node: ProcessorNode, n: number): Promise<RenderStats> {
  let left = n;
  return renderUntil(scope, node, () => left-- <= 0);
}

describe('#513 module create off the audio thread (compiled worklet + real create worker, Node)', () => {
  let scope: FakeScope;
  let send: (d: unknown) => Promise<void>;
  let node: ProcessorNode;
  let worker: CreateWorkerThread;

  beforeAll(async () => {
    scope = new FakeScope();
    const n = scope.newNode();
    send = n.send;
    node = n.node as ProcessorNode;
    await send({
      type: MT.initLib,
      scriptText: read('public/worklets/libopenmpt-playback.js').toString('utf8'),
      wasmBytes: scope.toRealm(read('public/worklets/libopenmpt-playback.wasm')),
    });

    const heap = scope.posted.find((m) => m.type === WT.createHeap);
    if (!heap) throw new Error('the playback heap did not announce itself (WT.createHeap)');

    worker = new CreateWorkerThread();
    const port = worker.attachPort();
    await send({ type: MT.attachCreatePort, port });
    worker.worker.postMessage({
      type: CREATE_WORKER.init,
      scriptText: read('public/worklets/libopenmpt-playback.js').toString('utf8'),
      wasmModule: new WebAssembly.Module(readFileSync(join(ROOT, 'public/worklets/libopenmpt-playback.wasm'))),
      memory: heap.memory,
      stackLow: heap.stackLow,
      stackSize: heap.stackSize,
    });
    const ready = await worker.next('ready');
    if (ready.type !== 'ready') throw new Error(`create worker failed to boot: ${JSON.stringify(ready)}`);
  }, 60_000);

  afterAll(async () => {
    await worker?.terminate();
  });

  it('the playback heap announces a shared memory and an aligned stack for the create worker', () => {
    const heap = scope.posted.find((m) => m.type === WT.createHeap)!;
    expect((heap.memory as WebAssembly.Memory).buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(Number(heap.stackLow) % 16).toBe(0);
    expect(Number(heap.stackSize)).toBe(1 << 20);
    expect(scope.count(WT.error)).toBe(0);
  });

  it('a module created on the worker is swapped in and plays (first load: nothing playing, no fade)', async () => {
    const loadedBefore = scope.count(WT.loaded);
    const copy = MOD.slice().buffer;
    worker.worker.postMessage({ type: CREATE_WORKER.create, seq: 1, moduleData: copy }, [copy]);
    await renderUntil(scope, node, () => scope.count(WT.loaded) > loadedBefore);
    expect(node.modulePtr).not.toBe(0);
    expect((await renderQuanta(scope, node, 400)).peak).toBeGreaterThan(0.01);
  });

  it('a 16 MiB IT parses on the worker while this thread keeps rendering the old module', async () => {
    const previous = node.modulePtr;
    const loadedBefore = scope.count(WT.loaded);
    const copy = BIG_IT.slice().buffer;
    worker.worker.postMessage({ type: CREATE_WORKER.create, seq: 2, moduleData: copy }, [copy]);

    const during = await renderUntil(scope, node, () => scope.count(WT.loaded) > loadedBefore);
    const created = await worker.next('created');
    expect(created.ok).toBe(true);

    // The create took many quanta of wall time, and the old module played through all of them …
    expect(Number(created.createMs)).toBeGreaterThan(BUDGET_MS);
    expect(during.quanta).toBeGreaterThan(4);
    expect(during.peak).toBeGreaterThan(0.01);
    // … and nothing on this thread waited for it. An on-thread create (in a handler or in process())
    // makes one gap at least as long as the create; scheduler noise on a busy runner is far shorter.
    // A hard per-call budget is not asserted: under a parallel test run any single call can be
    // descheduled for a few ms, which says nothing about where create runs.
    expect(during.maxGapMs).toBeLessThan(Number(created.createMs));
    expect(during.maxProcessMs).toBeLessThan(Number(created.createMs));
    expect(median(during.processMs)).toBeLessThan(BUDGET_MS / 4);

    expect(node.modulePtr).not.toBe(previous);
    expect(scope.count(WT.error)).toBe(0);
    // (Not asserted: the new 64-channel module's own first render quanta — that is render cost,
    // the same on either create path.)
    const after = await renderQuanta(scope, node, 200);
    expect(after.peak).toBeGreaterThan(0.01);
    const lastPos = [...scope.posted].reverse().find((m) => m.type === WT.position)!;
    expect((lastPos.channelVU as number[]).length).toBe(32); // the 64-channel IT (VU is capped at 32)
  }, 60_000);

  it('a corrupt file fails on the worker: the worklet reports the usual error and keeps playing', async () => {
    const playing = node.modulePtr;
    const errorsBefore = scope.count(WT.error);
    const junk = new Uint8Array(4096);
    for (let i = 0; i < junk.length; i++) junk[i] = (i * 2654435761) >>> 24;
    worker.worker.postMessage({ type: CREATE_WORKER.create, seq: 3, moduleData: junk.buffer }, [junk.buffer]);
    await renderUntil(scope, node, () => scope.count(WT.error) > errorsBefore);
    const err = scope.posted.filter((m) => m.type === WT.error).pop()!;
    expect(err.message).toBe(CREATE_FAILED_MESSAGE);
    expect(err.fatal).toBeUndefined();
    expect(node.modulePtr).toBe(playing);
    expect((await renderQuanta(scope, node, 100)).peak).toBeGreaterThan(0.01);
  });

  it('replaced modules are destroyed on the worker: repeated large loads do not grow the heap without bound', async () => {
    const heap = scope.posted.find((m) => m.type === WT.createHeap)!.memory as WebAssembly.Memory;
    const sizes: number[] = [];
    for (let seq = 10; seq < 14; seq++) {
      const loadedBefore = scope.count(WT.loaded);
      const copy = BIG_IT.slice().buffer;
      worker.worker.postMessage({ type: CREATE_WORKER.create, seq, moduleData: copy }, [copy]);
      await renderUntil(scope, node, () => scope.count(WT.loaded) > loadedBefore);
      // The destroy posted at the swap lands on the worker before the next create (one port, in order).
      sizes.push(heap.buffer.byteLength);
    }
    // Two modules can be alive at once (playing + being created); four loads leaking would need ~4× that.
    expect(sizes[sizes.length - 1]).toBe(sizes[1]);
  }, 120_000);

  it('a paused node swaps the staged module in immediately (no fade to wait for)', async () => {
    await send({ type: MT.pause });
    const loadedBefore = scope.count(WT.loaded);
    const copy = MOD.slice().buffer;
    worker.worker.postMessage({ type: CREATE_WORKER.create, seq: 20, moduleData: copy }, [copy]);
    // No process() calls at all: the port handler adopts it.
    const deadline = Date.now() + 10_000;
    while (scope.count(WT.loaded) === loadedBefore && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(scope.count(WT.loaded)).toBe(loadedBefore + 1);
    await send({ type: MT.play });
    expect((await renderQuanta(scope, node, 300)).peak).toBeGreaterThan(0.01);
  });

  it('control: the same 16 MiB load created IN the worklet blocks the audio thread for several quanta', async () => {
    const errorsBefore = scope.count(WT.error);
    const t0 = performance.now();
    await send({ type: MT.load, moduleData: scope.toRealm(BIG_IT) });
    const blockedMs = performance.now() - t0 - 10; // minus the 10 ms pre-create fade wait (a timer, not blocking)
    expect(scope.count(WT.error)).toBe(errorsBefore);
    expect(blockedMs).toBeGreaterThan(BUDGET_MS);
  }, 60_000);
});

describe('#513 process() never creates, destroys or mallocs the file image', () => {
  const src = readFileSync(join(ROOT, 'audio-worklet/js/openmpt-processor.ts'), 'utf8');
  /** Body of a class method, by brace matching from its signature. */
  const method = (name: string): string => {
    const start = src.search(new RegExp(`\\n  ${name}\\(`));
    expect(start).toBeGreaterThan(0);
    let i = src.indexOf('{', start);
    let depth = 0;
    const from = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) break;
    }
    return src.slice(from, i);
  };

  it.each(['process', '_renderQuantum', '_adoptStaged', '_retireModule', '_configureLoadedModule'])(
    '%s has no create / destroy / malloc on the create-worker path',
    (name) => {
      const body = method(name);
      expect(body).not.toMatch(/create_from_memory/);
      expect(body).not.toMatch(/_malloc\(/);
      if (name !== '_retireModule') expect(body).not.toMatch(/_openmpt_module_destroy/);
    },
  );

  it('_retireModule hands modules to the create worker and destroys inline only without one', () => {
    const body = method('_retireModule');
    const port = body.indexOf('CREATE_PORT.destroy');
    const inline = body.indexOf('_openmpt_module_destroy');
    expect(port).toBeGreaterThan(0);
    expect(body.slice(0, inline)).toMatch(/return;\s*\}/); // the port branch returns first
  });
});
