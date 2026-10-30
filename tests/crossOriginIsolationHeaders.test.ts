import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CROSS_ORIGIN_ISOLATION_HEADERS } from '../vite-plugins/crossOriginIsolationHeaders';

// #516 item 4: dev/preview, Apache and _headers must agree on COOP same-origin + COEP require-corp
// (WebKit has no credentialless, so only require-corp isolates Safari).
const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** `Header … set Name "value"` directives from an .htaccess (comments stripped). */
function htaccessSetHeaders(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^Header\s+(?:always\s+)?set\s+(\S+)\s+"([^"]*)"/i);
    if (!m) continue;
    const name = m[1]!.toLowerCase();
    (out[name] ??= []).push(m[2]!);
  }
  return out;
}

/** Headers under the `/*` rule of a Netlify/Cloudflare `_headers` file. */
function rootHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inRoot = false;
  for (const raw of text.split('\n')) {
    if (raw.trim().startsWith('#') || raw.trim() === '') continue;
    if (!/^\s/.test(raw)) {
      inRoot = raw.trim() === '/*';
      continue;
    }
    if (!inRoot) continue;
    const idx = raw.indexOf(':');
    out[raw.slice(0, idx).trim().toLowerCase()] = raw.slice(idx + 1).trim();
  }
  return out;
}

describe('cross-origin isolation headers', () => {
  const htaccess = read('public/.htaccess');
  const headersFile = read('public/_headers');
  const plugin = read('vite-plugins/crossOriginIsolationHeaders.ts');

  it('vite plugin serves COOP same-origin + COEP require-corp', () => {
    expect(CROSS_ORIGIN_ISOLATION_HEADERS['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(CROSS_ORIGIN_ISOLATION_HEADERS['Cross-Origin-Embedder-Policy']).toBe('require-corp');
  });

  it('.htaccess sets each header once, with always, matching the plugin', () => {
    const set = htaccessSetHeaders(htaccess);
    expect(set['cross-origin-opener-policy']).toEqual(['same-origin']);
    expect(set['cross-origin-embedder-policy']).toEqual(['require-corp']);
    expect(htaccess).toMatch(/^\s*Header\s+always\s+set\s+Cross-Origin-Opener-Policy/m);
    expect(htaccess).toMatch(/^\s*Header\s+always\s+set\s+Cross-Origin-Embedder-Policy/m);
    // Both mod_headers tables are cleared so a parent vhost cannot leave a second COEP behind.
    expect(htaccess).toMatch(/^\s*Header\s+unset\s+Cross-Origin-Embedder-Policy/m);
    expect(htaccess).toMatch(/^\s*Header\s+always\s+unset\s+Cross-Origin-Embedder-Policy/m);
  });

  it('_headers matches the plugin', () => {
    const headers = rootHeaders(headersFile);
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-embedder-policy']).toBe('require-corp');
  });

  it('no header source mentions credentialless', () => {
    for (const text of [htaccess, headersFile, plugin]) {
      expect(text).not.toMatch(/credentialless/i);
    }
  });

  it('index.html loads nothing from esm.sh and has no importmap', () => {
    const html = read('index.html');
    expect(html).not.toMatch(/esm\.sh/);
    expect(html).not.toMatch(/importmap/);
  });

  it('service worker cache was bumped past the credentialless-era name', () => {
    const name = read('public/sw.js').match(/const CACHE_NAME = '([^']+)'/)?.[1];
    expect(name).toBeDefined();
    expect(name).not.toBe('mod-player-v6');
  });
});
