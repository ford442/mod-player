/**
 * Pattern edits must reach the WebGPU renderer: an edit keeps the pattern index, rows and channels,
 * so the renderer's packed-cells LRU used to hand back the pre-edit buffer until a shader switch
 * or module load. PlayerEngine.replacePatternMatrix now stamps a revision and the cache key
 * includes it.
 */
import { describe, expect, it, vi } from 'vitest';
import { PlayerEngine } from '../../audio/engine/PlayerEngine';
import { patternCellsCacheKey } from '../../src/renderers/webgpu/WebGPURenderer';
import type { PatternMatrix } from '../../types';

vi.hoisted(() => {
  Object.assign(globalThis, {
    GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
    GPUBufferUsage: { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 0x40, STORAGE: 0x80 },
    GPUTextureUsage: { COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 0x10 },
  });
});

const matrix = (order: number, patternIndex: number): PatternMatrix => ({
  order, patternIndex, numRows: 64, numChannels: 4, rows: [],
});

describe('pattern edit revision', () => {
  it('stamps a new revision on every replacePatternMatrix', () => {
    const engine = new PlayerEngine({ strictTransport: true });
    engine.replacePatternMatrix(matrix(1, 5));
    const first = engine.getSnapshot().sequencerMatrix;
    engine.replacePatternMatrix(matrix(1, 5));
    const second = engine.getSnapshot().sequencerMatrix;

    expect(first?.revision).toBeGreaterThan(0);
    expect(second?.revision).toBeGreaterThan(first?.revision ?? 0);
  });

  it('gives an edited pattern a different cells cache key', () => {
    const engine = new PlayerEngine({ strictTransport: true });
    const parsed = matrix(0, 7);
    engine.replacePatternMatrix(matrix(0, 7));
    const edited = engine.getSnapshot().sequencerMatrix;

    expect(patternCellsCacheKey(parsed, 64, 4)).not.toBe(patternCellsCacheKey(edited, 64, 4));
    // Same content revision → same key (the LRU still serves revisits without repacking).
    expect(patternCellsCacheKey(edited, 64, 4)).toBe(patternCellsCacheKey(edited, 64, 4));
    expect(patternCellsCacheKey(null, 64, 4)).toBe('-1:64:4:r0');
  });
});
