#!/usr/bin/env node
/**
 * Tier-A WGSL migration — strip known lib functions by name, add //#include directives.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandShader } from './sync-shaders.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'shaders');

/** @type {{ include: string, strip: string[] }[]} */
const LIBS = [
  { include: 'lib/notes.wgsl', strip: [] }, // const block stripped separately
  { include: 'lib/palette.wgsl', strip: ['selectPalette'] },
  { include: 'lib/sdf.wgsl', strip: ['sdRoundedBox', 'sdCircle', 'sdEllipse'] },
  { include: 'lib/tonemap.wgsl', strip: ['acesToneMap'] },
  { include: 'lib/color_preserve.wgsl', strip: [] },
  { include: 'lib/pitch.wgsl', strip: ['pitchClassFromIndex', 'fifthsHue', 'octaveBrightness', 'pitchHueForPalette', 'neonPalette'] },
  { include: 'lib/dura.wgsl', strip: ['unpackDurationInfo', 'calculateSustainBrightness'] },
  { include: 'lib/top_emitter.wgsl', strip: ['calculateTopIntensity'] },
  { include: 'lib/brilliant_led.wgsl', strip: ['brilliantLEDCore'] },
  { include: 'lib/velocity_led.wgsl', strip: ['normalizedCellVolume'] },
];

const NOTE_CONSTS = /(\/\/ DURA: Note duration constants\n)?const NOTE_MIN: u32 = 1u;\nconst NOTE_MAX: u32 = 119u;\nconst NOTE_OFF_MIN: u32 = 120u;\n\n?/g;
const NOTE_DURATION_STRUCT = /\/\/ DURA: Structure to hold unpacked note duration info\nstruct NoteDurationInfo \{[\s\S]*?\n\}\n\n?/g;
const COLOR_PRESERVE = /\/\/ Scale factor for hue-preservation[\s\S]*?const COLOR_PRESERVE_MAX: f32\s+=\s+0\.85;\n\n?/g;
const ACES_BLOCK = /\/\/ ACES Filmic Tone Mapping[\s\S]*?fn acesToneMap\(color: vec3<f32>\) -> vec3<f32> \{[\s\S]*?\n\}\n\n?/g;

function stripFn(source, name) {
  const sig = `fn ${name}(`;
  let idx = 0;
  let out = source;
  while ((idx = out.indexOf(sig, idx)) !== -1) {
    const braceStart = out.indexOf('{', idx);
    if (braceStart === -1) break;
    let depth = 0;
    let i = braceStart;
    for (; i < out.length; i++) {
      if (out[i] === '{') depth++;
      else if (out[i] === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    // include trailing newline
    while (out[i] === '\n') i++;
    out = out.slice(0, idx) + out.slice(i);
    idx = idx;
  }
  return out;
}

function hasFn(source, name) {
  return source.includes(`fn ${name}(`);
}

function migrate(filePath) {
  const rel = filePath.replace(SRC + '/', '');
  if (!rel.startsWith('patternv') || rel.includes('legacy')) return null;
  if (/circular_(led|night)_body|theme_/.test(readFileSync(filePath, 'utf8')) && rel.match(/v0\.5[02]|v0\.5[234]\.wgsl/)) {
    if (rel.includes('v0.50.wgsl') || rel.includes('v0.52') || rel.includes('v0.53') || rel.includes('v0.54')) {
      return { rel, skipped: 'tier-b' };
    }
  }
  let text = readFileSync(filePath, 'utf8');
  const existing = new Set([...text.matchAll(/\/\/#include\s+"([^"]+)"/g)].map((m) => m[1]));
  const added = [];

  if (NOTE_CONSTS.test(text) && !existing.has('lib/notes.wgsl')) {
    text = text.replace(NOTE_CONSTS, '');
    added.push('lib/notes.wgsl');
    existing.add('lib/notes.wgsl');
  } else if (text.includes('const NOTE_MIN:') && !existing.has('lib/notes.wgsl')) {
    text = text.replace(/const NOTE_MIN: u32 = 1u;\nconst NOTE_MAX: u32 = 119u;\nconst NOTE_OFF_MIN: u32 = 120u;\n\n?/g, '');
    added.push('lib/notes.wgsl');
    existing.add('lib/notes.wgsl');
  }

  if (NOTE_DURATION_STRUCT.test(text) && !existing.has('lib/dura.wgsl')) {
    text = text.replace(NOTE_DURATION_STRUCT, '');
  }

  if (COLOR_PRESERVE.test(text) && !existing.has('lib/color_preserve.wgsl')) {
    text = text.replace(COLOR_PRESERVE, '');
    if (!existing.has('lib/color_preserve.wgsl')) {
      added.push('lib/color_preserve.wgsl');
      existing.add('lib/color_preserve.wgsl');
    }
  }

  for (const lib of LIBS) {
    const needed = lib.strip.some((fn) => hasFn(text, fn));
    const needsLib = lib.include === 'lib/notes.wgsl' ? false : needed || (lib.include === 'lib/dura.wgsl' && hasFn(text, 'unpackDurationInfo'));
    if (!needsLib || existing.has(lib.include)) continue;
    for (const fn of lib.strip) text = stripFn(text, fn);
    if (lib.include === 'lib/dura.wgsl' && hasFn(text, 'unpackDurationInfo')) {
      text = stripFn(text, 'unpackDurationInfo');
      text = stripFn(text, 'calculateSustainBrightness');
    }
    added.push(lib.include);
    existing.add(lib.include);
  }

  // Strip duplicate struct if dura included
  if (existing.has('lib/dura.wgsl')) {
    text = text.replace(NOTE_DURATION_STRUCT, '');
  }

  if (added.length === 0) return { rel, changed: false };

  text = text.replace(/\n{3,}/g, '\n\n');
  const m = text.match(/^([\s\S]*?)(?=struct Uniforms|@group\(0\)|const THEME_)/);
  const header = m ? m[1] : '';
  const rest = text.slice(header.length);
  const includeLines = [...existing].filter((i) => i.startsWith('lib/')).sort();
  const block = includeLines.map((i) => `//#include "${i}"`).join('\n');
  const newText = `${header.trimEnd()}\n\n${block}\n\n${rest.replace(/^\n+/, '')}`;
  writeFileSync(filePath, newText);
  return { rel, changed: true, includes: includeLines };
}

function parity(rel) {
  const b = join(ROOT, '.shader-baselines', rel);
  const s = join(SRC, rel);
  if (!existsSync(b)) return 'no-baseline';
  const { flat } = expandShader(s);
  return readFileSync(b, 'utf8').replace(/\s+$/, '') === flat.replace(/\s+$/, '') ? 'ok' : 'diff';
}

const files = process.argv.length > 2
  ? process.argv.slice(2).map((f) => join(SRC, f))
  : readdirSync(SRC).filter((f) => f.startsWith('patternv') && f.endsWith('.wgsl')).map((f) => join(SRC, f));

const results = files.map((f) => {
  const r = migrate(f);
  if (r?.changed) r.parity = parity(r.rel);
  return r;
}).filter(Boolean);

console.log(JSON.stringify(results.filter((r) => r.changed || r.parity === 'diff'), null, 2));
