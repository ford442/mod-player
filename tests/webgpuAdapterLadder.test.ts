/** #492 — requestAdapter({ featureLevel: 'compatibility' }) as the last rung of the device ladder. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adapterRequestLadder,
  attachDeviceLostHandler,
  COMPATIBILITY_PREFERRED_LIMITS,
  requestWebGPUDevice,
  WebGPUInitError,
} from '../utils/webgpuDevice';
import { isWebGPUSessionBlocked, resetWebGPUProbeStateForTests } from '../utils/webgpuProbe';

type Step = string;

/** A fake adapter whose requestDevice fails the first `failDevice` times. */
function fakeAdapter(name: string, log: Step[], failDevice: number, limits: Record<string, number> = {}) {
  let attempts = 0;
  const device = { features: new Set<string>(), limits: { maxStorageBufferBindingSize: 1 << 24 }, destroy: vi.fn() };
  return {
    adapter: {
      features: new Set<string>(),
      limits: { maxStorageBufferBindingSize: 1 << 28, maxStorageBuffersPerShaderStage: 8, ...limits },
      info: { vendor: name },
      requestDevice: vi.fn(async (desc?: GPUDeviceDescriptor) => {
        attempts += 1;
        log.push(`${name}.requestDevice#${attempts}${desc?.requiredLimits ? '(limits)' : desc ? '(features)' : '(bare)'}`);
        if (attempts <= failDevice) throw new Error(`${name} device rung ${attempts} refused`);
        return device;
      }),
    },
    device,
  };
}

function installGpu(adapters: { core: unknown; compatibility: unknown }, log: Step[]) {
  const requestAdapter = vi.fn(async (options?: GPURequestAdapterOptions) => {
    const level = options?.featureLevel === 'compatibility' ? 'compatibility' : 'core';
    log.push(`requestAdapter(${level})`);
    return adapters[level];
  });
  vi.stubGlobal('navigator', {
    gpu: { requestAdapter, getPreferredCanvasFormat: () => 'bgra8unorm' },
    userAgent: 'vitest',
  });
  return requestAdapter;
}

describe('adapter ladder (#492)', () => {
  let log: Step[];

  beforeEach(() => {
    log = [];
    resetWebGPUProbeStateForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetWebGPUProbeStateForTests();
  });

  it('orders core first and compatibility last, same power preference', () => {
    expect(adapterRequestLadder('low-power')).toEqual([
      { powerPreference: 'low-power' },
      { powerPreference: 'low-power', featureLevel: 'compatibility' },
    ]);
  });

  it('never asks for a compatibility adapter when the core rungs work', async () => {
    const core = fakeAdapter('core', log, 0);
    const requestAdapter = installGpu({ core: core.adapter, compatibility: null }, log);
    const result = await requestWebGPUDevice({ liteMode: false });
    expect(result.device).toBe(core.device);
    expect(result.featureLevel).toBe('core');
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestAdapter).toHaveBeenCalledWith({ powerPreference: 'high-performance' });
    expect(log).toEqual(['requestAdapter(core)', 'core.requestDevice#1(limits)']);
  });

  it('keeps the existing soft-limits rungs on the core adapter before giving up on it', async () => {
    const core = fakeAdapter('core', log, 2);
    installGpu({ core: core.adapter, compatibility: null }, log);
    const result = await requestWebGPUDevice();
    expect(result.featureLevel).toBe('core');
    expect(log).toEqual([
      'requestAdapter(core)',
      'core.requestDevice#1(limits)',
      'core.requestDevice#2(features)',
      'core.requestDevice#3(bare)',
    ]);
  });

  it('tries the compatibility adapter only after all three core device rungs fail', async () => {
    const core = fakeAdapter('core', log, 3);
    const compat = fakeAdapter('compat', log, 0, { maxStorageBuffersInVertexStage: 4, maxStorageBuffersInFragmentStage: 4 });
    installGpu({ core: core.adapter, compatibility: compat.adapter }, log);
    const result = await requestWebGPUDevice();
    expect(result.device).toBe(compat.device);
    expect(result.featureLevel).toBe('compatibility');
    expect(log).toEqual([
      'requestAdapter(core)',
      'core.requestDevice#1(limits)',
      'core.requestDevice#2(features)',
      'core.requestDevice#3(bare)',
      'requestAdapter(compatibility)',
      'compat.requestDevice#1(limits)',
    ]);
    // Compatibility defaults allow 0 storage buffers in the vertex stage; ask for the adapter max.
    expect(compat.adapter.requestDevice.mock.calls[0]?.[0]?.requiredLimits).toMatchObject({
      maxStorageBuffersInVertexStage: 4,
      maxStorageBuffersInFragmentStage: 4,
    });
    expect(Object.keys(COMPATIBILITY_PREFERRED_LIMITS)).toContain('maxStorageBuffersInVertexStage');
    // The core rung never asks for compatibility-only limits.
    expect(core.adapter.requestDevice.mock.calls[0]?.[0]?.requiredLimits).not.toHaveProperty('maxStorageBuffersInVertexStage');
  });

  it('reaches compatibility-only hardware (core adapter null)', async () => {
    const compat = fakeAdapter('compat', log, 0);
    installGpu({ core: null, compatibility: compat.adapter }, log);
    const result = await requestWebGPUDevice({ liteMode: true });
    expect(result.featureLevel).toBe('compatibility');
    expect(log).toEqual(['requestAdapter(core)', 'requestAdapter(compatibility)', 'compat.requestDevice#1(limits)']);
    expect(isWebGPUSessionBlocked()).toBe(false);
  });

  it('hard-fails with no-adapter when neither rung yields an adapter', async () => {
    installGpu({ core: null, compatibility: null }, log);
    const err = await requestWebGPUDevice().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WebGPUInitError);
    expect((err as WebGPUInitError).status).toBe('no-adapter');
    expect((err as Error).message).toMatch(/requestAdapter returned null/);
    expect(isWebGPUSessionBlocked()).toBe(true);
    expect(log).toEqual(['requestAdapter(core)', 'requestAdapter(compatibility)']);
  });

  it('reports the core device failure when the compatibility rung has no adapter', async () => {
    const core = fakeAdapter('core', log, 3);
    installGpu({ core: core.adapter, compatibility: null }, log);
    const err = await requestWebGPUDevice().catch((e: unknown) => e);
    expect((err as WebGPUInitError).status).toBe('device-failed');
    expect((err as Error).message).toMatch(/requestDevice failed: core device rung 3 refused/);
  });
});

describe('attachDeviceLostHandler (#492 — dead `intentional` branch removed)', () => {
  function lostDevice() {
    let lose: (info: GPUDeviceLostInfo) => void = () => {};
    const device = { lost: new Promise<GPUDeviceLostInfo>((r) => { lose = r; }) } as unknown as GPUDevice;
    return { device, lose: (reason: GPUDeviceLostReason) => lose({ reason, message: '' } as GPUDeviceLostInfo) };
  }

  it("flags only reason 'destroyed' as intentional", async () => {
    for (const [reason, intentional] of [['destroyed', true], ['unknown', false]] as const) {
      const { device, lose } = lostDevice();
      const onLost = vi.fn();
      attachDeviceLostHandler(device, { onLost });
      lose(reason);
      await vi.waitFor(() => expect(onLost).toHaveBeenCalledTimes(1));
      expect(onLost.mock.calls[0]?.[1]).toBe(intentional);
    }
  });

  it('delivers nothing after detach', async () => {
    const { device, lose } = lostDevice();
    const onLost = vi.fn();
    const detach = attachDeviceLostHandler(device, { onLost });
    detach();
    lose('unknown');
    await device.lost;
    await Promise.resolve();
    expect(onLost).not.toHaveBeenCalled();
  });
});
