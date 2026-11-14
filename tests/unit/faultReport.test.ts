import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAULT_DB,
  FAULT_MAX_PER_MINUTE,
  FAULT_OBJECT_STORE,
  FAULT_RING_SIZE,
  buildDiagnosticsBundle,
  createIndexedDbFaultStore,
  createMemoryFaultStore,
  faultAssetKeys,
  flushFaultWrites,
  hashFileName,
  installGlobalFaultCapture,
  recordFault,
  registerFaultContext,
  sanitizeFaultText,
  sanitizeFaultValue,
  serializeDiagnosticsBundle,
  setFaultStoreForTests,
  type FaultEntry,
} from '../../utils/faultReport';
import { setSongFingerprint } from '../../utils/songIdentity';
import { createFakeIndexedDb } from '../helpers/fakeIndexedDb';

/** An `unhandledrejection` the way a browser dispatches it (Node has no PromiseRejectionEvent). */
function rejectionEvent(reason: unknown): Event {
  const event = new Event('unhandledrejection');
  Object.defineProperty(event, 'reason', { value: reason });
  return event;
}

function errorEvent(init: { message: string; error?: unknown; filename?: string; lineno?: number; colno?: number }): Event {
  const event = new Event('error');
  for (const [k, v] of Object.entries(init)) Object.defineProperty(event, k, { value: v });
  return event;
}

let clock = 0;

beforeEach(() => {
  clock = 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
  setFaultStoreForTests(null);
  setSongFingerprint(null);
});

describe('sanitizeFaultText', () => {
  it('hashes module / audio file names and keeps the extension', () => {
    const out = sanitizeFaultText('Failed to load "My Secret Song.xm" and backup_mix.IT, exported take-2.wav');
    expect(out).not.toMatch(/Secret|backup_mix|take-2/);
    expect(out).toContain(`"<file:${hashFileName('my secret song.xm')}>.xm"`);
    expect(out).toContain(`<file:${hashFileName('backup_mix.it')}>.it`);
    expect(out).toMatch(/<file:[0-9a-f]{8}>\.wav/);
  });

  it('drops URL origins and file:// paths but keeps the asset path and its ?v= key', () => {
    const out = sanitizeFaultText(
      'at https://player.example.com/xm-player/worklets/libopenmpt-worklet.wasm?v=4eae35f6bd:wasm-function[123]:0x4a2 '
        + 'from file:///home/alice/music/tune.mod',
    );
    expect(out).toContain('/xm-player/worklets/libopenmpt-worklet.wasm?v=4eae35f6bd:wasm-function[123]:0x4a2');
    expect(out).not.toContain('player.example.com');
    expect(out).not.toMatch(/alice|tune/);
  });

  it('leaves code identifiers and ordinary sentences alone', () => {
    const text = 'TypeError: Cannot read properties of undefined (reading "_openmpt_module_create_from_memory2")';
    expect(sanitizeFaultText(text)).toBe(text);
  });

  it('truncates long text', () => {
    const out = sanitizeFaultText('x'.repeat(10_000), 100);
    expect(out.length).toBeLessThan(130);
    expect(out).toMatch(/truncated\]$/);
  });
});

describe('sanitizeFaultValue', () => {
  it('reduces binary to its length and caps arrays', () => {
    const clean = sanitizeFaultValue({
      bytes: new Uint8Array(4096),
      buf: new ArrayBuffer(8),
      list: Array.from({ length: 200 }, (_, i) => i),
      fn: () => 1,
      nan: Number.NaN,
    }) as Record<string, unknown>;
    expect(clean.bytes).toBe('[binary 4096 bytes]');
    expect(clean.buf).toBe('[binary 8 bytes]');
    expect((clean.list as unknown[]).length).toBe(65);
    expect('fn' in clean).toBe(false);
    expect(clean.nan).toBe('NaN');
  });
});

describe('recordFault', () => {
  it('stamps the context: asset keys, song fingerprint, registered sections', () => {
    setFaultStoreForTests(createMemoryFaultStore());
    setSongFingerprint('ab'.repeat(32));
    const off = registerFaultContext('transport', () => ({ phase: 'playing', history: [{ event: 'start' }] }));
    const entry = recordFault({ kind: 'worker-error', source: 'parser-worker', message: 'boom' });
    off();
    expect(entry).not.toBeNull();
    expect(entry!.context.assets).toEqual(faultAssetKeys());
    expect(entry!.context.song).toEqual({ fingerprint: 'ab'.repeat(32) });
    expect(entry!.context.transport).toEqual({ phase: 'playing', history: [{ event: 'start' }] });
    expect(recordFault({ kind: 'worker-error', source: 'parser-worker', message: 'boom 2' })!.context.transport).toBeUndefined();
  });

  it('keeps a provider that throws from losing the fault', () => {
    setFaultStoreForTests(createMemoryFaultStore());
    const off = registerFaultContext('broken', () => {
      throw new Error('nope');
    });
    const entry = recordFault({ kind: 'error', source: 'window', error: new Error('real') });
    off();
    expect(entry!.message).toBe('Error: real');
    expect(entry!.context.broken).toEqual({ providerError: 'nope' });
  });

  it('folds a repeat within the dedupe window into the next stored entry', () => {
    setFaultStoreForTests(createMemoryFaultStore());
    expect(recordFault({ kind: 'gpu-error', source: 'webgpu', message: 'GPU-ERROR: x' })).not.toBeNull();
    clock += 100;
    expect(recordFault({ kind: 'gpu-error', source: 'webgpu', message: 'GPU-ERROR: x' })).toBeNull();
    clock += 100;
    expect(recordFault({ kind: 'gpu-error', source: 'webgpu', message: 'GPU-ERROR: x' })).toBeNull();
    clock += 5_000;
    expect(recordFault({ kind: 'gpu-error', source: 'webgpu', message: 'GPU-ERROR: x' })!.repeats).toBe(2);
  });

  it('rate-limits a fault storm and counts what it dropped', async () => {
    setFaultStoreForTests(createMemoryFaultStore());
    let stored = 0;
    for (let i = 0; i < FAULT_MAX_PER_MINUTE + 15; i++) {
      if (recordFault({ kind: 'error', source: 'window', message: `distinct ${i}` })) stored += 1;
    }
    expect(stored).toBe(FAULT_MAX_PER_MINUTE);
    const bundle = await buildDiagnosticsBundle();
    expect(bundle.recorder.dropped).toBe(15);
    clock += 61_000;
    expect(recordFault({ kind: 'error', source: 'window', message: 'after the minute' })).not.toBeNull();
  });

  it('guesses which libopenmpt pair a wasm frame belongs to', () => {
    setFaultStoreForTests(createMemoryFaultStore());
    expect(recordFault({ kind: 'worklet-fault', source: 'worklet:process-trap', message: 'a' })!.wasmPair).toBe('libopenmpt-worklet');
    expect(recordFault({ kind: 'worker-error', source: 'create-worker', message: 'b' })!.wasmPair).toBe('libopenmpt-playback');
    expect(recordFault({ kind: 'worker-error', source: 'parser-worker', message: 'c' })!.wasmPair).toBe('libopenmpt-worklet');
    vi.stubGlobal('crossOriginIsolated', true);
    try {
      expect(recordFault({ kind: 'worklet-fault', source: 'worklet:processor-error', message: 'd' })!.wasmPair).toBe('libopenmpt-playback');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('IndexedDB ring', () => {
  it('an unhandled rejection lands in IndexedDB', async () => {
    const idb = createFakeIndexedDb();
    setFaultStoreForTests(createIndexedDbFaultStore(idb.factory));
    const target = new EventTarget();
    const uninstall = installGlobalFaultCapture(target);
    try {
      target.dispatchEvent(rejectionEvent(new TypeError('the worklet went away')));
      target.dispatchEvent(rejectionEvent('a plain string'));
      target.dispatchEvent(errorEvent({ message: 'Script error.', filename: 'https://player.example.com/assets/index.js', lineno: 3, colno: 9 }));
      target.dispatchEvent(errorEvent({ message: 'ResizeObserver loop completed with undelivered notifications.' }));
      await flushFaultWrites();
    } finally {
      uninstall();
    }
    const rows = idb.rows(FAULT_DB, FAULT_OBJECT_STORE) as FaultEntry[];
    expect(rows.map((r) => [r.kind, r.message])).toEqual([
      ['unhandledrejection', 'TypeError: the worklet went away'],
      ['unhandledrejection', 'Unhandled rejection: a plain string'],
      ['error', 'Script error. (/assets/index.js:3:9)'],
    ]);
    expect(rows[0]!.stack).toMatch(/TypeError: the worklet went away/);
  });

  it('installs once per target and stops listening after uninstall', async () => {
    setFaultStoreForTests(createMemoryFaultStore());
    const target = new EventTarget();
    const uninstall = installGlobalFaultCapture(target);
    installGlobalFaultCapture(target)();
    target.dispatchEvent(rejectionEvent(new Error('one')));
    uninstall();
    clock += 5_000;
    target.dispatchEvent(rejectionEvent(new Error('two')));
    expect((await buildDiagnosticsBundle()).faults.map((f) => f.message)).toEqual(['Error: one']);
  });

  it(`keeps only the last ${FAULT_RING_SIZE} entries`, async () => {
    const idb = createFakeIndexedDb();
    const store = createIndexedDbFaultStore(idb.factory);
    setFaultStoreForTests(store);
    for (let i = 0; i < FAULT_RING_SIZE + 7; i++) {
      clock += 4_000; // outside the dedupe window, ≤ the per-minute budget
      recordFault({ kind: 'error', source: 'window', message: `fault ${i}` });
    }
    await flushFaultWrites();
    const listed = await store.list();
    expect(listed).toHaveLength(FAULT_RING_SIZE);
    expect(listed[0]!.message).toBe('fault 7');
    expect(listed.at(-1)!.message).toBe(`fault ${FAULT_RING_SIZE + 6}`);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it('falls back to the in-memory copy when IndexedDB cannot open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setFaultStoreForTests(createIndexedDbFaultStore(createFakeIndexedDb({ failOpen: true }).factory));
    recordFault({ kind: 'sp-fallback', source: 'worklet', message: 'fell back' });
    const bundle = await buildDiagnosticsBundle();
    expect(bundle.recorder.storage).toBe('memory');
    expect(bundle.recorder.storeErrors).toBe(1);
    expect(bundle.faults.map((f) => f.message)).toEqual(['fell back']);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('diagnostics bundle privacy', () => {
  it('contains no module bytes and no file names', async () => {
    setFaultStoreForTests(createIndexedDbFaultStore(createFakeIndexedDb().factory));
    setSongFingerprint('cd'.repeat(32));
    const moduleBytes = new Uint8Array(2048).map((_, i) => (i * 37) & 255);
    const off = registerFaultContext('load', () => ({
      fileData: moduleBytes,
      fileName: 'Private Collection/02 - Hidden Track.s3m',
      recent: ['Song One.mod', 'song two.xm'],
    }));
    try {
      recordFault({
        kind: 'error',
        source: 'window',
        error: new Error('libopenmpt rejected "02 - Hidden Track.s3m" (from https://cdn.example.org/u/alice/Song%20One.mod)'),
      });
      recordFault({ kind: 'worker-error', source: 'parser-worker', error: { file: 'Unreleased.it', bytes: moduleBytes.buffer } });
      const json = serializeDiagnosticsBundle(await buildDiagnosticsBundle());

      expect(json).not.toMatch(/Hidden|Private|Song One|Song%20One|song two|Unreleased|alice|cdn\.example\.org/i);
      // A file name (anything ending in a module extension) only appears as a hash.
      expect(json).not.toMatch(/[\w%-]+\.(?:mod|xm|s3m|it)\b/i);
      // No serialised byte arrays: no run of 16+ comma-separated small numbers.
      expect(json).not.toMatch(/(?:\d{1,3},\s*){16}/);
      expect(json).toContain('[binary 2048 bytes]');
      expect(json).toContain('cd'.repeat(32));
    } finally {
      off();
    }
  });
});
