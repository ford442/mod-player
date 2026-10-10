/** v0.61 FX chassis (#453): uniform layout agreement, registry, visual-state mapping. */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { PICKER_SHADER_IDS } from '../appConfig';
import {
  FX_BEZEL_UNIFORM_BYTES,
  FX_MODULE_BITS,
  FX_UNIFORM_SLOTS,
  fxVisualTargets,
  readFxVisual,
  resetFxVisualState,
  setFxVisualTargets,
} from '../audio/fx/fxVisualState';
import { defaultFxRackState, parseFxRackState } from '../audio/fx/spec/schema';
import { SHADER_REGISTRY } from '../utils/shaderRegistry';
import { usesFxUniforms } from '../utils/shaderVersion';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function structFields(src: string, name: string): string[] {
  const body = src.match(new RegExp(`struct\\s+${name}\\s*\\{([\\s\\S]*?)\\};`))?.[1] ?? '';
  return [...body.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]!);
}

describe('v0.61 FX chassis (#453)', () => {
  it('only fxUniforms shaders get the FX background, and v0.61 is in the picker', () => {
    const fx = Object.entries(SHADER_REGISTRY).filter(([, m]) => m.fxUniforms).map(([id]) => id);
    expect(fx).toEqual(['patternv0.61.wgsl']);
    for (const id of fx) expect(SHADER_REGISTRY[id]!.background).toBe('bezel_fx.wgsl');
    expect(usesFxUniforms('patternv0.60.wgsl')).toBe(false);
    expect(usesFxUniforms('patternv9.99.wgsl')).toBe(false);
    expect(PICKER_SHADER_IDS).toContain('patternv0.61.wgsl');
  });

  it('bezel_fx.wgsl declares the FX fields at the slots the host writes', () => {
    for (const rel of ['shaders/bezel_fx.wgsl', 'public/shaders/bezel_fx.wgsl']) {
      const fields = structFields(read(rel), 'BezelUniforms');
      expect(fields.indexOf('spectrumEnabled'), rel).toBe(23);
      expect(fields.indexOf('fxDrive'), rel).toBe(FX_UNIFORM_SLOTS.drive);
      expect(fields.indexOf('fxTone'), rel).toBe(FX_UNIFORM_SLOTS.tone);
      expect(fields.indexOf('fxRoom'), rel).toBe(FX_UNIFORM_SLOTS.room);
      expect(fields.indexOf('fxModuleMask'), rel).toBe(FX_UNIFORM_SLOTS.modules);
      expect(fields.length * 4, rel).toBe(FX_BEZEL_UNIFORM_BYTES);
    }
    const published = read('public/shaders/bezel_fx.wgsl');
    expect(published).not.toMatch(/^\s*\/\/\s*#include/m);
    expect(published).toContain('fn fxChassis(');
  });

  it('the host writes those bytes into a buffer big enough, and zeroes the slots elsewhere', () => {
    const frameDraw = read('src/renderers/webgpu/frameDraw.ts');
    expect(frameDraw).toMatch(/usesFxUniforms\(shaderFile\) \? FX_BEZEL_UNIFORM_BYTES : 96/);
    expect(frameDraw).toMatch(/bezelData\.fill\(0, FX_UNIFORM_SLOTS\.drive, FX_UNIFORM_SLOTS\.modules \+ 1\)/);
    const alloc = read('src/renderers/webgpu/WebGPURenderer.ts').match(/size: alignTo\((\d+), (\d+)\)/);
    const gpuBytes = Math.ceil(Number(alloc?.[1]) / Number(alloc?.[2])) * Number(alloc?.[2]);
    expect(gpuBytes).toBeGreaterThanOrEqual(FX_BEZEL_UNIFORM_BYTES);
    const scratch = read('src/renderers/webgpu/WebGPURenderer.ts').match(/bezelBufferData: new ArrayBuffer\((\d+)\)/);
    expect(Number(scratch?.[1])).toBeGreaterThanOrEqual(FX_BEZEL_UNIFORM_BYTES);
  });
});

describe('fxVisualState (#453)', () => {
  beforeEach(() => resetFxVisualState());

  it('maps rack settings to drive / tone / room / module bits', () => {
    const off = fxVisualTargets(defaultFxRackState());
    expect([...off]).toEqual([0, 0.5, 0, 0]);

    const s = defaultFxRackState();
    s.modules.character.enabled = true;
    s.modules.character.params.tapeOn = true;
    s.modules.character.params.drive = 0.7;
    s.modules.eq.enabled = true;
    s.modules.eq.params.highGain = 12;
    s.modules.eq.params.lowGain = -12;
    s.modules.room.enabled = true;
    s.modules.room.params.mix = 0.4;
    const on = fxVisualTargets(parseFxRackState(s));
    expect(on[0]).toBeCloseTo(0.7, 6);
    expect(on[1]).toBe(1); // full tilt bright
    expect(on[2]).toBeCloseTo(0.4, 6);
    expect(on[3]).toBe(FX_MODULE_BITS.character | FX_MODULE_BITS.eq | FX_MODULE_BITS.room);

    const noRoom = fxVisualTargets(parseFxRackState(s), false);
    expect(noRoom[2]).toBe(0);
    expect(noRoom[3]! & FX_MODULE_BITS.room).toBe(0);
    expect(fxVisualTargets(parseFxRackState({ ...s, enabled: false }))[3]).toBe(0); // rack bypassed
  });

  it('eases values in, switches the LED mask at once, and writes in place', () => {
    const s = defaultFxRackState();
    s.modules.room.enabled = true;
    s.modules.room.params.mix = 1;
    const out = new Float32Array(32);
    readFxVisual(0, out, 24); // first read snaps to the (neutral) targets
    setFxVisualTargets(parseFxRackState(s));
    readFxVisual(16, out, 24);
    expect(out[26]).toBeGreaterThan(0);
    expect(out[26]).toBeLessThan(0.2); // one frame in: still easing
    expect(out[27]).toBe(FX_MODULE_BITS.room); // LEDs switch immediately
    readFxVisual(2000, out, 24);
    expect(out[26]).toBeCloseTo(1, 6);
    expect(out[25]).toBe(0.5);
  });
});
