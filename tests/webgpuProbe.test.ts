import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectBrowserBrand,
  getLastWebGPUProbeReport,
  getWebGPUHardFailStage,
  getWebGPUHardFailStatus,
  isWebGPUSessionBlocked,
  markWebGPUSessionFailed,
  publishWebGPUProbeReady,
  resetWebGPUProbeStateForTests,
} from '../utils/webgpuProbe';
import { requestWebGPUDevice } from '../utils/webgpuDevice';

describe('webgpuProbe', () => {
  beforeEach(() => {
    resetWebGPUProbeStateForTests();
  });

  afterEach(() => {
    resetWebGPUProbeStateForTests();
  });

  it('detects browser brand from userAgent', () => {
    const chrome = detectBrowserBrand({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    } as Navigator);
    expect(chrome).toBe('Chrome');

    const edge = detectBrowserBrand({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    } as Navigator);
    expect(edge).toBe('Edge');
  });

  it('markWebGPUSessionFailed blocks further requestDevice calls (#395)', async () => {
    markWebGPUSessionFailed('device', 'unit-test failure');
    expect(isWebGPUSessionBlocked()).toBe(true);
    const report = getLastWebGPUProbeReport();
    expect(report?.ok).toBe(false);
    expect(report?.stage).toBe('device');
    expect(report?.error).toContain('unit-test failure');
    expect(window.__WEBGPU_PROBE__?.sessionBlocked).toBe(true);

    await expect(requestWebGPUDevice()).rejects.toThrow(/session blocked/i);
  });

  it('publishWebGPUProbeReady clears session block', () => {
    markWebGPUSessionFailed('adapter', 'gone');
    expect(isWebGPUSessionBlocked()).toBe(true);
    publishWebGPUProbeReady({ vendor: 'test' });
    expect(isWebGPUSessionBlocked()).toBe(false);
    expect(getLastWebGPUProbeReport()?.ok).toBe(true);
  });

  it('keeps the first hard-fail status/stage when a remount re-marks the session (#462)', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(getWebGPUHardFailStatus()).toBeNull();
    markWebGPUSessionFailed('adapter', 'requestAdapter returned null');
    expect(getWebGPUHardFailStatus()).toBe('no-adapter');
    expect(getWebGPUHardFailStage()).toBe('adapter');
    // PatternDisplay remount: blocked session rethrows as device-failed and is marked again.
    markWebGPUSessionFailed('device', 'WebGPU session blocked (no further requestDevice)');
    expect(getWebGPUHardFailStatus()).toBe('no-adapter');
    expect(getWebGPUHardFailStage()).toBe('adapter');
    expect(getLastWebGPUProbeReport()?.stage).toBe('device');
    quiet.mockRestore();
  });

  it.each([
    ['api', 'unsupported'],
    ['adapter', 'no-adapter'],
    ['device', 'device-failed'],
    ['canvas', 'device-failed'],
    ['lost', 'device-failed'],
  ] as const)('maps stage %s → status %s', (stage, status) => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    markWebGPUSessionFailed(stage, 'x');
    expect(getWebGPUHardFailStatus()).toBe(status);
    quiet.mockRestore();
  });

  it('publishWebGPUProbeReady clears the remembered hard-fail', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    markWebGPUSessionFailed('adapter', 'gone');
    publishWebGPUProbeReady();
    expect(getWebGPUHardFailStatus()).toBeNull();
    expect(getWebGPUHardFailStage()).toBeNull();
    quiet.mockRestore();
  });

  it('blocked session never reaches requestAdapter', async () => {
    markWebGPUSessionFailed('api', 'blocked');
    const gpu = (navigator as { gpu?: { requestAdapter: () => Promise<null> } }).gpu;
    if (!gpu) {
      await expect(requestWebGPUDevice()).rejects.toThrow(/session blocked/i);
      return;
    }
    const spy = vi.spyOn(gpu, 'requestAdapter');
    await expect(requestWebGPUDevice()).rejects.toThrow(/session blocked/i);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
