/**
 * Main-thread routing of module loads between the create worker and the worklet (#513,
 * hooks/audioGraph/createWorkerHost.ts), with a fake Worker and node.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIN_TO_WORKLET as MT } from '../../audio-worklet/workletProtocolConstants';
import { CREATE_WORKER, CREATE_WORKER_REPLY } from '../../audio-worklet/createThreadProtocol';
import type { WorkletCreateHeapMessage } from '../../audio-worklet/protocol';
import {
  attachCreateWorker,
  createWorkerReadyFor,
  disposeCreateWorker,
  postModuleLoad,
  prepareCreateWorker,
} from '../../hooks/audioGraph/createWorkerHost';

interface Sent { type: string; [k: string]: unknown }

class FakeWorker {
  static instances: FakeWorker[] = [];
  sent: Sent[] = [];
  transfers: Transferable[][] = [];
  terminated = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(m: Sent, transfer: Transferable[] = []) { this.sent.push(m); this.transfers.push(transfer); }
  terminate() { this.terminated = true; }
  reply(data: unknown) { this.onmessage?.({ data }); }
}

function fakeNode() {
  const sent: Sent[] = [];
  const transfers: Transferable[][] = [];
  const port = { postMessage: (m: Sent, transfer: Transferable[] = []) => { sent.push(m); transfers.push(transfer); } };
  return { node: { port } as unknown as AudioWorkletNode, sent, transfers };
}

const heap = (memory: WebAssembly.Memory, heapId = 7): WorkletCreateHeapMessage => ({
  type: 'createHeap',
  memory,
  heapId,
  stackLow: 1 << 16,
  stackSize: 1 << 20,
});

const assets = () => ({ scriptText: '/* glue */', wasmModule: Promise.resolve({} as WebAssembly.Module) });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createWorkerHost (#513)', () => {
  let memory: WebAssembly.Memory;

  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    memory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
  });
  afterEach(() => {
    disposeCreateWorker();
    vi.unstubAllGlobals();
  });

  it('boots from the prepared pair even when the heap is announced to a later port handler (hot-reload race)', async () => {
    prepareCreateWorker(assets());
    const { node, sent } = fakeNode();
    // The second start-path run (hot reload) has no assets of its own — the host still has them.
    attachCreateWorker(node, heap(memory));
    await flush();
    const w = FakeWorker.instances[0]!;
    expect(w.sent.map((m) => m.type)).toEqual([CREATE_WORKER.attachPort, CREATE_WORKER.init]);
    expect(w.sent[1]!.memory).toBe(memory);
    expect(sent.map((m) => m.type)).toEqual([MT.attachCreatePort]);
  });

  it('loads go to the worklet until the worker is ready, then to the worker', async () => {
    prepareCreateWorker(assets());
    const { node, sent } = fakeNode();
    attachCreateWorker(node, heap(memory));
    await flush();
    const w = FakeWorker.instances[0]!;

    postModuleLoad(node, new Uint8Array(8));
    expect(sent.at(-1)!.type).toBe(MT.load);
    expect(createWorkerReadyFor(node)).toBe(false);

    w.reply({ type: CREATE_WORKER_REPLY.ready });
    expect(createWorkerReadyFor(node)).toBe(true);
    const workletLoads = sent.filter((m) => m.type === MT.load).length;
    postModuleLoad(node, new Uint8Array(8));
    expect(w.sent.at(-1)!.type).toBe(CREATE_WORKER.create);
    expect(sent.filter((m) => m.type === MT.load).length).toBe(workletLoads);
  });

  it('a node that reuses the heap gets a new port to the same worker; another node is not served', async () => {
    prepareCreateWorker(assets());
    const first = fakeNode();
    attachCreateWorker(first.node, heap(memory));
    await flush();
    FakeWorker.instances[0]!.reply({ type: CREATE_WORKER_REPLY.ready });

    // Each createHeap message deserializes to a NEW Memory wrapper; the heap id is what matches.
    const rewrapped = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
    const second = fakeNode();
    attachCreateWorker(second.node, heap(rewrapped));
    expect(FakeWorker.instances.length).toBe(1);
    expect(FakeWorker.instances[0]!.terminated).toBe(false);
    expect(second.sent.map((m) => m.type)).toEqual([MT.attachCreatePort]);
    expect(createWorkerReadyFor(second.node)).toBe(true);
    expect(createWorkerReadyFor(first.node)).toBe(false);
    postModuleLoad(first.node, new Uint8Array(8));
    expect(first.sent.at(-1)!.type).toBe(MT.load);
  });

  it('when the worker dies, its unanswered loads are re-sent to the worklet and later loads stay there', async () => {
    prepareCreateWorker(assets());
    const { node, sent } = fakeNode();
    attachCreateWorker(node, heap(memory));
    await flush();
    const w = FakeWorker.instances[0]!;
    w.reply({ type: CREATE_WORKER_REPLY.ready });

    const answered = new Uint8Array(4);
    const lost = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    postModuleLoad(node, answered);
    postModuleLoad(node, lost);
    const seq1 = w.sent.filter((m) => m.type === CREATE_WORKER.create)[0]!.seq;
    w.reply({ type: CREATE_WORKER_REPLY.created, seq: seq1, ok: true, createMs: 1 });

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    w.onerror?.({ message: 'boom' });
    expect(w.terminated).toBe(true);
    const resent = sent.filter((m) => m.type === MT.load);
    expect(resent.length).toBe(1);
    // Re-sent from the caller's bytes (the copy the worker got was transferred away).
    expect(new Uint8Array(resent[0]!.moduleData as ArrayBuffer)).toEqual(lost);
    expect(createWorkerReadyFor(node)).toBe(false);
    postModuleLoad(node, new Uint8Array(2));
    expect(sent.at(-1)!.type).toBe(MT.load);
  });

  it('each send copies the bytes once and TRANSFERS the copy; the caller’s bytes stay attached', async () => {
    prepareCreateWorker(assets());
    const { node, sent, transfers } = fakeNode();
    attachCreateWorker(node, heap(memory));
    await flush();
    const w = FakeWorker.instances[0]!;
    const fileData = new Uint8Array([9, 8, 7, 6]);

    // To the worklet (worker not ready yet).
    postModuleLoad(node, fileData);
    const toWorklet = sent.at(-1)!.moduleData as ArrayBuffer;
    expect(transfers.at(-1)).toEqual([toWorklet]);
    expect(toWorklet).not.toBe(fileData.buffer);
    expect(new Uint8Array(toWorklet)).toEqual(fileData);

    // To the create worker.
    w.reply({ type: CREATE_WORKER_REPLY.ready });
    postModuleLoad(node, fileData);
    const toWorker = w.sent.at(-1)!.moduleData as ArrayBuffer;
    expect(w.transfers.at(-1)).toEqual([toWorker]);
    expect(toWorker).not.toBe(fileData.buffer);
    expect(new Uint8Array(toWorker)).toEqual(fileData);
    expect(fileData.buffer).not.toBe(toWorklet);
  });

  it('a worker that fails to boot leaves loads in the worklet', async () => {
    prepareCreateWorker(assets());
    const { node, sent } = fakeNode();
    attachCreateWorker(node, heap(memory));
    await flush();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    FakeWorker.instances[0]!.reply({ type: CREATE_WORKER_REPLY.initFailed, message: 'no threads' });
    postModuleLoad(node, new Uint8Array(8));
    expect(sent.at(-1)!.type).toBe(MT.load);
  });

  it('a different heap id (a new worklet scope) replaces the worker', async () => {
    prepareCreateWorker(assets());
    attachCreateWorker(fakeNode().node, heap(memory, 1));
    await flush();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    attachCreateWorker(fakeNode().node, heap(memory, 2));
    expect(FakeWorker.instances.length).toBe(2);
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
  });

  it('without a prepared playback pair nothing starts', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { node, sent } = fakeNode();
    attachCreateWorker(node, heap(memory));
    expect(FakeWorker.instances.length).toBe(0);
    expect(sent.length).toBe(0);
  });
});
