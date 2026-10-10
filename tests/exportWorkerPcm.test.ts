/** Export worker protocol (#453): the FX path asks for dry PCM; the WAV path is unchanged. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../workers/openmpt-export.worker.ts?worker&url', () => ({ default: '/worker.js' }));

import { exportPcmInWorker, exportWavInWorker } from '../utils/exportWorker';

type Listener = (event: { data: unknown }) => void;

function fakeWorker(reply: (request: Record<string, unknown>) => unknown) {
  const listeners = new Map<string, Listener[]>();
  const posted: Record<string, unknown>[] = [];
  return {
    posted,
    addEventListener: (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: Listener) =>
      listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== fn)),
    postMessage(request: Record<string, unknown>) {
      posted.push(request);
      queueMicrotask(() => {
        for (const fn of listeners.get('message') ?? []) fn({ data: reply(request) });
      });
    },
    terminate: vi.fn(),
  } as unknown as Worker & { posted: Record<string, unknown>[] };
}

afterEach(() => vi.unstubAllGlobals());

describe('export worker protocol (#453)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { ...globalThis.window, setTimeout, clearTimeout });
  });

  it('PCM mode requests output: "pcm" and resolves with the dry float render', async () => {
    const left = new Float32Array([0.1, 0.2]);
    const worker = fakeWorker(() => ({
      type: 'complete-pcm', left, right: left, fileName: 'a.wav', sampleRate: 44100,
      metadataDurationSeconds: 1, renderedDurationSeconds: 1, frameCount: 2,
    }));
    const result = await exportPcmInWorker(worker, { fileData: new Uint8Array(4), fileName: 'a.mod' });
    expect(worker.posted[0]).toMatchObject({ type: 'render-wav', output: 'pcm' });
    expect(result.type).toBe('complete-pcm');
    expect(result.left).toBe(left);
  });

  it('WAV mode sends the request exactly as before (no output field)', async () => {
    const worker = fakeWorker(() => ({
      type: 'complete', wav: new ArrayBuffer(44), fileName: 'a.wav', sampleRate: 44100,
      metadataDurationSeconds: 1, renderedDurationSeconds: 1, frameCount: 0,
    }));
    const result = await exportWavInWorker(worker, { fileData: new Uint8Array(4), fileName: 'a.mod' });
    expect(worker.posted[0]).not.toHaveProperty('output');
    expect(result.type).toBe('complete');
  });
});
