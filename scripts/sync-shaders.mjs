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
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const SRC = join(ROOT, 'shaders');
const DEST = join(ROOT, 'public/shaders');
const SKIP_DIRS = new Set(['legacy', 'thumbnails', 'lib']);
const SKIP_FILES = new Set(['README.md']);

const INCLUDE_RE = /^\s*\/\/\s*#include\s+"([^"]+)"\s*$/;

/**
 * Resolve a source WGSL file into a flat string, expanding `//#include` directives.
 * @param {string} filePath - absolute path to the source file
 * @param {Set<string>} [seen] - absolute paths already included in this output
 * @returns {string}
 */
function resolveIncludes(filePath, seen = new Set()) {
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

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry)) continue;
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.endsWith('.wgsl')) {
      const flat = resolveIncludes(srcPath);
      writeFileSync(destPath, flat, 'utf8');
    }
  }
}

if (!existsSync(SRC)) {
  console.warn(`[sync-shaders] source dir missing: ${SRC}`);
  process.exit(0);
}

if (existsSync(DEST)) {
  rmSync(DEST, { recursive: true, force: true });
}
copyDir(SRC, DEST);
console.log(`[sync-shaders] synced ${SRC}/ → ${DEST}/`);
