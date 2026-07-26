/**
 * WebGL hybrid overlay layout parity with WebGPU (#351).
 */
import { describe, expect, it } from 'vitest';
import { LAYOUT_MODES } from '../utils/geometryConstants';
import {
  horizontalPadRowRemapEnabled,
  resolveOverlayLayout,
  resolveWebGpuVisibleRows,
} from '../utils/overlayLayout';

describe('resolveOverlayLayout', () => {
  it('horizontal v0.21 uses 32/64 step pages from stepsLength', () => {
    const base = {
      shaderFile: 'patternv0.21.wgsl',
      canvasWidth: 1024,
      canvasHeight: 1024,
      matrixNumRows: 64,
      numChannels: 5,
      padTopChannel: true,
    };
    const at32 = resolveOverlayLayout({ ...base, stepsLength: 32 });
    const at64 = resolveOverlayLayout({ ...base, stepsLength: 64 });

    expect(at32.layoutMode).toBe(LAYOUT_MODES.HORIZONTAL_32);
    expect(at32.overlayVisibleSteps).toBe(32);
    expect(at32.overlayTotalInstances).toBe(32 * 5);
    expect(at32.uniformRows).toBe(64);
    expect(at32.horizontal?.hasHeaderRow).toBe(false);

    expect(at64.layoutMode).toBe(LAYOUT_MODES.HORIZONTAL_64);
    expect(at64.overlayVisibleSteps).toBe(64);
    expect(at64.horizontal?.cellW).toBeCloseTo((1024 * 0.9) / 64, 4);
    expect(at32.horizontal?.cellW).toBeCloseTo((1024 * 0.9) / 32, 4);
  });

  it('v0.40 enables header-row remap for pad channel', () => {
    expect(horizontalPadRowRemapEnabled('patternv0.40.wgsl', true)).toBe(true);
    expect(horizontalPadRowRemapEnabled('patternv0.21.wgsl', true)).toBe(false);

    const layout = resolveOverlayLayout({
      shaderFile: 'patternv0.40.wgsl',
      canvasWidth: 1024,
      canvasHeight: 1024,
      matrixNumRows: 64,
      numChannels: 5,
      padTopChannel: true,
      stepsLength: 32,
    });
    expect(layout.horizontal?.hasHeaderRow).toBe(true);
    expect(layout.horizontal?.dataChannels).toBe(4);
  });

  it('circular v0.50b caps overlay rows with stepsLength', () => {
    const layout = resolveOverlayLayout({
      shaderFile: 'patternv0.50b.wgsl',
      canvasWidth: 1024,
      canvasHeight: 1024,
      matrixNumRows: 64,
      numChannels: 5,
      padTopChannel: true,
      stepsLength: 32,
    });
    expect(layout.overlayVisibleSteps).toBe(32);
    expect(layout.uniformRows).toBe(32);
    expect(layout.overlayTotalInstances).toBe(32 * 5);
    expect(layout.horizontal).toBeNull();
  });

  it('circular v0.46 keeps full matrix rows with paging', () => {
    const layout = resolveOverlayLayout({
      shaderFile: 'patternv0.46.wgsl',
      canvasWidth: 1024,
      canvasHeight: 1024,
      matrixNumRows: 64,
      numChannels: 5,
      padTopChannel: true,
      stepsLength: 32,
    });
    expect(layout.overlayVisibleSteps).toBe(64);
    expect(layout.uniformRows).toBe(64);
  });
});

describe('resolveWebGpuVisibleRows', () => {
  it('matches steps-driven circular shaders', () => {
    expect(resolveWebGpuVisibleRows('patternv0.50b.wgsl', 64, 32)).toBe(32);
    expect(resolveWebGpuVisibleRows('patternv0.42.wgsl', 64, 32)).toBe(64);
  });
});
