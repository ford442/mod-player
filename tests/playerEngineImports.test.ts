/**
 * #492: the PlayerEngine core is framework-free — React observes it, it never imports React.
 *
 * ESLint's no-restricted-imports only sees a file's own imports; this walks the whole module graph
 * reachable from audio/engine/PlayerEngine.ts (static imports, re-exports, dynamic import(), and type
 * imports — a type-level dependency on React is still a dependency) and fails on any React-world
 * package. It also pins that the engine's own directory stays free of React and of the store layer.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENTRY = join(ROOT, 'audio/engine/PlayerEngine.ts');

const FORBIDDEN = /^(react|react-dom|zustand|@tanstack\/|@react-three\/)(\/|$)/;

const SPECIFIER = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null; // JSON, .mjs helpers, assets: no imports of their own that matter here
}

interface Graph {
  files: Set<string>;
  /** bare specifier → files importing it */
  packages: Map<string, string[]>;
}

function walk(entry: string): Graph {
  const files = new Set<string>();
  const packages = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) continue;
      if (specifier.startsWith('.')) {
        const next = resolveLocal(file, specifier);
        if (next) queue.push(next);
      } else {
        const importers = packages.get(specifier) ?? [];
        importers.push(relative(ROOT, file));
        packages.set(specifier, importers);
      }
    }
  }
  return { files, packages };
}

describe('PlayerEngine import graph (#492)', () => {
  const graph = walk(ENTRY);

  it('reaches the start paths and action factories it composes', () => {
    const reached = [...graph.files].map((f) => relative(ROOT, f));
    // Sanity: the walk follows the real graph (a regex that matched nothing would pass vacuously).
    expect(reached).toEqual(expect.arrayContaining([
      'audio/engine/transport.ts',
      'audio/engine/engineRefs.ts',
      'hooks/useAudioGraph.ts',
      'hooks/audioGraph/startJsWorkletPlayback.ts',
      'hooks/audioGraph/scriptProcessorFallback.ts',
      'hooks/libOpenMPT/createTransportActions.ts',
      'hooks/libOpenMPT/createModuleActions.ts',
      'hooks/libOpenMPT/createUpdateUI.ts',
      'hooks/libOpenMPT/runInit.ts',
    ]));
  });

  it('imports no React-world package anywhere in the graph', () => {
    const offenders = [...graph.packages.entries()]
      .filter(([specifier]) => FORBIDDEN.test(specifier))
      .map(([specifier, importers]) => `${specifier} ← ${importers.join(', ')}`);
    expect(offenders).toEqual([]);
  });

  it('keeps audio/engine itself free of React, including the binding (which lives in hooks/)', () => {
    const engineDir = join(ROOT, 'audio/engine');
    const offenders = readdirSync(engineDir)
      .filter((name) => /\.tsx?$/.test(name))
      .filter((name) => {
        const source = stripComments(readFileSync(join(engineDir, name), 'utf8'));
        return [...source.matchAll(SPECIFIER)].some((m) => FORBIDDEN.test(m[1] ?? m[2] ?? m[3] ?? ''));
      });
    expect(offenders).toEqual([]);
  });
});
