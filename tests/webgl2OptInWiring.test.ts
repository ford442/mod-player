import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Source-level invariants for the opt-in WebGL2 fallback (#462). vitest runs in
 * node without a DOM, so — like threeDModeLayout.test.ts — the layout/wiring
 * contracts are pinned against the source text; the live behavior is covered by
 * scripts/webgl2-optin-acceptance.mjs.
 */
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('opt-in WebGL2 fallback wiring (#462)', () => {
  const patternDisplay = read('components/PatternDisplay.tsx');
  const performanceStage = read('components/PerformanceStage.tsx');
  const rendererSelection = read('src/renderers/rendererSelection.ts');
  const optIn = read('src/renderers/webgl2/optIn.ts');
  const badge = read('src/renderers/webgl2/WebGL2FallbackBadge.tsx');
  const bloom = read('src/renderers/webgl2/WebGL2Bloom.ts');
  const glRenderer = read('src/renderers/webgl2/WebGL2PatternRenderer.ts');
  const webgpuHook = read('hooks/useWebGPURender.ts');

  it('swaps backend in place: one pattern <canvas>, never keyed, so the backend swap cannot remount it', () => {
    expect(patternDisplay.match(/ref=\{canvasRef\}/g)).toHaveLength(1);
    const tag = patternDisplay.match(/<canvas\s[^>]*?ref=\{canvasRef\}[\s\S]*?\/>/)?.[0] ?? '';
    expect(tag).toContain('data-shader-preview-source="true"');
    expect(tag).toContain('data-renderer={activeBackend}');
    expect(tag).not.toMatch(/\bkey=/);
  });

  it('PerformanceStage still keys PatternDisplay by shader (why the opt-in must be module state)', () => {
    expect(performanceStage.match(/<PatternDisplay/g)).toHaveLength(1);
    expect(performanceStage).toMatch(/<PatternDisplay[\s\S]{0,40}key=\{displayShaderFile\}/);
    expect(optIn).toMatch(/let buttonOptIn/);
  });

  it('the failure card offers the opt-in button, only after a confirmed WebGPU hard-fail', () => {
    expect(patternDisplay).toMatch(/useWebGPU && !webgpuAvailable && \(\s*deviceStatus === 'device-failed'/);
    const card = patternDisplay.slice(
      patternDisplay.indexOf('data-webgpu-viz-hard-fail'),
      patternDisplay.indexOf('<PatternDisplayDebugPanel'),
    );
    expect(card).toContain('data-webgl2-optin-button="true"');
    expect(card).toContain('Use WebGL2 visualizer');
    expect(card).toContain('activateWebGL2FromFailureCard(');
    // canvas already WebGPU-locked → no in-place swap possible, show a reload hint instead
    expect(card).toContain("getWebGPUHardFailStage() === 'lost'");
  });

  it('the click path never acquires a WebGPU device', () => {
    expect(patternDisplay).not.toMatch(/utils\/webgpuDevice/);
    expect(patternDisplay).not.toMatch(/requestDevice|requestAdapter/);
    const fn = rendererSelection.slice(rendererSelection.indexOf('export function activateWebGL2FromFailureCard'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('requestWebGL2OptIn(reason)');
    expect(body).toContain('notifyRendererPreferenceChanged()');
    expect(body).not.toMatch(/persistRendererPreference|localStorage|DEBUG_RENDERER/);
  });

  it('the opt-in is per page load — optIn.ts never touches web storage', () => {
    expect(stripComments(optIn)).not.toMatch(/localStorage|sessionStorage/);
    expect(stripComments(optIn)).not.toMatch(/^import /m); // no imports → no madge cycle through src/renderers
  });

  it('a persistent DOM badge renders whenever the WebGL2 backend is active', () => {
    expect(patternDisplay).toMatch(/\{useWebGL2 && <WebGL2FallbackBadge \/>\}/);
    expect(badge).toContain('data-webgl2-fallback-badge="true"');
    expect(badge).toContain('WebGL2 fallback — WebGPU not in use');
    expect(badge).not.toMatch(/<canvas|getContext/); // DOM, not drawn in GL
  });

  it('logs the activation warn from one module-guarded call site', () => {
    expect(patternDisplay.match(/logWebGL2FallbackActivation\(/g)).toHaveLength(1);
    expect(optIn).toContain('WebGL2 fallback active — WebGPU not in use (reason: ${reason})');
    expect(optIn.match(/console\.warn\(/g)).toHaveLength(1);
  });

  it('no stale "no WebGL2 shader fallback" log text remains in the WebGPU hook', () => {
    expect(webgpuHook).not.toContain('no WebGL2 shader fallback');
    expect(webgpuHook).toContain('WebGL2 fallback is opt-in');
  });

  it('the resolved backend + reason go through the DebugInfo sink, not component state', () => {
    expect(patternDisplay).toContain('useBackendDebugInfo(setDebugInfo, activeBackend, backendReason)');
    expect(read('src/renderers/hooks/useBackendDebugInfo.ts')).toContain('backendReason');
  });

  it('WebGL2 keeps the readPixels() contract and bloom passes replace (not add to) their targets', () => {
    expect(glRenderer).toMatch(/preserveDrawingBuffer:\s*true/);
    const composite = bloom.slice(bloom.indexOf('compositeToScreen()'), bloom.indexOf('private runBlur'));
    expect(composite.indexOf('gl.disable(gl.BLEND)')).toBeGreaterThan(-1);
    expect(composite.indexOf('gl.disable(gl.BLEND)')).toBeLessThan(composite.indexOf('this.runBlur('));
    expect(composite.lastIndexOf('gl.enable(gl.BLEND)')).toBeGreaterThan(composite.indexOf('gl.drawArrays'));
  });

  it('WebGL2 only repacks the cell texture when the matrix changes', () => {
    expect(glRenderer).toContain('uploadedCells');
    expect(glRenderer.match(/packPatternMatrixHighPrecision\(/g)).toHaveLength(1);
  });
});
