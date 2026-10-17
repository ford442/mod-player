/**
 * #491: until this fix the native engine never rendered a sample in a browser.
 * The C++ created its AudioWorkletNode without first registering the
 * processor name in the AudioWorkletGlobalScope, so `new AudioWorkletNode`
 * threw, Emscripten reported the thread start as failed, and the host fell
 * back to the JS worklet after its 8 s wait — while the native parity smoke
 * stayed green, because it read the engine *selection* before playback
 * started. Real-browser proof: `AUDIO_ENGINE=native npm run smoke:playhead`
 * (CI native-full-build); these source guards keep the pieces from regressing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function body(src: string, signature: string): string {
  const at = src.indexOf(signature);
  expect(at, signature).toBeGreaterThan(-1);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(signature);
}

describe('native engine actually starts and is measured as running (#491)', () => {
  const glue = read('cpp/worklet_processor.cpp');

  it('registers the AudioWorkletProcessor before creating the node', () => {
    const threadUp = body(glue, 'static void worklet_thread_initialized(');
    expect(threadUp).toContain('emscripten_create_wasm_audio_worklet_processor_async(');
    expect(threadUp).not.toContain('emscripten_create_wasm_audio_worklet_node(');
    const created = body(glue, 'static void worklet_processor_created(');
    expect(created).toContain('emscripten_create_wasm_audio_worklet_node(');
    // One name for both steps.
    expect(glue).toMatch(/kProcessorName = "openmpt-native-processor"/);
  });

  it('the native parity smoke gates on the engine that rendered, after playback started', () => {
    const smoke = read('scripts/playhead-acceptance.mjs');
    const reader = body(smoke, 'async function readRenderingEngine(');
    expect(reader.indexOf('clickPlay(')).toBeLessThan(reader.indexOf('getPlaybackEngine'));
    expect(smoke).toMatch(/result\.playbackEngine !== 'native-worklet'/);
    const hooks = read('app/useAppTestHooks.ts');
    expect(hooks).toMatch(/getPlaybackEngine,/);
    expect(read('hooks/useLibOpenMPT.ts')).toContain('getPlaybackEngine: () => refs.playbackEngineRef.current');
  });

  it('play after stop rewinds the native module (and its frame clock) like the JS engine reloads', () => {
    const play = read('hooks/audioGraph/startNativePlayback.ts');
    const skip = play.slice(play.indexOf("'Native module already loaded — skipping duplicate parse'"));
    expect(skip.slice(0, 600)).toContain('engine.seek(0, 0);');
  });

  it('reports a fractional row (an integer row read as ~half a row late)', () => {
    const cpp = ['cpp/worklet_processor.cpp', 'cpp/native_engine.cpp']
      .filter((p) => existsSync(join(ROOT, p)))
      .map(read)
      .join('\n');
    expect(cpp).toMatch(/rowFraction = static_cast<float>\(currentRow \+ frac\)/);
    expect(cpp).toMatch(/rowStartPosSec/);
  });
});
