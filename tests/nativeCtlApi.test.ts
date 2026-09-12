import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('#412 native ctl / mute / one-module parse', () => {
  const wrapper = readFileSync(join(ROOT, 'cpp/openmpt_wrapper.cpp'), 'utf8');
  const worklet = readFileSync(join(ROOT, 'cpp/worklet_processor.cpp'), 'utf8');
  const engine = readFileSync(join(ROOT, 'audio-worklet/OpenMPTWorkletEngine.ts'), 'utf8');
  const nativePlay = readFileSync(join(ROOT, 'hooks/audioGraph/startNativePlayback.ts'), 'utf8');
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

  it('does not walk pattern cells on the 16 ms poll (shared-heap stall at order change)', () => {
    const pollIdx = engine.indexOf('private startPolling()');
    expect(pollIdx).toBeGreaterThan(0);
    const pollBody = engine.slice(pollIdx, engine.indexOf('private stopPolling()'));
    expect(pollBody).not.toContain('readPatternData');
    expect(pollBody).toContain('if (this.pcmCapture)');
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
    expect(buildSh).toContain('-sDISABLE_EXCEPTION_CATCHING=1');
    expect(buildSh).toContain('libopenmpt_c.cpp');
    expect(buildSh).toContain("'_set_channel_mute'");
    expect(buildSh).toContain("'_set_render_param'");
    expect(buildSh).toContain("'_ctl_set_text'");
    expect(buildSh).toContain('g_module on the AudioWorklet thread + g_metaModule');
    expect(buildSh).toContain('--post-js');
    expect(buildSh).toContain('patch-native-glue.mjs');
  });

  // Regression: 7572ef8 put -fno-exceptions in COMPILE_FLAGS, which the single
  // combined compile+link emcc call forwarded to the link. Emscripten then set
  // DISABLE_EXCEPTION_THROWING=1 and wasm-ld could not resolve __cxa_throw /
  // __cxa_allocate_exception from libopenmpt.a. native-full-build red 2026-09-05.
  it('keeps -fno-exceptions/-fno-rtti off the link line (two-phase build)', () => {
    expect(buildSh).toContain('CXX_ONLY_FLAGS=(-fno-exceptions -fno-rtti)');
    for (const group of ['COMPILE_FLAGS', 'LINK_FLAGS']) {
      for (const block of buildSh.match(new RegExp(`${group}=\\(([^)]*)\\)`, 'g')) ?? []) {
        expect(block).not.toMatch(/-fno-exceptions|-fno-rtti/);
      }
    }
  });

  it('links with em++ so libc++/libc++abi back libopenmpt.a', () => {
    // With .o inputs there is no .cpp suffix left for emcc to infer C++ from,
    // so it would skip libc++ and `operator new` would come back undefined.
    expect(buildSh).toMatch(/^em\+\+ \\$/m);
    expect(buildSh).toContain('-c "$CPP_DIR/${src}.cpp"');
  });

  it('compiles debug objects with the atomics/bulk-memory WASM_WORKERS needs', () => {
    // wasm-ld rejects --shared-memory against objects built without these.
    const debugFlags = buildSh.match(/COMPILE_FLAGS=\(-O0 -g -DDEBUG[^)]*\)/)?.[0] ?? '';
    expect(debugFlags).toContain('-mbulk-memory');
    expect(debugFlags).toContain('-matomics');
  });

  it('native play uses Sinc+LP interpolation (length 8) and demand-driven PCM capture', () => {
    expect(nativePlay).toContain('setInterpolationLength(INTERPOLATION_SINC_LP)');
    expect(nativePlay).toContain('setPcmCapture');
    expect(nativePlay).toContain('setPcmDemandListener');
    expect(nativePlay).toContain('shouldReloadNativeModule');
    expect(nativePlay).toContain('ensurePcmRing');
  });

  // libopenmpt signals bad arguments by throwing, and the native build links
  // libc++abi-noexcept — so a throw is abort(), which inside audio_process_cb
  // kills the worklet. Verified against the real wrapper: setChannelMute past
  // the module's channel count, an unknown render param id, and an unknown ctl
  // key each aborted the wasm module before these guards.
  it('validates ctl/mute/render arguments before calling libopenmpt', () => {
    const mute = wrapper.slice(
      wrapper.indexOf('void OpenMPTModule::setChannelMute'),
      wrapper.indexOf('void OpenMPTModule::setRenderParam'),
    );
    expect(mute).toContain('openmpt_module_get_num_channels');
    expect(mute).toMatch(/channel < 0 \|\| channel >= /);

    const render = wrapper.slice(
      wrapper.indexOf('void OpenMPTModule::setRenderParam'),
      wrapper.indexOf('bool OpenMPTModule::supportsCtl'),
    );
    expect(render).toContain('OPENMPT_MODULE_RENDER_MASTERGAIN_MILLIBEL');
    expect(render).toContain('OPENMPT_MODULE_RENDER_VOLUMERAMPING_STRENGTH');
    expect(render).toContain('default:');

    expect(wrapper).toContain('openmpt_module_get_ctls');
    const ctl = wrapper.slice(wrapper.indexOf('void OpenMPTModule::ctlSetText'));
    expect(ctl).toContain('supportsCtl(key)');
  });

  it('does not call GetLength/time-at-row on the audio thread', () => {
    expect(wrapper).not.toContain('openmpt_module_get_time_at_position');
    expect(worklet).not.toContain('openmpt_module_get_time_at_position');
  });

  it('gates fillPositionInfo behind the ~60 Hz / row-change coalesce', () => {
    const cbIdx = worklet.indexOf('audio_process_cb(');
    expect(cbIdx).toBeGreaterThan(0);
    const renderIdx = worklet.indexOf('readInterleavedStereo', cbIdx);
    const fillIdx = worklet.indexOf('g_module.fillPositionInfo', cbIdx);
    expect(fillIdx).toBeGreaterThan(cbIdx);
    expect(fillIdx).toBeLessThan(renderIdx);
    const gate = worklet.slice(cbIdx, fillIdx);
    expect(gate).toContain('timeSinceLastReport');
    expect(gate).toContain('1.0 / 60.0');
    const attachIdx = engine.indexOf('async attachAudioContext');
    const ensureIdx = engine.indexOf('ensurePcmRing');
    expect(attachIdx).toBeGreaterThan(0);
    expect(ensureIdx).toBeGreaterThan(attachIdx);
    const attachBody = engine.slice(attachIdx, ensureIdx);
    expect(attachBody).not.toContain('this.allocatePcmRing()');
    expect(engine).toContain('setPcmCapture');
    expect(engine).toContain('ensurePcmRing');
  });
});
