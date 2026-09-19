import { describe, expect, it, vi } from 'vitest';
import { waitForRuntimeInitialized, type EmscriptenRuntimeState } from '../audio-worklet/libRuntimeReady';

describe('waitForRuntimeInitialized', () => {
  it('resolves immediately when the runtime already ran', async () => {
    await expect(waitForRuntimeInitialized({ calledRun: true }, 50)).resolves.toBeUndefined();
  });

  it('waits for onRuntimeInitialized even when `_openmpt_*` stubs already exist (regression: "_malloc is not a function")', async () => {
    // emsdk 3.1.51 defines lazy export wrappers at glue-eval time, long before instantiate finishes.
    const lib = { _openmpt_module_create_from_memory2: () => 0 } as EmscriptenRuntimeState & Record<string, unknown>;
    let settled = false;
    const p = waitForRuntimeInitialized(lib, 1000).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    lib.onRuntimeInitialized?.();
    await p;
    expect(settled).toBe(true);
  });

  it('chains a pre-existing onRuntimeInitialized handler (index.html installs one)', async () => {
    const prev = vi.fn();
    const lib: EmscriptenRuntimeState = { onRuntimeInitialized: prev };
    const p = waitForRuntimeInitialized(lib, 1000);
    lib.onRuntimeInitialized?.();
    await p;
    expect(prev).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately with the reason when the glue aborts during init', async () => {
    const lib: EmscriptenRuntimeState = {};
    const p = waitForRuntimeInitialized(lib, 60_000, 'WASM');
    lib.onAbort?.('both async and sync fetching of the wasm failed');
    await expect(p).rejects.toThrow(/aborted during init: both async and sync fetching of the wasm failed/);
  });

  it('rejects on timeout', async () => {
    vi.useFakeTimers();
    try {
      const p = waitForRuntimeInitialized({}, 25_000);
      const assertion = expect(p).rejects.toThrow(/onRuntimeInitialized timeout \(25000 ms\)/);
      await vi.advanceTimersByTimeAsync(25_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
