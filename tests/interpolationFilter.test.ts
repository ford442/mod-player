import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  INTERPOLATION_CUBIC,
  INTERPOLATION_SINC_LP,
  OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH,
  OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT,
} from '../utils/openmptRenderParams';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('libopenmpt interpolation filter (Sinc+LP)', () => {
  const params = readFileSync(join(ROOT, 'utils/openmptRenderParams.ts'), 'utf8');
  const offline = readFileSync(join(ROOT, 'utils/offlineRender.ts'), 'utf8');
  const worklet = readFileSync(join(ROOT, 'public/worklets/openmpt-worklet.js'), 'utf8');
  const scriptProcessor = readFileSync(
    join(ROOT, 'hooks/audioGraph/scriptProcessorFallback.ts'),
    'utf8',
  );
  const nativePlay = readFileSync(
    join(ROOT, 'hooks/audioGraph/startNativePlayback.ts'),
    'utf8',
  );
  const wrapper = readFileSync(join(ROOT, 'cpp/openmpt_wrapper.cpp'), 'utf8');
  const nativeWorklet = readFileSync(join(ROOT, 'cpp/worklet_processor.cpp'), 'utf8');
  const engine = readFileSync(join(ROOT, 'audio-worklet/OpenMPTWorkletEngine.ts'), 'utf8');

  it('uses official C API indices (param 3 is interpolation, 2 is stereo sep)', () => {
    expect(OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT).toBe(2);
    expect(OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH).toBe(3);
    expect(INTERPOLATION_CUBIC).toBe(4);
    expect(INTERPOLATION_SINC_LP).toBe(8);
    expect(params).toContain('OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH = 3');
  });

  it('offline export sets Sinc+LP on the interpolation param, not stereo sep', () => {
    expect(offline).toContain('OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH');
    expect(offline).toContain('INTERPOLATION_SINC_LP');
    expect(offline).not.toMatch(/RENDER_INTERPOLATIONFILTER_LENGTH\s*=\s*2/);
    expect(offline).not.toMatch(/_openmpt_module_set_render_param\([^)]*,\s*2\s*,/);
  });

  it('JS worklet defaults to Sinc+LP (8) on param 3 and re-applies the stored length after every create', () => {
    expect(worklet).toMatch(/OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH\s*=\s*3/);
    // Real wasm makes sinc-8 affordable (docs/planning/native-engine-bench-notes.md); the old
    // wasm2js glue hard-capped this at 4.
    expect(worklet).toMatch(/DEFAULT_INTERPOLATION_LENGTH\s*=\s*8/);
    expect(worklet).toMatch(
      /_openmpt_module_set_render_param\(\s*this\.modulePtr\s*,\s*OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH\s*,\s*this\._interpolationLength\s*,?\s*\)/,
    );
    expect(worklet).not.toMatch(/_openmpt_module_set_render_param\(\s*this\.modulePtr\s*,\s*2\s*,/);
    // A main-thread setRenderParam(3, n) must survive module reloads (create resets render params).
    expect(worklet).toMatch(/this\._interpolationLength\s*=\s*msg\.value/);
  });

  it('JS playback start sends the resolved length (?interp= / default 8) before load', () => {
    const start = readFileSync(join(ROOT, 'hooks/audioGraph/startJsWorkletPlayback.ts'), 'utf8');
    expect(start).toContain('resolveJsInterpolationLength()');
    expect(start).toMatch(/postSetRenderParam\(\s*OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH/);
    expect(start.indexOf('postSetRenderParam(')).toBeLessThan(start.indexOf('postLoad('));
  });

  it('ScriptProcessor fallback stays cubic on param 3 (main-thread callback budget)', () => {
    expect(scriptProcessor).toContain('OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH');
    expect(scriptProcessor).toContain('INTERPOLATION_CUBIC');
    expect(scriptProcessor).not.toMatch(/_openmpt_module_set_render_param\([^)]*,\s*2\s*,/);
  });

  it('native live playback applies Sinc+LP after load', () => {
    expect(nativePlay).toContain('setInterpolationLength(INTERPOLATION_SINC_LP)');
    expect(wrapper).toContain('OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH, 8');
    expect(nativeWorklet).toMatch(/g_interpLength\s*=\s*8/);
    expect(engine).toContain('OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH');
  });
});
