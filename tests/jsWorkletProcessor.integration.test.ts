/**
 * Drives the COMPILED worklet (public/worklets/openmpt-worklet.js) with the REAL committed
 * libopenmpt-worklet.{js,wasm} inside a fake AudioWorkletGlobalScope (node:vm), through the same
 * initLib / load / seek / setRenderParam messages the app posts. No browser needed, but it
 * exercises the exact bootstrap path that broke in the first real-wasm build ("_malloc is not a
 * function": readiness was inferred from lazy export stubs) and the MOD↔XM / stop→play lifecycle
 * contracts (#329/#330): one libopenmpt per scope, node reuse, recovery after a bad file.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAIN_TO_WORKLET as MT, WORKLET_TO_MAIN as WT } from '../audio-worklet/workletProtocolConstants';
import { synthXm } from '../scripts/lib/synth-xm.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel: string) => readFileSync(join(ROOT, rel));

const SAMPLE_RATE = 48000;
const QUANTUM = 128;

interface Posted { type: string; [k: string]: unknown }

class FakeScope {
  posted: Posted[] = [];
  ctx: vm.Context;
  Processor!: new (opts?: unknown) => { port: { onmessage: ((e: { data: unknown }) => Promise<void>) | null }; process: (i: unknown, o: Float32Array[][], p: unknown) => boolean };
  private sandbox: Record<string, unknown>;

  constructor() {
    const posted = this.posted;
    class AudioWorkletProcessor {
      port = {
        onmessage: null as null | ((e: { data: unknown }) => Promise<void>),
        postMessage: (m: Posted) => { posted.push(m); },
      };
    }
    this.sandbox = {
      AudioWorkletProcessor,
      registerProcessor: (_name: string, ctor: FakeScope['Processor']) => { this.Processor = ctor; },
      currentTime: 0,
      sampleRate: SAMPLE_RATE,
      SharedArrayBuffer,
      WebAssembly,
      setTimeout,
      clearTimeout,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    };
    this.ctx = vm.createContext(this.sandbox);
    vm.runInContext(read('public/worklets/openmpt-worklet.js').toString('utf8'), this.ctx, { filename: 'openmpt-worklet.js' });
  }

  /** Copy bytes into this scope's realm — the processor's `instanceof ArrayBuffer` checks are realm-bound. */
  toRealm(bytes: Uint8Array): ArrayBuffer {
    const fn = vm.runInContext(
      '(function (a) { var u = new Uint8Array(a.length); u.set(a); return u.buffer; })',
      this.ctx,
    ) as (a: Uint8Array) => ArrayBuffer;
    return fn(bytes);
  }

  advance(seconds: number): void {
    (this.sandbox as { currentTime: number }).currentTime += seconds;
  }

  newNode() {
    const node = new this.Processor({});
    const send = async (data: unknown) => { await node.port.onmessage?.({ data }); };
    return { node, send };
  }

  count(type: string): number {
    return this.posted.filter((m) => m.type === type).length;
  }
}

async function initLib(scope: FakeScope, send: (d: unknown) => Promise<void>): Promise<void> {
  await send({
    type: MT.initLib,
    scriptText: read('public/worklets/libopenmpt-worklet.js').toString('utf8'),
    wasmBytes: scope.toRealm(read('public/worklets/libopenmpt-worklet.wasm')),
  });
}

/** Render `quanta` 128-frame blocks; returns peak and a cheap PCM fingerprint. */
function render(scope: FakeScope, node: ReturnType<FakeScope['newNode']>['node'], quanta: number) {
  const l = new Float32Array(QUANTUM);
  const r = new Float32Array(QUANTUM);
  let peak = 0;
  let sum = 0;
  for (let q = 0; q < quanta; q++) {
    scope.advance(QUANTUM / SAMPLE_RATE);
    node.process([[]], [[l, r]], {});
    for (let i = 0; i < QUANTUM; i++) {
      peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
      sum += l[i]! * (i + 1) + r[i]! * (QUANTUM - i);
    }
  }
  return { peak, fingerprint: sum };
}

const MOD = new Uint8Array(read('public/4-mat_madness.mod'));
// public/test.xm renders as silence (with the old engine too), so use a real, audible XM.
const XM = synthXm(8);
const MOD2 = new Uint8Array(read('public/libopenmpt-test.mod'));

describe('compiled JS worklet + real libopenmpt wasm (Node, fake AudioWorkletGlobalScope)', () => {
  let scope: FakeScope;
  let node: ReturnType<FakeScope['newNode']>;

  beforeAll(async () => {
    scope = new FakeScope();
    node = scope.newNode();
    await initLib(scope, node.send);
  }, 60_000);

  it('initLib boots the real wasm (no "_malloc is not a function"), then load acks and renders audio', async () => {
    expect(scope.count(WT.error)).toBe(0);
    await node.send({ type: MT.load, moduleData: scope.toRealm(MOD) });
    expect(scope.count(WT.error)).toBe(0);
    expect(scope.count(WT.loaded)).toBe(1);

    const { peak } = render(scope, node.node, 600);
    expect(peak).toBeGreaterThan(0.01);
    expect(peak).toBeLessThanOrEqual(1.5);
  });

  it('posts position reports at ~60 Hz with channel VU while playing', () => {
    const positions = scope.posted.filter((m) => m.type === WT.position);
    expect(positions.length).toBeGreaterThan(10);
    const last = positions[positions.length - 1]!;
    expect(last.sampleRate).toBe(SAMPLE_RATE);
    expect(Array.isArray(last.channelVU)).toBe(true);
    expect((last.channelVU as number[]).length).toBe(4);
  });

  it('MOD → XM → MOD on one node: every load acks, audio keeps flowing, lib is initialised once', async () => {
    for (const bytes of [XM, MOD2, MOD]) {
      const before = scope.count(WT.loaded);
      await node.send({ type: MT.load, moduleData: scope.toRealm(bytes) });
      expect(scope.count(WT.loaded)).toBe(before + 1);
      expect(render(scope, node.node, 300).peak).toBeGreaterThan(0.001);
    }
    expect(scope.count(WT.error)).toBe(0);
  });

  it('a second node in the same scope (hot reload) attaches to the shared lib with NO initLib', async () => {
    const second = scope.newNode();
    const before = scope.count(WT.loaded);
    await second.send({ type: MT.load, moduleData: scope.toRealm(XM) });
    expect(scope.count(WT.loaded)).toBe(before + 1);
    expect(render(scope, second.node, 200).peak).toBeGreaterThan(0.001);
  });

  it('a corrupt file reports an error and does NOT kill the runtime: the next valid load works', async () => {
    const junk = new Uint8Array(4096);
    for (let i = 0; i < junk.length; i++) junk[i] = (i * 2654435761) >>> 24;
    const errorsBefore = scope.count(WT.error);
    await node.send({ type: MT.load, moduleData: scope.toRealm(junk) });
    expect(scope.count(WT.error)).toBe(errorsBefore + 1);

    const loadedBefore = scope.count(WT.loaded);
    await node.send({ type: MT.load, moduleData: scope.toRealm(MOD) });
    expect(scope.count(WT.loaded)).toBe(loadedBefore + 1);
    expect(render(scope, node.node, 300).peak).toBeGreaterThan(0.01);
  });

  it('stop → play: pause silences output, play resumes it, without reloading the module', async () => {
    await node.send({ type: MT.pause });
    expect(render(scope, node.node, 20).peak).toBe(0);
    await node.send({ type: MT.play });
    expect(render(scope, node.node, 200).peak).toBeGreaterThan(0.01);
  });

  it('seek acks and playback continues', async () => {
    const before = scope.count(WT.seekAck);
    await node.send({ type: MT.seek, order: 0, row: 8 });
    expect(scope.count(WT.seekAck)).toBe(before + 1);
    expect(render(scope, node.node, 100).peak).toBeGreaterThan(0.001);
  });

  it('interpolation: default is Sinc+LP (8); setRenderParam(3, 4) selects cubic and survives a reload', async () => {
    const renderFresh = async (): Promise<number> => {
      await node.send({ type: MT.load, moduleData: scope.toRealm(MOD) });
      return render(scope, node.node, 400).fingerprint;
    };

    const dflt = await renderFresh();
    await node.send({ type: MT.setRenderParam, param: 3, value: 4 });
    const cubicLive = render(scope, node.node, 1).fingerprint; // live change must not throw
    expect(Number.isFinite(cubicLive)).toBe(true);
    const cubicAfterReload = await renderFresh();
    expect(cubicAfterReload).not.toBe(dflt);

    await node.send({ type: MT.setRenderParam, param: 3, value: 8 });
    expect(await renderFresh()).toBe(dflt);
  });

  it('initLib without wasm bytes fails fast with a clear error (no wasm2js JS-only path)', async () => {
    const cold = new FakeScope();
    const n = cold.newNode();
    await n.send({
      type: MT.initLib,
      scriptText: read('public/worklets/libopenmpt-worklet.js').toString('utf8'),
    });
    const err = cold.posted.find((m) => m.type === WT.error);
    expect(String(err?.message)).toMatch(/missing wasmBytes/);
  });

  it('initLib with an HTML 404 body as wasm is rejected by the magic check', async () => {
    const cold = new FakeScope();
    const n = cold.newNode();
    await n.send({
      type: MT.initLib,
      scriptText: read('public/worklets/libopenmpt-worklet.js').toString('utf8'),
      wasmBytes: cold.toRealm(new TextEncoder().encode('<!doctype html><title>404</title>')),
    });
    const err = cold.posted.find((m) => m.type === WT.error);
    expect(String(err?.message)).toMatch(/0asm magic/);
  });
});
