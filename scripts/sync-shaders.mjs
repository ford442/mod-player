#!/usr/bin/env node
/**
 * Cross-platform shader sync (replaces rsync for CI / minimal environments).
 * Copies shaders/*.wgsl → public/shaders/, excluding legacy/, thumbnails/, and lib/.
 *
 * WGSL source files may use include directives that look like WGSL comments:
 *   //#include "lib/emitters.wgsl"
 * These are expanded recursively during the sync pass so the public output is a
 * flat, self-contained WGSL file. Includes are tracked per output file to guard
 * against double-inclusion and cycles.
 *
 * `lib/` is never copied to public — production serves only flat WGSL.
 * This script is the single publish path (also wired as predev / prebuild).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const SRC = join(ROOT, 'shaders');
const DEST = join(ROOT, 'public/shaders');
const SKIP_DIRS = new Set(['legacy', 'thumbnails', 'lib']);
const SKIP_FILES = new Set(['README.md']);

const INCLUDE_RE = /^\s*\/\/\s*#include\s+"([^"]+)"\s*$/;
/** Residual include left in expanded output is a hard error. */
const RESIDUAL_INCLUDE_RE = /^\s*\/\/\s*#include\s+"/m;

/**
 * Resolve a source WGSL file into a flat string, expanding `//#include` directives.
 * @param {string} filePath - absolute path to the source file
 * @param {Set<string>} [seen] - absolute paths already included in this output
 * @returns {string}
 */
export function resolveIncludes(filePath, seen = new Set()) {
  if (seen.has(filePath)) {
    return '';
  }
  seen.add(filePath);

  const text = readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(INCLUDE_RE);
    if (match) {
      const includePath = match[1];
      const resolved = resolve(SRC, includePath);
      if (!existsSync(resolved)) {
        throw new Error(`Unresolved include in ${filePath}:${i + 1}: "${includePath}" (looked at ${resolved})`);
      }
      if (!resolved.startsWith(SRC + '/') && resolved !== SRC) {
        throw new Error(`Include escapes source root in ${filePath}:${i + 1}: "${includePath}"`);
      }
      const included = resolveIncludes(resolved, seen);
      if (included === '') {
        continue;
      }
      if (included.endsWith('\n')) {
        out.push(included.slice(0, -1));
      } else {
        out.push(included);
      }
    } else {
      out.push(line);
    }
  }

  return out.join('\n');
}

/**
 * Expand one source file and assert the result is flat (no residual includes).
 * @param {string} srcPath
 * @returns {{ flat: string, includes: string[] }}
 */
export function expandShader(srcPath) {
  const seen = new Set();
  const flat = resolveIncludes(srcPath, seen);
  if (RESIDUAL_INCLUDE_RE.test(flat)) {
    throw new Error(`Residual //#include in expanded output of ${srcPath}`);
  }
  const includes = [...seen].filter((p) => p !== srcPath).map((p) => relative(SRC, p));
  return { flat, includes };
}

function copyDir(src, dest, stats) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry)) continue;
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      copyDir(srcPath, destPath, stats);
    } else if (entry.endsWith('.wgsl')) {
      const { flat, includes } = expandShader(srcPath);
      writeFileSync(destPath, flat, 'utf8');
      stats.files += 1;
      if (includes.length > 0) {
        stats.withIncludes += 1;
        stats.includeEdges += includes.length;
      }
    }
  }
}

function main() {
  if (!existsSync(SRC)) {
    console.warn(`[sync-shaders] source dir missing: ${SRC}`);
    process.exit(0);
  }

  if (existsSync(DEST)) {
    rmSync(DEST, { recursive: true, force: true });
  }

  const stats = { files: 0, withIncludes: 0, includeEdges: 0 };
  copyDir(SRC, DEST, stats);
  console.log(
    `[sync-shaders] synced ${SRC}/ → ${DEST}/ ` +
      `(${stats.files} files, ${stats.withIncludes} with includes, ${stats.includeEdges} include edges)`,
  );
}

// Run when executed directly (not when imported by tests)
const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === __filename;

if (isMain) {
  try {
    main();
  } catch (err) {
    console.error('[sync-shaders] FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
