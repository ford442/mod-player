import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { libopenmptHtmlPlugin } from '../vite-plugins/libopenmptHtml';
import manifest from '../audio-worklet/js/libopenmpt-worklet.generated.json';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');

function transform(base: string, html = indexHtml): string {
  const plugin = libopenmptHtmlPlugin(base);
  const hook = plugin.transformIndexHtml as (html: string) => string;
  return hook(html);
}

describe('libopenmptHtmlPlugin (real-WASM main-thread glue)', () => {
  it('injects a BASE_URL-aware, versioned, SRI-pinned script tag for the shared glue', () => {
    const out = transform('/xm-player/');
    expect(out).toContain(
      `src="/xm-player/worklets/libopenmpt-worklet.js?v=${manifest.version}"`,
    );
    expect(out).toContain(`integrity="${manifest.glue.integrity}"`);
    expect(out).toContain('crossorigin="anonymous"');
    expect(out).not.toContain('libopenmptjs.js');
    expect(out).not.toContain('libmpt/');
    expect(out).not.toContain('wasm.noahcohn.com');
  });

  it('versions the sibling .wasm through locateFile so glue and wasm can never mismatch', () => {
    const out = transform('/');
    expect(out).toContain(`window.libopenmpt.locateFile = function (p, dir) { return dir + p + '?v=${manifest.version}'; }`);
    // The hook must run after index.html creates window.libopenmpt and before the glue script.
    const created = out.indexOf('window.libopenmpt = {');
    const hook = out.indexOf('window.libopenmpt.locateFile');
    const glue = out.indexOf('libopenmpt-worklet.js?v=');
    expect(created).toBeGreaterThan(-1);
    expect(hook).toBeGreaterThan(created);
    expect(glue).toBeGreaterThan(hook);
  });

  it('handles a base without a trailing slash', () => {
    expect(transform('/xm-player')).toContain('src="/xm-player/worklets/libopenmpt-worklet.js?v=');
  });

  it('fails loudly if the placeholder is missing', () => {
    expect(() => transform('/', '<html></html>')).toThrow(/LIBOPENMPT_SCRIPT/);
  });
});

describe('index.html', () => {
  it('no longer snapshots WebAssembly — libopenmpt never replaces it', () => {
    expect(indexHtml).not.toContain('__NATIVE_WEBASSEMBLY__');
    expect(indexHtml).not.toMatch(/isWasm2js/);
  });
});
