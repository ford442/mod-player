import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('#412 native ctl / mute / one-module parse', () => {
  const wrapper = readFileSync(join(ROOT, 'cpp/openmpt_wrapper.cpp'), 'utf8');
  const worklet = readFileSync(join(ROOT, 'cpp/worklet_processor.cpp'), 'utf8');
  const nativeEngine = readFileSync(join(ROOT, 'cpp/native_engine.cpp'), 'utf8');
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

  it('exports mute / render / ctl KEEPALIVEs that persist and replay onto new modules', () => {
    expect(worklet).toContain('void set_channel_mute(');
    expect(worklet).toContain('void set_render_param(');
    expect(worklet).toContain('void ctl_set_text(');
    // The engine keeps the host's desired state and applies it to every module
    // before that module is published to the audio thread (#491).
    expect(nativeEngine).toContain('desired_.muteMask');
    expect(nativeEngine).toContain('applyDesiredState(staged_->module)');
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

  it('skips the JS-engine parser worker when native parse is active', () => {
    expect(moduleActions).toContain("activeEngineRef.current === 'native-worklet'");
    expect(moduleActions).toContain('!useNativeParse && !isLibReadyForParse');
    expect(moduleActions).toContain('parseModuleWithNative');
    expect(runInit).toContain('__XASM1_NATIVE__');
  });

  it('emcc contract includes STACK_SIZE, a no-throw wrapper, wasm exceptions, and new exports', () => {
    expect(buildSh).toContain('-sSTACK_SIZE=131072');
    expect(buildSh).toContain('-fno-exceptions');
    // #491: libopenmpt is linked WITH native wasm exceptions (its own throw/catch must run).
    expect(buildSh).toContain('"${WASM_EH_FLAGS[@]}"');
    expect(buildSh).toContain('libopenmpt_c.cpp');
    expect(buildSh).toContain("'_set_channel_mute'");
    expect(buildSh).toContain("'_set_render_param'");
    expect(buildSh).toContain("'_ctl_set_text'");
    expect(buildSh).toContain('ONE resident C++ OpenMPTModule');
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
    expect(debugFlags).toContain('"${WASM_FEATURE_FLAGS[@]}"'); // -mbulk-memory, from scripts/lib/wasm-flags.sh
    expect(readFileSync(join(ROOT, 'scripts/lib/wasm-flags.sh'), 'utf8')).toMatch(/^WASM_FEATURE_FLAGS=\([^)]*-mbulk-memory/m);
    expect(debugFlags).toContain('-matomics');
  });

  it('native play uses Sinc+LP interpolation (length 8) and demand-driven PCM capture', () => {
    expect(nativePlay).toContain('setInterpolationLength(INTERPOLATION_SINC_LP)');
    expect(nativePlay).toContain('setPcmCapture');
    expect(nativePlay).toContain('setPcmDemandListener');
    expect(nativePlay).toContain('shouldReloadNativeModule');
    // The ring is allocated on demand by setPcmCapture — the old eager
    // ensurePcmRing() call existed only for the deleted dual-context bridge.
    expect(nativePlay).not.toContain('ensurePcmRing');
    expect(engine).toContain('allocatePcmRing');
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

  // ── One parse per file, one module per song under the 128mb cap (#491) ──
  //
  // The old engine parsed every file twice (a transient main-thread
  // g_metaModule, then g_module on the audio thread) and shared the file
  // buffer between threads. Now load_module() parses once on the main thread,
  // commit_module() publishes that module through one atomic exchange, and the
  // replaced module comes back through the graveyard slot to be freed here.
  describe('single parse, lock-free handoff', () => {
    const fnBody = (src: string, signature: string) => {
      const at = src.indexOf(signature);
      expect(at, signature).toBeGreaterThan(-1);
      const open = src.indexOf('{', at);
      let depth = 0;
      for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
      }
      throw new Error(signature);
    };

    it('loadModule parses exactly once and frees the adopted bytes right after', () => {
      const load = fnBody(nativeEngine, 'int NativeEngine::loadModule(');
      expect(load.match(/module\.load\(/g) ?? []).toHaveLength(1);
      const parseIdx = load.indexOf('m->module.load(data');
      const freeIdx = load.indexOf('std::free(data);', parseIdx);
      expect(freeIdx).toBeGreaterThan(parseIdx);
      // Snapshot taken while the main thread still owns the module.
      expect(load.indexOf('snapshot_.build(m->module)')).toBeGreaterThan(parseIdx);
      // The engine must not free a pointer C++ now owns.
      const loadTs = engine.slice(engine.indexOf('async load(data: ArrayBuffer)'));
      expect(loadTs.slice(0, loadTs.indexOf('loadedFingerprint'))).not.toContain('_free(ptr)');
    });

    it('commitModule applies the desired state, then publishes with one exchange', () => {
      const commit = fnBody(nativeEngine, 'int NativeEngine::commitModule(');
      const applyIdx = commit.indexOf('applyDesiredState(staged_->module)');
      const publishIdx = commit.indexOf('handoff_.exchange(staged_');
      expect(applyIdx).toBeGreaterThan(-1);
      expect(publishIdx).toBeGreaterThan(applyIdx);
      expect(commit).toContain('destroyModule(unconsumed)');
    });

    it('play() and both host load paths commit the staged module', () => {
      expect(worklet).toMatch(/void resume_audio\(\) \{[\s\S]{0,200}commit_module\(\);/);
      expect(engine).toContain('commitModule()');
      expect(moduleActions).toContain('nativeEngineEarly.commitModule()');
      expect(nativePlay).toContain('engine.commitModule()');
    });

    it('mute / render param / ctl / seek exports forward to the engine (ring commands)', () => {
      for (const [fn, call] of [
        ['void set_channel_mute(', 'g_engine.setChannelMute('],
        ['void set_render_param(', 'g_engine.setRenderParam('],
        ['void ctl_set_text(', 'g_engine.ctlSetText('],
        ['void seek_order_row(', 'g_engine.seek('],
      ] as const) {
        expect(fnBody(worklet, fn)).toContain(call);
      }
    });

    it('duration / BPM come from the load-time snapshot, never from the rendering module', () => {
      // openmpt_module_get_duration_seconds can walk the song; it runs once, in
      // loadModule's snapshot, on the module the main thread still owns.
      for (const fn of ['double get_duration_seconds()', 'double get_initial_bpm()']) {
        expect(fnBody(worklet, fn)).toContain('g_engine.snapshot()');
      }
      const process = fnBody(nativeEngine, 'void NativeEngine::process(');
      expect(process).not.toMatch(/getDurationSeconds|getBPM|snapshot_/);
    });
  });

  // ── No abort across the no-catch ABI ────────────────────────────────
  it('turns load failures into typed, pollable errors instead of fprintf', () => {
    expect(worklet).toContain('const char* get_last_error()');
    expect(worklet).toContain('void clear_last_error()');
    for (const code of ['ERR_BAD_ARGS', 'ERR_OUT_OF_MEMORY', 'ERR_UNSUPPORTED_MODULE', 'ERR_TORN_DOWN']) {
      expect(nativeEngine).toContain(code);
    }
    // libopenmpt signals allocation failure by throwing; with wasm exceptions its
    // C API turns that into a NULL, which would read as "unsupported module". The
    // heap is probed with malloc (which returns null) first so an upload that
    // cannot fit is reported as ERR_OUT_OF_MEMORY instead.
    const load = nativeEngine.slice(
      nativeEngine.indexOf('int NativeEngine::loadModule('),
      nativeEngine.indexOf('int NativeEngine::commitModule('),
    );
    const probeIdx = load.indexOf('std::malloc(static_cast<size_t>(length) * 4u)');
    const parseIdx = load.indexOf('m->module.load(');
    expect(probeIdx).toBeGreaterThan(-1);
    expect(parseIdx).toBeGreaterThan(probeIdx);
    // and the engine surfaces the code on its error event …
    expect(engine).toContain('takeNativeError()');
    expect(engine).toContain('nativeErrorCode(detail)');
    // … while the load path shows it to the user instead of a generic message.
    expect(moduleActions).toContain('getLastErrorMessage()');
  });

  it('keeps the headless init_audio on the TS factory 48000 / playback lock', () => {
    const init = worklet.slice(worklet.indexOf('int init_audio(int sampleRate)'));
    expect(init.slice(0, 600)).toContain('LOCKED_SAMPLE_RATE = 48000');
    expect(init.slice(0, 600)).toContain('attrs.latencyHint   = "playback"');
    // Production must still go through the shared context.
    expect(engine).toContain('_init_audio_with_context');
  });

  it('does not call GetLength/time-at-row on the audio thread', () => {
    expect(wrapper).not.toContain('openmpt_module_get_time_at_position');
    expect(worklet).not.toContain('openmpt_module_get_time_at_position');
  });

  it('gates fillPositionInfo behind the ~60 Hz / row-change coalesce', () => {
    const cbIdx = nativeEngine.indexOf('void NativeEngine::process(');
    expect(cbIdx).toBeGreaterThan(0);
    const renderIdx = nativeEngine.indexOf('readInterleavedStereo', cbIdx);
    const fillIdx = nativeEngine.indexOf('m.fillPositionInfo', cbIdx);
    expect(fillIdx).toBeGreaterThan(cbIdx);
    expect(fillIdx).toBeLessThan(renderIdx);
    const gate = nativeEngine.slice(cbIdx, fillIdx);
    expect(gate).toContain('timeSinceLastReport');
    expect(gate).toContain('1.0 / 60.0');
    // attachAudioContext must not eagerly allocate the PCM ring — writing it
    // every quantum on the audio thread contends with the mixer.
    const attachIdx = engine.indexOf('async attachAudioContext');
    const allocIdx = engine.indexOf('private allocatePcmRing');
    expect(attachIdx).toBeGreaterThan(0);
    expect(allocIdx).toBeGreaterThan(attachIdx);
    const attachBody = engine.slice(attachIdx, allocIdx);
    expect(attachBody).not.toContain('this.allocatePcmRing()');
    expect(engine).toContain('setPcmCapture');
  });
});
