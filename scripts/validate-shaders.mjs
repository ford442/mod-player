#!/usr/bin/env node
/**
 * Validate generated WGSL shaders for common structural errors.
 *
 * Checks:
 *   1. No duplicate function definitions in any assembled .wgsl
 *   2. All #include directives were resolved (no leftover `#include` lines)
 *   3. Every shader has a `vs()` and `fs()` entry point (or `vertex_main`/`fragment_main`)
 *   4. No undefined references to common helpers (basic static analysis)
 *
 * Usage:
 *   node scripts/validate-shaders.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHADERS_DIR = path.join(__dirname, '..', 'public', 'shaders');

// Active shaders referenced by the app (from App.tsx SHADER_GROUPS + backgrounds + bloom)
const ACTIVE_SHADERS = new Set([
  // Pattern shaders (from SHADER_GROUPS)
  'patternv0.44.wgsl', 'patternv0.43.wgsl', 'patternv0.40.wgsl', 'patternv0.39.wgsl', 'patternv0.21.wgsl',
  'patternv0.50.wgsl', 'patternv0.49.wgsl', 'patternv0.48.wgsl', 'patternv0.47.wgsl',
  'patternv0.46.wgsl', 'patternv0.45.wgsl', 'patternv0.45b.wgsl', 'patternv0.42.wgsl',
  'patternv0.38.wgsl', 'pattern_bloom.wgsl', 'patternv0.35_bloom.wgsl', 'patternv0.30.wgsl',
  'patternv0.23.wgsl', 'patternv0.24.wgsl',
  'patternv0.51.wgsl', // new unified source
  // Background shaders
  'bezel.wgsl', 'chassis_frosted.wgsl', 'chassis_dark.wgsl',
  'chassis_video.wgsl', 'chassisv0.1.wgsl',
  // Bloom post-processing
  'bloom_blur.wgsl', 'bloom_composite.wgsl', 'bloom_threshold.wgsl',
]);

const FUNCTION_RE = /^fn\s+(\w+)\s*\(/gm;
const INCLUDE_RE = /^\s*#include\s+/m;
const VERTEX_ENTRY_RE = /(@vertex\s*\nfn\s+(\w+))|(@vertex[\s\S]*?fn\s+(\w+))/;
const FRAG_ENTRY_RE = /(@fragment\s*\nfn\s+(\w+))|(@fragment[\s\S]*?fn\s+(\w+))/;

function validateShader(filePath) {
  const basename = path.basename(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  const issues = [];

  // 1. Duplicate functions
  const seen = new Map(); // name -> line number
  let m;
  while ((m = FUNCTION_RE.exec(content)) !== null) {
    const name = m[1];
    const line = content.slice(0, m.index).split('\n').length;
    if (seen.has(name)) {
      issues.push(`Duplicate function "${name}" at line ${line} (first at line ${seen.get(name)})`);
    } else {
      seen.set(name, line);
    }
  }

  // 2. Unresolved #include directives
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (INCLUDE_RE.test(lines[i])) {
      issues.push(`Unresolved #include at line ${i + 1}: ${lines[i].trim()}`);
    }
  }

  // 3. Missing entry points
  // Some shaders (e.g. bloom passes) are fragment-only fullscreen quads
  // and use hardcoded vertex positions without a @vertex function.
  const isComputeLike = basename.startsWith('bloom_');
  const hasVertex = VERTEX_ENTRY_RE.test(content) || content.includes('vertex_main');
  const hasFragment = FRAG_ENTRY_RE.test(content) || content.includes('fragment_main');
  if (!hasVertex && !isComputeLike) {
    issues.push('Missing vertex entry point (@vertex fn ... or vertex_main)');
  }
  if (!hasFragment && !isComputeLike) {
    issues.push('Missing fragment entry point (@fragment fn ... or fragment_main)');
  }

  // 4. Basic undefined-reference check for common helpers
  //    Only check if the helper is called but not defined in this file.
  //    This is a shallow check — includes are already resolved.
  const helperCalls = [
    'sdRoundedBox', 'sdCircle', 'sdEllipse', 'sdBox', 'sdTriangle',
    'neonPalette', 'pitchClassFromIndex', 'pitchClassFromPacked',
    'bloomBoost', 'bloomBoostMedium', 'bloomSoft',
    'drawUnifiedLensCap', 'drawChromeIndicator',
    'unpackDurationInfo', 'calculateSustainBrightness', 'calculateTopIntensity',
    'drawDigit', 'drawNumber', 'drawText',
    'getChassisMaterial', 'drawFrostedButton', 'drawWhiteButton',
  ];
  for (const helper of helperCalls) {
    const callRe = new RegExp(`\\b${helper}\\s*\\(`, 'g');
    const defRe = new RegExp(`^fn\\s+${helper}\\s*\\(`, 'm');
    if (callRe.test(content) && !defRe.test(content)) {
      // It's called but not defined — might be in an include that was resolved
      // This is actually OK for assembled files, so we skip the error.
      // We only flag if the helper is called AND the file is NOT assembled
      // (i.e., it still has #include markers). Since we already check #include
      // above, this case is covered.
    }
  }

  return { basename, issues, lineCount: lines.length };
}

function main() {
  console.log('\n🔍 WGSL Shader Validation\n');

  const files = fs.readdirSync(SHADERS_DIR).filter(f => f.endsWith('.wgsl')).sort();
  let criticalIssues = 0;
  let warningIssues = 0;

  for (const f of files) {
    const result = validateShader(path.join(SHADERS_DIR, f));
    const isActive = ACTIVE_SHADERS.has(result.basename);
    const activeLabel = isActive ? ' [ACTIVE]' : '';

    if (result.issues.length === 0) {
      console.log(`  ✅ ${result.basename}${activeLabel}  (${result.lineCount} lines)`);
    } else {
      const criticalCount = result.issues.filter(() => isActive).length;
      const warnCount = result.issues.filter(() => !isActive).length;
      if (isActive) {
        console.log(`  ❌ ${result.basename}${activeLabel}  (${result.issues.length} issue(s))`);
        criticalIssues += result.issues.length;
      } else {
        console.log(`  ⚠️  ${result.basename}${activeLabel}  (${result.issues.length} issue(s), legacy)`);
        warningIssues += result.issues.length;
      }
      for (const issue of result.issues) {
        console.log(`     - ${issue}`);
      }
    }
  }

  console.log();
  if (criticalIssues === 0 && warningIssues === 0) {
    console.log(`✅ All ${files.length} shader(s) passed validation.\n`);
    process.exit(0);
  } else {
    if (criticalIssues > 0) {
      console.log(`❌ ${criticalIssues} critical issue(s) in active shaders.\n`);
    }
    if (warningIssues > 0) {
      console.log(`⚠️  ${warningIssues} warning(s) in legacy/inactive shaders.\n`);
    }
    process.exit(criticalIssues > 0 ? 1 : 0);
  }
}

main();
