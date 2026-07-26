/**
 * v0.24 HUD grid must use fullCanvas cell sizing so cells fill canvas height.
 * Regression for #349 thin-band at top (props 24px cellH on 1024 canvas).
 */
import { describe, expect, it } from 'vitest';
import { resolveShaderMeta } from '../utils/shaderRegistry';
import type { CellSizeMode } from '../utils/shaderRegistry';

function effectiveCellSize(
  cellMode: CellSizeMode,
  props: { cellWidth: number; cellHeight: number },
  canvasW: number,
  canvasH: number,
  stepsCount: number,
  numChannels: number,
  gridRect = { w: 1, h: 1 },
): { cellW: number; cellH: number } {
  let cellW = props.cellWidth;
  let cellH = props.cellHeight;
  if (cellMode === 'gridRect') {
    cellW = (gridRect.w * canvasW) / stepsCount;
    cellH = (gridRect.h * canvasH) / numChannels;
  } else if (cellMode === 'fullCanvas') {
    cellW = canvasW / stepsCount;
    cellH = canvasH / numChannels;
  }
  return { cellW, cellH };
}

describe('patternv0.24 cell sizing', () => {
  it('registry uses fullCanvas (not props)', () => {
    expect(resolveShaderMeta('patternv0.24.wgsl').cellSizeMode).toBe('fullCanvas');
  });

  it('fullCanvas fills canvas height for typical 4-channel module', () => {
    const canvasW = 1024;
    const canvasH = 1024;
    const numChannels = 4;
    const stepsCount = 32;
    const meta = resolveShaderMeta('patternv0.24.wgsl');
    const { cellW, cellH } = effectiveCellSize(
      meta.cellSizeMode,
      { cellWidth: 120, cellHeight: 24 },
      canvasW,
      canvasH,
      stepsCount,
      numChannels,
    );
    expect(cellH).toBe(canvasH / numChannels);
    expect(numChannels * cellH).toBe(canvasH);
    expect(cellW).toBe(canvasW / stepsCount);
    // props mode would leave only 96px tall — the reported bug
    expect(numChannels * 24).toBeLessThan(canvasH);
  });
});
