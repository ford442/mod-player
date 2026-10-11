import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRIPT = join(ROOT, 'scripts', 'verify-bundle-budget.mjs');

const tmp = mkdtempSync(join(tmpdir(), 'verify-bundle-budget-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const ENTRY = 'index-AAAA.js';
const VENDOR = 'react-vendor-BBBB.js';
const THREE = 'three-r3f-CCCC.js';
const LAZY = 'App3DView-DDDD.js';

interface Fixture {
  /** Extra `<link rel="modulepreload">` hrefs in index.html. */
  preloads?: string[];
  /** Overrides for chunk file contents, keyed by file name; `null` omits the chunk. */
  chunks?: Partial<Record<string, string | null>>;
}

/** A minimal dist/ the budget script accepts: entry → react-vendor, 3D view lazily → three-r3f. */
function makeDist({ preloads = [], chunks = {} }: Fixture = {}): string {
  const dir = mkdtempSync(join(tmp, 'dist-'));
  const defaults: Record<string, string> = {
    [ENTRY]: `import{r as e}from"./${VENDOR}";const L=()=>import("./${LAZY}");export{L as lazy3d};`,
    [VENDOR]: 'export const r=1;',
    [THREE]: `import{r as e}from"./${VENDOR}";export const T=2;`,
    [LAZY]: `import{r as e}from"./${VENDOR}";import{T}from"./${THREE}";export default T;`,
  };
  const files = { ...defaults, ...chunks };

  const links = preloads.map((h) => `<link rel="modulepreload" crossorigin href="${h}">`).join('\n');
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><html><head>\n<script type="module" crossorigin src="/assets/${ENTRY}"></script>\n${links}\n</head><body></body></html>`,
  );
  writeFileSync(
    join(dir, '.htaccess'),
    'Header set Cross-Origin-Opener-Policy "same-origin"\nHeader set Cross-Origin-Embedder-Policy "credentialless"\n',
  );
  for (const [name, code] of Object.entries(files)) {
    if (typeof code !== 'string') continue; // null = deliberately omitted chunk
    const path = join(dir, 'assets', name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, code);
  }
  mkdirSync(join(dir, 'worklets'), { recursive: true });
  writeFileSync(join(dir, 'worklets', 'openmpt-worklet.js'), '// stub');
  return dir;
}

function run(dist: string, env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, BUILD_DIR: dist, ...env },
  });
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe('verify-bundle-budget: three.js must stay off the initial load', () => {
  it('accepts entry → react-vendor with three-r3f only behind the lazy 3D view', () => {
    const r = run(makeDist({ preloads: [`/assets/${VENDOR}`] }));
    expect(r.out).toContain('verify-bundle-budget OK');
    expect(r.status).toBe(0);
  });

  it('fails when index.html modulepreloads the three chunk', () => {
    const r = run(makeDist({ preloads: [`/assets/${VENDOR}`, `/assets/${THREE}`] }));
    expect(r.status).toBe(1);
    expect(r.out).toContain(`index.html modulepreloads ${THREE}`);
  });

  it('fails when the entry statically imports the three chunk, even without a modulepreload link', () => {
    const r = run(
      makeDist({ chunks: { [ENTRY]: `import{r as e}from"./${VENDOR}";import{T}from"./${THREE}";export{T};` } }),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain(`initial load statically imports ${THREE}`);
    expect(r.out).toContain(`via assets/${ENTRY}`);
  });

  it('fails when the three chunk is reached transitively through another eager chunk', () => {
    const r = run(makeDist({ chunks: { [VENDOR]: `import"./${THREE}";export const r=1;` } }));
    expect(r.status).toBe(1);
    expect(r.out).toContain(`initial load statically imports ${THREE} (via assets/${VENDOR})`);
  });

  it('treats a dynamic import() of the three chunk as lazy', () => {
    const r = run(
      makeDist({ chunks: { [ENTRY]: `import{r as e}from"./${VENDOR}";export const f=()=>import("./${THREE}");` } }),
    );
    expect(r.out).toContain('verify-bundle-budget OK');
    expect(r.status).toBe(0);
  });

  it('fails when the 3D view itself is imported eagerly', () => {
    const r = run(makeDist({ chunks: { [ENTRY]: `import{r as e}from"./${VENDOR}";import d from"./${LAZY}";export{d};` } }));
    expect(r.status).toBe(1);
    expect(r.out).toContain('3D view is not lazy');
  });

  it('fails when the shared react-vendor chunk is missing', () => {
    const r = run(
      makeDist({
        chunks: { [VENDOR]: null, [ENTRY]: 'export default 1;', [THREE]: 'export const T=2;', [LAZY]: 'export default 1;' },
      }),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain('no react-vendor-*.js chunk found');
  });

  it('enforces the gzipped initial-load budget across the whole eager graph', () => {
    const dist = makeDist();
    expect(run(dist, { MAX_INITIAL_GZIP_BYTES: '1000000' }).status).toBe(0);
    const tight = run(dist, { MAX_INITIAL_GZIP_BYTES: '10' });
    expect(tight.status).toBe(1);
    expect(tight.out).toContain('initial JS load is');
    expect(tight.out).toContain(`assets/${ENTRY}, assets/${VENDOR}`);
  });
});
