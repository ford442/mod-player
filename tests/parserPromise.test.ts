/** Ported from utils/__debug__/parserPromise.test.cjs; real timers replaced with fake ones. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createParserPromise } from '../utils/parserPromise';

type Listener = (data?: unknown) => void;

class MockWorker {
  listeners = new Map<string, Set<Listener>>();
  terminated = false;

  addEventListener(type: string, handler: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(handler);
  }

  removeEventListener(type: string, handler: Listener) {
    this.listeners.get(type)?.delete(handler);
  }

  postMessage() {
    /* no-op by default */
  }

  terminate() {
    this.terminated = true;
  }

  dispatch(type: string, data?: unknown) {
    for (const handler of this.listeners.get(type) ?? []) handler(data);
  }

  listenerCount(type: string): number | undefined {
    return this.listeners.get(type)?.size;
  }
}

const asWorker = (w: MockWorker) => w as unknown as Worker;

describe('createParserPromise', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // parserPromise uses window.setTimeout; the shared test setup's window stub has none.
    vi.stubGlobal('window', globalThis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resolves with the message data and removes every listener without terminating the worker', async () => {
    const worker = new MockWorker();
    const { promise } = createParserPromise<string>(asWorker(worker), 1000, () => worker.postMessage(), {
      shouldResolve: () => true,
    });
    worker.dispatch('message', { data: 'ok' });
    await expect(promise).resolves.toBe('ok');
    expect(worker.listenerCount('message')).toBe(0);
    expect(worker.listenerCount('error')).toBe(0);
    expect(worker.listenerCount('messageerror')).toBe(0);
    expect(worker.terminated).toBe(false);
  });

  it('rejects with the error event message and cleans up', async () => {
    const worker = new MockWorker();
    const { promise } = createParserPromise<string>(asWorker(worker), 1000, () => worker.postMessage(), {
      shouldResolve: () => true,
    });
    worker.dispatch('error', { message: 'boom' });
    await expect(promise).rejects.toThrow('boom');
    expect(worker.listenerCount('message')).toBe(0);
  });

  it('rejects on messageerror and cleans up', async () => {
    const worker = new MockWorker();
    const { promise } = createParserPromise<string>(asWorker(worker), 1000, () => worker.postMessage(), {
      shouldResolve: () => true,
    });
    worker.dispatch('messageerror');
    await expect(promise).rejects.toThrow('Parser worker message deserialization failed');
    expect(worker.listenerCount('messageerror')).toBe(0);
  });

  it('times out, terminates the worker and cleans up', async () => {
    const worker = new MockWorker();
    const { promise } = createParserPromise<string>(asWorker(worker), 50, () => worker.postMessage(), {
      shouldResolve: () => true,
    });
    const rejected = expect(promise).rejects.toThrow('Parser timed out after 50ms');
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(worker.terminated).toBe(true);
    expect(worker.listenerCount('message')).toBe(0);
  });

  it('rejects with the thrown error when posting the message fails, and cleans up', async () => {
    const worker = new MockWorker();
    const { promise } = createParserPromise<string>(
      asWorker(worker),
      1000,
      () => {
        throw new Error('post failed');
      },
      { shouldResolve: () => true },
    );
    await expect(promise).rejects.toThrow('post failed');
    expect(worker.listenerCount('message')).toBe(0);
  });

  it('forwards non-final messages to onIntermediate, in order, and resolves on the final one', async () => {
    const worker = new MockWorker();
    const stages: string[] = [];
    const { promise } = createParserPromise<{ type: string; stage?: string }>(
      asWorker(worker),
      1000,
      () => worker.postMessage(),
      {
        shouldResolve: (data) => data.type !== 'progress',
        onIntermediate: (data) => {
          if (data.type === 'progress' && data.stage) stages.push(data.stage);
        },
      },
    );
    worker.dispatch('message', { data: { type: 'progress', stage: 'wasm' } });
    worker.dispatch('message', { data: { type: 'progress', stage: 'patterns' } });
    worker.dispatch('message', { data: { type: 'parsed' } });
    await expect(promise).resolves.toEqual({ type: 'parsed' });
    expect(stages).toEqual(['wasm', 'patterns']);
  });
});
