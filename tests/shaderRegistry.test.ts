/**
 * Shader registry tests — every SHADER_GROUPS id must be registered and the helpers in
 * utils/shaderVersion.ts + utils/geometryConstants.ts must agree with ShaderMeta.
 *
 * Ported from utils/__debug__/shaderRegistry.test.cjs, which ran each case through
 * `npx --yes tsx` (tsx was never a dependency, so it was downloaded on every run).
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_SHADER_IDS, DEFAULT_SHADER, PUBLIC_DEFAULT_SHADER, SHADER_GROUPS_ALL } from '../appConfig';
import type { PatternMatrix } from '../types';
import { BLOOM_PROFILES } from '../utils/bloomProfiles';
import { LAYOUT_MODES, getLayoutModeFromShader } from '../utils/geometryConstants';
import { computeNoteAges } from '../utils/patternExtractor';
import { SHADER_REGISTRY, resolveShaderMeta } from '../utils/shaderRegistry';
import {
  WEBGL_HYBRID_SHADERS,
  getBackgroundShaderFile,
  getHitTestProfile,
  getLayoutType,
  hasEmbeddedTransportUI,
  isCircularLayoutShader,
  isHorizontalLayoutShader,
  isSinglePassCompositeShader,
  needsChassisControlFields,
  shouldEnableAlphaBlending,
  supportsStepsLength,
  usesAudioReactive,
  usesCircularRowPaging,
  usesHighPrecisionPacking,
  usesInstrumentPalette,
  usesOscilloscope,
  usesPadTopChannel,
  usesPlayheadRowAsFloat,
  usesStrictPlayheadSustainMode,
  usesWebGLOverlayHorizontal,
} from '../utils/shaderVersion';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const registry = Object.entries(SHADER_REGISTRY);

function meta(id: string) {
  const m = SHADER_REGISTRY[id];
  if (!m) throw new Error(`${id} is not in SHADER_REGISTRY`);
  return m;
}

describe('registry + SHADER_GROUPS coverage', () => {
  it('registers every id offered in the shader picker', () => {
    const missing: string[] = [];
    for (const group of Object.values(SHADER_GROUPS_ALL)) {
      for (const { id } of group) {
        if (!SHADER_REGISTRY[id]) missing.push(id);
      }
    }
    expect(missing).toEqual([]);
  });

  it('registers every id in ALL_SHADER_IDS', () => {
    const missing = [...ALL_SHADER_IDS].filter((id) => !SHADER_REGISTRY[id]);
    expect(missing).toEqual([]);
  });

  it('has a registered default shader that is also the public default', () => {
    expect(SHADER_REGISTRY[DEFAULT_SHADER]).toBeDefined();
    expect(DEFAULT_SHADER).toBe(PUBLIC_DEFAULT_SHADER);
  });

  it('keeps the parity-target shaders registered', () => {
    const parity = [
      'patternv0.21.wgsl', 'patternv0.30b.wgsl', 'patternv0.40.wgsl',
      'patternv0.50.wgsl', 'patternv0.51.wgsl', 'patternv0.52.wgsl',
      'patternv0.53.wgsl', 'patternv0.54.wgsl', 'patternv0.55.wgsl',
      'patternv0.56.wgsl', 'patternv0.57.wgsl', 'patternv0.58.wgsl',
    ];
    expect(parity.filter((id) => !SHADER_REGISTRY[id])).toEqual([]);
  });

  it.each(registry)('%s: shaderVersion / geometry helpers agree with ShaderMeta', (filename, m) => {
    expect(WEBGL_HYBRID_SHADERS.has(filename), 'webglHybrid').toBe(m.webglHybrid);
    expect(getLayoutType(filename), 'layout').toBe(m.extendedLayout ? 'extended' : 'standard');
    expect(isCircularLayoutShader(filename), 'circular').toBe(m.circular);
    expect(getBackgroundShaderFile(filename), 'background').toBe(m.background);
    expect(shouldEnableAlphaBlending(filename), 'alphaBlending').toBe(m.alphaBlending);
    expect(isSinglePassCompositeShader(filename), 'singlePassComposite').toBe(m.singlePassComposite);
    expect(supportsStepsLength(filename), 'supportsStepsLength').toBe(m.supportsStepsLength);
    expect(usesHighPrecisionPacking(filename), 'highPrecisionPacking').toBe(m.highPrecisionPacking);
    expect(usesPlayheadRowAsFloat(filename), 'playheadRowAsFloat').toBe(m.playheadRowAsFloat);
    expect(usesPadTopChannel(filename), 'padTopChannel').toBe(m.padTopChannel);
    expect(usesStrictPlayheadSustainMode(filename), 'strictPlayheadSustain').toBe(m.strictPlayheadSustain);
    expect(usesOscilloscope(filename), 'oscilloscope').toBe(m.oscilloscope);
    expect(usesInstrumentPalette(filename), 'instrumentPalette').toBe(m.instrumentPalette);
    expect(usesAudioReactive(filename), 'audioReactive').toBe(m.audioReactive);
    expect(getHitTestProfile(filename), 'hitTestProfile').toBe(m.hitTestProfile);
    expect(usesCircularRowPaging(filename), 'circularRowPaging').toBe(m.circularRowPaging);
    expect(isHorizontalLayoutShader(filename), 'isHorizontal').toBe(m.layoutMode === 'horizontal_32');
    expect(needsChassisControlFields(filename), 'needsChassisControlFields').toBe(m.chassisControlEncoding !== 'none');
    expect(usesWebGLOverlayHorizontal(filename), 'webglOverlayHorizontal').toBe(m.webglOverlayHorizontal);
    expect(hasEmbeddedTransportUI(filename), 'hasEmbeddedTransportUI').toBe(m.hitTestProfile !== 'none');
    expect(getLayoutModeFromShader(filename), 'layoutMode helper').toBe(
      m.layoutMode === 'horizontal_32' ? LAYOUT_MODES.HORIZONTAL_32 : LAYOUT_MODES.CIRCULAR,
    );
    expect(resolveShaderMeta(filename).canvasSize.width, 'resolve canvasSize').toBe(m.canvasSize.width);
    if (m.singlePassComposite) {
      expect(m.singlePassComposite, 'singlePassComposite == background').toBe(m.background);
    }
  });

  it('keeps the per-shader parity fields', () => {
    const m21 = meta('patternv0.21.wgsl');
    expect([m21.liteRecommended, m21.webglHybrid, m21.padTopChannel, m21.webglOverlayHorizontal]).toEqual([
      true, true, true, true,
    ]);
    const m30b = meta('patternv0.30b.wgsl');
    expect([m30b.strictPlayheadSustain, m30b.highPrecisionPacking]).toEqual([true, true]);
    const m40 = meta('patternv0.40.wgsl');
    expect(m40.hitTestProfile).toBe('square-ui');
    expect(m40.bareCanvasChrome).toBeTruthy();
    const m50 = meta('patternv0.50.wgsl');
    expect(m50.stepsDrivenVisibleRows).toBeTruthy();
    expect(m50.bloomProfile).toBe('three-emitter');
    expect(meta('patternv0.55.wgsl').oscilloscope).toBeTruthy();
    expect(meta('patternv0.56.wgsl').instrumentPalette).toBeTruthy();
    expect(meta('patternv0.57.wgsl').stepsDrivenVisibleRows).toBeTruthy();
    expect(meta('patternv0.58.wgsl').audioReactive).toBeTruthy();
    // HUD grid fills the canvas height.
    expect(meta('patternv0.24.wgsl').cellSizeMode).toBe('fullCanvas');
  });
});

describe('bloom profile consistency', () => {
  it('every ShaderMeta.bloomProfile exists in BLOOM_PROFILES', () => {
    const bad = registry
      .filter(([, m]) => m.bloomProfile !== null && !(m.bloomProfile in BLOOM_PROFILES))
      .map(([filename, m]) => `${filename}: ${String(m.bloomProfile)}`);
    expect(bad).toEqual([]);
  });

  it('every bloom profile has exactly 3 layers', () => {
    for (const [id, layers] of Object.entries(BLOOM_PROFILES)) {
      expect(layers.length, `BLOOM_PROFILES["${id}"]`).toBe(3);
    }
  });

  it.each([
    ['patternv0.50.wgsl', 'three-emitter'],
    ['patternv0.50b.wgsl', 'three-emitter'],
    ['patternv0.51.wgsl', 'three-emitter'],
    ['patternv0.55.wgsl', 'three-emitter-osc'],
  ])('%s uses the %s bloom profile', (filename, profile) => {
    expect(SHADER_REGISTRY[filename]?.bloomProfile).toBe(profile);
  });
});

describe('computeNoteAges note range', () => {
  const emptyCell = { type: 'empty' as const, text: '', note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 };
  const emptyRows = Array.from({ length: 63 }, () => [{ ...emptyCell }]);
  const firstRowAge = (note: number, inst: number): number | undefined => {
    const matrix: PatternMatrix = {
      order: 0, patternIndex: 0, numRows: 64, numChannels: 1,
      rows: [[{ type: 'note' as const, text: '', note, inst, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }], ...emptyRows],
    };
    return computeNoteAges(matrix, 4)[0];
  };

  it('recognises every note 1–119 as a note-on (not the 1000 "no note" age)', () => {
    const unrecognised: number[] = [];
    for (let note = 1; note <= 119; note++) {
      if (firstRowAge(note, 1) === 1000) unrecognised.push(note);
    }
    expect(unrecognised).toEqual([]);
  });

  it.each([120, 254, 255])('treats note %i as a note-off (age 1000)', (noteOff) => {
    expect(firstRowAge(noteOff, 0)).toBe(1000);
  });
});

describe('render path stays registry-driven', () => {
  // Capabilities live on ShaderMeta (utils/shaderRegistry.ts); new `shaderFile.includes('v0.XX')`
  // chains in the render path are forbidden (CLAUDE.md "Critical: Shader Registry").
  const FORBIDDEN = /shaderFile\.includes\s*\(\s*['"]v0\./;
  const SCAN = ['components', 'hooks', 'src/renderers', 'utils/geometryConstants.ts'].map((p) => join(ROOT, p));
  // inferLegacyMeta lives here; it is not scanned (it is not under SCAN) but keep the intent explicit.
  const ALLOWLIST = new Set([join(ROOT, 'utils/shaderRegistry.ts')]);

  function* sourceFiles(target: string): Generator<string> {
    if (!existsSync(target)) return;
    if (statSync(target).isFile()) {
      if (/\.(ts|tsx)$/.test(target)) yield target;
      return;
    }
    for (const entry of readdirSync(target)) yield* sourceFiles(join(target, entry));
  }

  it('has no shaderFile.includes("v0.…") chains', () => {
    const offenders: string[] = [];
    for (const dir of SCAN) {
      for (const file of sourceFiles(dir)) {
        if (ALLOWLIST.has(file)) continue;
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          if (FORBIDDEN.test(line) && !line.trimStart().startsWith('//') && !line.includes('Do **not**')) {
            offenders.push(`${relative(ROOT, file)}: ${line.trim().slice(0, 80)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
