#!/usr/bin/env node
/**
 * Tier-A WGSL include migration: replace inline duplicates with //#include libs.
 * Preserves expanded public/ output when libs match inlined copies exactly.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandShader } from './sync-shaders.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'shaders');

/** @type {{ include: string, detect: RegExp, strip: RegExp }[]} */
const LIB_RULES = [
  {
    include: 'lib/notes.wgsl',
    detect: /const NOTE_MIN:\s*u32/,
    strip: /\/\/ DURA: Note duration constants\n)?const NOTE_MIN: u32 = 1u;\nconst NOTE_MAX: u32 = 119u;\nconst NOTE_OFF_MIN: u32 = 120u;\n\n?/g,
  },
  {
    include: 'lib/palette.wgsl',
    detect: /fn selectPalette\(id: u32, t: f32\)/,
    strip: /fn selectPalette\(id: u32, t: f32\) -> vec3<f32> \{[\s\S]*?\n\}\n\n?/,
  },
  {
    include: 'lib/sdf.wgsl',
    detect: /fn sdRoundedBox\(/,
    strip: /fn sdRoundedBox\(p: vec2<f32>, b: vec2<f32>, r: f32\) -> f32 \{[\s\S]*?\n\}\n\nfn sdCircle[\s\S]*?\n\}\n\n(fn sdEllipse[\s\S]*?\n\}\n\n?)?/,
  },
  {
    include: 'lib/tonemap.wgsl',
    detect: /fn acesToneMap\(/,
    strip: /\/\/ ACES Filmic Tone Mapping[\s\S]*?fn acesToneMap\(color: vec3<f32>\) -> vec3<f32> \{[\s\S]*?\n\}\n\n?/,
  },
  {
    include: 'lib/color_preserve.wgsl',
    detect: /const COLOR_PRESERVE_SCALE/,
    strip: /\/\/ Scale factor for hue-preservation[\s\S]*?const COLOR_PRESERVE_MAX: f32\s+=\s+0\.85;\n\n?/,
  },
  {
    include: 'lib/pitch.wgsl',
    detect: /fn pitchClassFromIndex\(/,
    strip: /fn pitchClassFromIndex\(note: u32\) -> f32 \{[\s\S]*?\n\}\n\n(?:\/\/ Circle-of-fifths[\s\S]*?)?fn fifthsHue[\s\S]*?\n\}\n\n(?:\/\/ Octave brightness[\s\S]*?)?fn octaveBrightness[\s\S]*?\n\}\n\n(?:\/\/ Returns the hue[\s\S]*?)?fn pitchHueForPalette[\s\S]*?\n\}\n\n(fn neonPalette[\s\S]*?\n\}\n\n?)?/,
  },
  {
    include: 'lib/dura.wgsl',
    detect: /fn unpackDurationInfo\(/,
    strip: /\/\/ DURA: Structure to hold unpacked note duration info\nstruct NoteDurationInfo \{[\s\S]*?\n\}\n\n(?:\/\/ DURA: Unpack duration[\s\S]*?)?fn unpackDurationInfo\([\s\S]*?\n\}\n\n(?:\/\/ DURA: Calculate sustain[\s\S]*?)?fn calculateSustainBrightness[\s\S]*?\n\}\n\n?/,
  },
  {
    include: 'lib/top_emitter.wgsl',
    detect: /fn calculateTopIntensity\(/,
    strip: /\/\/ AMBER-BLUE: Calculate top-emitter[\s\S]*?fn calculateTopIntensity\([\s\S]*?\n\}\n\n?/,
  },
  {
    include: 'lib/brilliant_led.wgsl',
    detect: /fn brilliantLEDCore\(/,
    strip: /\/\/ Brilliant LED Core \+ Halo split\.[\s\S]*?fn brilliantLEDCore\([\s\S]*?\n\}\n\n?/,
  },
];

/**
 * @param {string} text
 * @param {typeof LIB_RULES[0]} rule
 */
function applyRule(text, rule) {
  if (!rule.detect.test(text)) return { text, applied: false };
  let out = text.replace(rule.strip, '');
  if (out === text && rule.include === 'lib/notes.wgsl') {
    out = text.replace(/const NOTE_MIN: u32 = 1u;\nconst NOTE_MAX: u32 = 119u;\nconst NOTE_OFF_MIN: u32 = 120u;\n\n?/g, '');
  }
  if (out === text) return { text, applied: false };
  return { text: out, applied: true };
}

/**
 * @param {string} filePath
 */
function migrateFile(filePath) {
  const rel = filePath.replace(SRC + '/', '');
  if (rel.startsWith('lib/') || rel.startsWith('legacy/')) return { rel, skipped: true };
  let text = readFileSync(filePath, 'utf8');
  if (text.includes('//#include "lib/circular_') || text.includes('//#include "lib/theme_')) {
    return { rel, skipped: true, reason: 'tier-b' };
  }

  const existingIncludes = new Set(
    [...text.matchAll(/\/\/#include\s+"([^"]+)"/g)].map((m) => m[1])
  );
  const toAdd = [];
  let body = text;

  for (const rule of LIB_RULES) {
    if (existingIncludes.has(rule.include)) continue;
    const { text: next, applied } = applyRule(body, rule);
    if (applied) {
      toAdd.push(rule.include);
      body = next;
    }
  }

  if (toAdd.length === 0) return { rel, changed: false };

  const headerEnd = body.search(/^(struct Uniforms|const NOTE_MIN|@group\(0\))/m);
  const insertAt = headerEnd > 0 ? headerEnd : body.length;
  const includeBlock = toAdd.map((i) => `//#include "${i}"`).join('\n') + '\n\n';
  const mergedIncludes = [...existingIncludes, ...toAdd];
  const newText =
    body.slice(0, insertAt) +
    includeBlock +
    body.slice(insertAt);

  writeFileSync(filePath, newText);
  return { rel, changed: true, includes: [...mergedIncludes] };
}

/**
 * @param {string} rel
 */
function verifyParity(rel) {
  const baseline = join(ROOT, '.shader-baselines', rel);
  const src = join(SRC, rel);
  if (!existsSync(baseline)) return { rel, parity: 'no-baseline' };
  const { flat } = expandShader(src);
  const base = readFileSync(baseline, 'utf8').replace(/\s+$/, '');
  const expanded = flat.replace(/\s+$/, '');
  return { rel, parity: base === expanded ? 'ok' : 'diff' };
}

const args = process.argv.slice(2);
const files = args.length
  ? args.map((f) => join(SRC, f))
  : [...new Set([
      ...['patternv0.50b.wgsl', 'patternv0.51.wgsl', 'patternv0.55.wgsl', 'patternv0.56.wgsl', 'patternv0.57.wgsl', 'patternv0.58.wgsl'],
      ...['patternv0.21.wgsl', 'patternv0.23.wgsl', 'patternv0.24.wgsl', 'patternv0.30.wgsl', 'patternv0.30b.wgsl', 'patternv0.35_bloom.wgsl', 'patternv0.38.wgsl', 'patternv0.39.wgsl', 'patternv0.40.wgsl', 'patternv0.42.wgsl', 'patternv0.43.wgsl', 'patternv0.44.wgsl', 'patternv0.45.wgsl', 'patternv0.45b.wgsl', 'patternv0.46.wgsl', 'patternv0.47.wgsl', 'patternv0.48.wgsl', 'patternv0.49.wgsl'],
    ])].map((f) => join(SRC, f));

const results = files.map(migrateFile);
console.log(JSON.stringify(results.filter((r) => r.changed || r.parity), null, 2));
