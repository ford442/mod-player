/**
 * A fake AudioWorkletGlobalScope (node:vm) running the COMPILED JS worklet
 * (public/worklets/openmpt-worklet.js), plus the initLib message that boots the
 * REAL committed libopenmpt-worklet.{js,wasm} inside it. Shared by
 * tests/jsWorkletProcessor.integration.test.ts and tests/exportLiveParity.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { MAIN_TO_WORKLET as MT } from '../../audio-worklet/workletProtocolConstants';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const read = (rel: string) => readFileSync(join(ROOT, rel));

export const SAMPLE_RATE = 48000;
export const QUANTUM = 128;

export interface Posted { type: string; [k: string]: unknown }

export class FakeScope {
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

export async function initLib(scope: FakeScope, send: (d: unknown) => Promise<void>): Promise<void> {
  await send({
    type: MT.initLib,
    scriptText: read('public/worklets/libopenmpt-worklet.js').toString('utf8'),
    wasmBytes: scope.toRealm(read('public/worklets/libopenmpt-worklet.wasm')),
  });
}

