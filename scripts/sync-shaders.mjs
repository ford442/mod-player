#!/usr/bin/env node
/**
 * Cross-platform shader sync (replaces rsync for CI / minimal environments).
 * Copies shaders/*.wgsl → public/shaders/, excluding legacy/ and thumbnails/.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'shaders';
const DEST = 'public/shaders';
const SKIP_DIRS = new Set(['legacy', 'thumbnails']);
const SKIP_FILES = new Set(['README.md']);

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
      cpSync(srcPath, destPath);
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
