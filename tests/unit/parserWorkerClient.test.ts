/**
 * The warm parser worker (utils/parserWorker.ts `createParserWorkerClient`): one worker for every
 * parse of the session — so libopenmpt is fetched and compiled once — with request ids, and a
 * fresh worker after one crashes or hangs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerParseMessage } from '../../types';

// parserWorker.ts imports the worker as a Vite `?worker&url` asset; only its URL string matters here.
vi.mock('../../workers/openmpt-parser.worker.ts?worker&url', () => ({ default: 'parser.worker.js' }));

import { createParserWorkerClient } from '../../utils/parserWorker';

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: Array<{ message: WorkerParseMessage; transfer: Transferable[] }> = [];
  terminated = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  private listeners = new Map<string, Array<(e: unknown) => void>>();
  constructor() { FakeWorker.instances.push(this); }
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  postMessage(message: WorkerParseMessage, transfer: Transferable[] = []) { this.posted.push({ message, transfer }); }
  terminate() { this.terminated = true; }
  reply(data: unknown) { this.onmessage?.({ data }); }
  emit(type: string, e: unknown) { for (const fn of this.listeners.get(type) ?? []) fn(e); }
  parsedReply(id: number | undefined, fileName = 'x') {
    return { type: 'parsed', id, patternMatrices: [], metadata: { title: fileName } };
  }
}

const bytes = () => new Uint8Array([1, 2, 3, 4]);

describe('createParserWorkerClient', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const client = (onFatalError?: (m: string) => void) =>
    createParserWorkerClient({
      createWorker: () => new FakeWorker() as unknown as Worker,
      ...(onFatalError ? { onFatalError } : {}),
    });

  it('keeps ONE warm worker across parses (it is never terminated after a successful parse)', async () => {
    const c = client();
    for (const name of ['a.mod', 'b.xm', 'c.it']) {
      const p = c.parse(bytes(), name);
      const w = FakeWorker.instances[0]!;
      const { id } = w.posted.at(-1)!.message;
      w.reply(w.parsedReply(id, name));
      await expect(p).resolves.toMatchObject({ type: 'parsed', id });
    }
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]!.terminated).toBe(false);
    const ids = FakeWorker.instances[0]!.posted.map((p) => p.message.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('transfers the bytes it is given', () => {
    const c = client();
    const data = bytes();
    void c.parse(data, 'a.mod');
    const { message, transfer } = FakeWorker.instances[0]!.posted[0]!;
    expect(message.fileData).toBe(data);
    expect(transfer).toEqual([data.buffer]);
  });

  it('routes replies by id: a superseded parse still settles with ITS result, progress goes to its owner', async () => {
    const c = client();
    const progressA = vi.fn();
    const a = c.parse(bytes(), 'a.mod', { onProgress: progressA });
    const b = c.parse(bytes(), 'b.mod');
    const w = FakeWorker.instances[0]!;
    const [idA, idB] = w.posted.map((p) => p.message.id);

    w.reply({ type: 'progress', id: idA, stage: 'patterns' });
    w.reply(w.parsedReply(idB, 'b.mod')); // the newer one finishes first
    w.reply({ type: 'error', id: idA, message: 'bad file' });

    await expect(b).resolves.toMatchObject({ type: 'parsed', id: idB, metadata: { title: 'b.mod' } });
    await expect(a).resolves.toEqual({ type: 'error', id: idA, message: 'bad file' });
    expect(progressA).toHaveBeenCalledWith('patterns');
    // A per-file error is not a worker failure: the worker stays.
    expect(w.terminated).toBe(false);
  });

  it('a crashed worker rejects everything in flight and is replaced on the next parse', async () => {
    const onFatal = vi.fn();
    const c = client(onFatal);
    const a = c.parse(bytes(), 'a.mod');
    const b = c.parse(bytes(), 'b.mod');
    const first = FakeWorker.instances[0]!;
    first.emit('error', { message: 'worker crashed' });
    await expect(a).rejects.toThrow('worker crashed');
    await expect(b).rejects.toThrow('worker crashed');
    expect(first.terminated).toBe(true);

    const next = c.parse(bytes(), 'c.mod');
    expect(FakeWorker.instances).toHaveLength(2);
    const second = FakeWorker.instances[1]!;
    second.reply(second.parsedReply(second.posted[0]!.message.id));
    await expect(next).resolves.toMatchObject({ type: 'parsed' });
  });

  it('a reply with no id (the worker’s own onerror) fails every request on that worker', async () => {
    const c = client();
    const a = c.parse(bytes(), 'a.mod');
    FakeWorker.instances[0]!.reply({ type: 'error', message: 'Worker script error' });
    await expect(a).rejects.toThrow('Worker script error');
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
  });

  it('a timeout drops the hung worker (and what queued behind it); late replies from it are ignored', async () => {
    vi.useFakeTimers();
    const c = client();
    const a = c.parse(bytes(), 'a.mod', { timeoutMs: 1000 });
    const b = c.parse(bytes(), 'b.mod', { timeoutMs: 5000 });
    const hung = FakeWorker.instances[0]!;
    const rejections = Promise.allSettled([a, b]);
    vi.advanceTimersByTime(1000);
    const [ra, rb] = await rejections;
    expect(ra.status).toBe('rejected');
    expect((ra as PromiseRejectedResult).reason.message).toMatch(/timed out after 1000ms/);
    expect(rb.status).toBe('rejected');
    expect(hung.terminated).toBe(true);
    hung.reply(hung.parsedReply(hung.posted[0]!.message.id)); // too late: no throw, no effect

    const next = c.parse(bytes(), 'c.mod');
    expect(FakeWorker.instances).toHaveLength(2);
    const fresh = FakeWorker.instances[1]!;
    fresh.reply(fresh.parsedReply(fresh.posted[0]!.message.id));
    await expect(next).resolves.toMatchObject({ type: 'parsed' });
  });

  it('terminate() stops the worker and rejects what is in flight', async () => {
    const c = client();
    const a = c.parse(bytes(), 'a.mod');
    c.terminate();
    await expect(a).rejects.toThrow(/terminated/);
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
  });
});
