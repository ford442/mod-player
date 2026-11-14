/**
 * REQUIRED_C_EXPORTS (scripts/jsEngineArtifacts.mjs, checked against the committed glue by
 * verify:js-libopenmpt) must match what the app actually calls: every `_openmpt_*` name the
 * main-thread / worker / worklet sources reference is required, and nothing else is.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INSPECT_C_EXPORTS, INSPECT_SOURCE_REL, REQUIRED_C_EXPORTS, inspectAbiVersion } from '../../scripts/jsEngineArtifacts.mjs';
import { XASM_INSPECT_ABI_VERSION } from '../../utils/moduleInspect';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Not app code: tests, build scripts, generated / static output, archived experiments. */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', 'tests', 'scripts', 'public', 'archive', 'vendor', 'docs',
  '_codeql_detected_source_root', '.claude',
]);

/** Declarations, not call sites: the LibOpenMPT interface and ambient worklet typings. */
const DECLARATION_FILES = new Set(['types.ts']);

/**
 * Referenced only as a fallback for a glue without the newer entry point
 * (`create_from_memory2 ?? create_from_memory`); the committed build has create_from_memory2.
 */
const FALLBACK_ONLY = new Set(['_openmpt_module_create_from_memory']);

function readCode(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkSources(full, out);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function referencedExports(): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const file of walkSources(ROOT)) {
    const rel = relative(ROOT, file);
    if (DECLARATION_FILES.has(rel)) continue;
    for (const [name] of readCode(file).matchAll(/\b_openmpt_[a-z0-9_]+\b/g)) {
      const files = refs.get(name) ?? [];
      if (!files.includes(rel)) files.push(rel);
      refs.set(name, files);
    }
  }
  return refs;
}

describe('REQUIRED_C_EXPORTS matches the real call sites', () => {
  const refs = referencedExports();
  const required = new Set(REQUIRED_C_EXPORTS.filter((n) => n.startsWith('_openmpt_')));

  it('the scan finds the core call sites (sanity)', () => {
    expect(refs.has('_openmpt_module_read_float_stereo')).toBe(true);
    expect(refs.has('_openmpt_module_create_from_memory2')).toBe(true);
  });

  it('every referenced _openmpt_* export is required', () => {
    const missing = [...refs.keys()].filter((n) => !required.has(n) && !FALLBACK_ONLY.has(n)).sort();
    expect(missing, `referenced but not in REQUIRED_C_EXPORTS: ${missing.map((n) => `${n} (${refs.get(n)?.join(', ')})`).join('; ')}`).toEqual([]);
  });

  it('every required _openmpt_* export is referenced', () => {
    const unused = [...required].filter((n) => !refs.has(n)).sort();
    expect(unused).toEqual([]);
  });

  it('keeps _malloc / _free (module bytes are copied into the heap)', () => {
    expect(REQUIRED_C_EXPORTS).toContain('_malloc');
    expect(REQUIRED_C_EXPORTS).toContain('_free');
  });
});

describe('INSPECT_C_EXPORTS matches the shim and its wrapper', () => {
  const cpp = readFileSync(join(ROOT, INSPECT_SOURCE_REL), 'utf8');
  const shimFunctions = [...cpp.matchAll(/^XASM_API [a-z0-9_:]+ +(xasm_[a-z0-9_]+) *\(/gm)].map((m) => `_${m[1]}`).sort();

  it('is exactly the XASM_API functions of wasm/xasm_inspect.cpp (what the build exports)', () => {
    expect(shimFunctions.length).toBeGreaterThan(10);
    expect([...INSPECT_C_EXPORTS].sort()).toEqual(shimFunctions);
  });

  it('every _xasm_* the app references is exported', () => {
    const refs = new Set<string>();
    for (const file of walkSources(ROOT)) {
      for (const [name] of readCode(file).matchAll(/\b_xasm_[a-z0-9_]+\b/g)) refs.add(name);
    }
    expect(refs.has('_xasm_inspect_create')).toBe(true);
    expect([...refs].filter((n) => !INSPECT_C_EXPORTS.includes(n)).sort()).toEqual([]);
  });

  it('the wrapper\'s ABI version is the shim\'s', () => {
    expect(XASM_INSPECT_ABI_VERSION).toBe(inspectAbiVersion(ROOT));
  });
});
