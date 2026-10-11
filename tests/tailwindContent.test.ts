import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../tailwind.config.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Directories that never ship UI (or aren't ours): skipped when looking for JSX files. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.claude', 'dist', 'archive', 'tests', 'vendor', 'artifacts', 'public',
  'test-results', 'jules_patch', '_codeql_detected_source_root',
]);

function findTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('dist') || entry.name.startsWith('libopenmpt-')) continue;
      findTsx(join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      out.push(relative(ROOT, join(dir, entry.name)).split(sep).join('/'));
    }
  }
  return out;
}

/** Just enough glob for the shapes tailwind.config.js uses: `./a/b.tsx` and `./dir/**\/*.tsx`. */
function globToRegExp(glob: string): RegExp {
  const body = glob
    .replace(/^\.\//, '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '@@GLOBSTAR@@')
    .replace(/\*/g, '[^/]*')
    .replace(/@@GLOBSTAR@@/g, '(?:.*/)?');
  return new RegExp(`^${body}$`);
}

const globs: string[] = tailwindConfig.content;
const matchers = globs.map(globToRegExp);
const scanned = (path: string) => matchers.some((re) => re.test(path));

describe('tailwind content globs', () => {
  it('scan every .tsx file in the repo, so no component ships unstyled', () => {
    const tsx = findTsx(ROOT);
    expect(tsx.length).toBeGreaterThan(20); // sanity: the walk found the app
    const unscanned = tsx.filter((file) => !scanned(file));
    expect(unscanned).toEqual([]);
  });

  it('only scan .tsx (and index.html) — never hooks/utils/audio-worklet source', () => {
    // Tailwind reads comments too: `[inst:8]` bit-layout notes became bogus CSS rules and the
    // build's `"inst" is not a known CSS property` warning. Non-JSX files have no class names.
    for (const glob of globs) {
      expect(glob, glob).toMatch(/(\.tsx|\.html)$/);
      expect(glob, glob).not.toMatch(/node_modules|\{|^\.\/\*\*/);
    }
    for (const dir of ['hooks', 'utils', 'audio-worklet', 'store', 'workers', 'types', 'src/renderers']) {
      expect(scanned(`${dir}/example.ts`), `${dir}/example.ts`).toBe(false);
      expect(scanned(`${dir}/example.js`), `${dir}/example.js`).toBe(false);
    }
  });
});
