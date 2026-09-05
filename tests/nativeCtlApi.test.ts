import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('#412 native ctl / mute / one-module parse', () => {
  const wrapper = readFileSync(join(ROOT, 'cpp/openmpt_wrapper.cpp'), 'utf8');
  const worklet = readFileSync(join(ROOT, 'cpp/worklet_processor.cpp'), 'utf8');
  const engine = readFileSync(join(ROOT, 'audio-worklet/OpenMPTWorkletEngine.ts'), 'utf8');
  const moduleActions = readFileSync(join(ROOT, 'hooks/libOpenMPT/createModuleActions.ts'), 'utf8');
  const runInit = readFileSync(join(ROOT, 'hooks/libOpenMPT/runInit.ts'), 'utf8');
  const buildSh = readFileSync(join(ROOT, 'scripts/build-wasm.sh'), 'utf8');

  it('creates modules via openmpt_module_ext (interactive mute)', () => {
    expect(wrapper).toContain('openmpt_module_ext_create_from_memory');
    expect(wrapper).toContain('set_channel_mute_status');
    expect(wrapper).toContain('openmpt_module_ctl_set_text');
    expect(wrapper).toContain('OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH, 8');
  });

  it('exports mute / render / ctl KEEPAlives with audio-thread atomics', () => {
    expect(worklet).toContain('void set_channel_mute(');
    expect(worklet).toContain('void set_render_param(');
    expect(worklet).toContain('void ctl_set_text(');
    expect(worklet).toContain('g_muteBits');
    expect(worklet).toContain('apply_persisted_controls');
    expect(worklet).toContain('emscripten_get_heap_size');
    expect(worklet).toContain('mallinfo');
  });

  it('TypeScript engine exposes setChannelMute / setInterpolationLength / ctlSetText', () => {
    expect(engine).toContain('setChannelMute(');
    expect(engine).toContain('setInterpolationLength(');
    expect(engine).toContain('ctlSetText(');
    expect(engine).toContain('_set_channel_mute');
    expect(engine).toContain('OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH');
  });

  it('skips wasm2js parser worker when native parse is active', () => {
    expect(moduleActions).toContain("activeEngineRef.current === 'native-worklet'");
    expect(moduleActions).toContain('!useNativeParse && !isLibReadyForParse');
    expect(moduleActions).toContain('parseModuleWithNative');
    expect(runInit).toContain('__XASM1_NATIVE__');
  });

  it('emcc contract includes STACK_SIZE, no-exceptions, and new exports', () => {
    expect(buildSh).toContain('-sSTACK_SIZE=131072');
    expect(buildSh).toContain('-fno-exceptions');
    expect(buildSh).not.toContain('-sDISABLE_EXCEPTION_CATCHING=1');
    expect(buildSh).toContain('libopenmpt_c.cpp');
    expect(buildSh).toContain("'_set_channel_mute'");
    expect(buildSh).toContain("'_set_render_param'");
    expect(buildSh).toContain("'_ctl_set_text'");
    expect(buildSh).toContain('g_module on the AudioWorklet thread + g_metaModule');
  });
});
