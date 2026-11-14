/**
 * #537 phase 2: the loop region's pure model (utils/songStructureLoop.ts) — editing the span, the
 * crossing detector, and the map's hit test / band geometry. No Web Audio, no WASM.
 */
import { describe, expect, it } from 'vitest';
import { layoutSongMap, loopBand, orderAtPercent, selectSongMap } from '../../components/songMapModel';
import {
  ORDER_PATTERN_END,
  ORDER_PATTERN_SKIP,
  type SongJump,
  type SongOrder,
  type SongStructure,
} from '../../utils/songStructure';
import {
  LOOP_TRACKER_IDLE,
  extendLoopRegion,
  loopRegionSeconds,
  makeLoopRegion,
  parseLoopRegion,
  sameLoopRegion,
  setLoopEdge,
  stepLoop,
  type LoopRegion,
  type LoopTracker,
} from '../../utils/songStructureLoop';
import type { PlayerSnapshot } from '../../audio/engine/PlayerEngine';

interface Spec {
  /** 'skip' | 'end' | 'dead' (a pattern playback never reaches) | a normal order. */
  kind?: 'skip' | 'end' | 'dead';
}

/** Orders of 4 s each, played in index order, except the specified markers / dead orders. */
function structureOf(specs: Spec[], jumps: SongJump[] = [], playOrder?: number[]): SongStructure {
  let t = 0;
  const orders: SongOrder[] = specs.map((spec, index) => {
    const isSkip = spec.kind === 'skip';
    const isEnd = spec.kind === 'end';
    const reachable = !spec.kind;
    const o: SongOrder = {
      index,
      pattern: isSkip ? ORDER_PATTERN_SKIP : isEnd ? ORDER_PATTERN_END : index,
      rows: isSkip || isEnd ? 0 : 16,
      startSeconds: t,
      durationSeconds: reachable ? 4 : 0,
      entryRow: 0,
      exitRow: 15,
      isSkip,
      isEnd,
      reachable,
    };
    if (reachable) t += 4;
    return o;
  });
  return {
    orders,
    jumps,
    tempoEvents: [],
    totalSeconds: t,
    playOrder: playOrder ?? orders.filter((o) => o.reachable).map((o) => o.index),
    approximate: false,
  };
}

const plain = (n: number) => structureOf(Array.from({ length: n }, () => ({})));

describe('makeLoopRegion', () => {
  it('orders the two ends and keeps a valid span as is', () => {
    expect(makeLoopRegion(plain(6), 4, 2)).toEqual({ start: 2, end: 4 });
    expect(makeLoopRegion(plain(6), 3, 3)).toEqual({ start: 3, end: 3 });
  });

  it('clamps to the order list', () => {
    expect(makeLoopRegion(plain(4), -5, 99)).toEqual({ start: 0, end: 3 });
  });

  it('pulls the ends in to playable orders (no +++ / --- markers, no unreached orders)', () => {
    const s = structureOf([{}, { kind: 'skip' }, { kind: 'dead' }, {}, { kind: 'end' }]);
    expect(makeLoopRegion(s, 1, 4)).toEqual({ start: 3, end: 3 });
    expect(makeLoopRegion(s, 0, 4)).toEqual({ start: 0, end: 3 });
    expect(makeLoopRegion(s, 1, 2)).toBeNull();
    expect(makeLoopRegion(s, 4, 4)).toBeNull();
  });

  it('rejects non-integers', () => {
    expect(makeLoopRegion(plain(4), 1.5, 2)).toBeNull();
    expect(makeLoopRegion(plain(4), Number.NaN, 2)).toBeNull();
  });

  it('an empty song has no region', () => {
    expect(makeLoopRegion(structureOf([]), 0, 0)).toBeNull();
  });
});

describe('extendLoopRegion (shift-click)', () => {
  const s = plain(8);
  it('starts a one-order region, then grows to either side', () => {
    const one = extendLoopRegion(s, null, 3);
    expect(one).toEqual({ start: 3, end: 3 });
    expect(extendLoopRegion(s, one, 6)).toEqual({ start: 3, end: 6 });
    expect(extendLoopRegion(s, one, 1)).toEqual({ start: 1, end: 3 });
  });

  it('inside a wider region it shrinks to that order; the only order of a one-order region clears it', () => {
    expect(extendLoopRegion(s, { start: 2, end: 5 }, 4)).toEqual({ start: 4, end: 4 });
    expect(extendLoopRegion(s, { start: 4, end: 4 }, 4)).toBeNull();
  });

  it('a marker chip alone makes no region', () => {
    const m = structureOf([{}, { kind: 'skip' }, {}]);
    expect(extendLoopRegion(m, null, 1)).toBeNull();
  });
});

describe('setLoopEdge (Shift+[ / Shift+])', () => {
  const s = plain(8);
  it('without a region, either edge marks the order', () => {
    expect(setLoopEdge(s, null, 'start', 2)).toEqual({ start: 2, end: 2 });
    expect(setLoopEdge(s, null, 'end', 5)).toEqual({ start: 5, end: 5 });
  });

  it('moves one edge and keeps the other', () => {
    expect(setLoopEdge(s, { start: 1, end: 4 }, 'start', 2)).toEqual({ start: 2, end: 4 });
    expect(setLoopEdge(s, { start: 1, end: 4 }, 'end', 6)).toEqual({ start: 1, end: 6 });
  });

  it('collapses to the order when the new edge would cross the other', () => {
    expect(setLoopEdge(s, { start: 1, end: 4 }, 'start', 6)).toEqual({ start: 6, end: 6 });
    expect(setLoopEdge(s, { start: 3, end: 4 }, 'end', 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('parseLoopRegion / sameLoopRegion / loopRegionSeconds', () => {
  const s = plain(6);
  it('accepts a stored region and re-validates it against this song', () => {
    expect(parseLoopRegion(s, { start: 1, end: 3 })).toEqual({ start: 1, end: 3 });
    expect(parseLoopRegion(s, { start: 4, end: 40 })).toEqual({ start: 4, end: 5 }); // the song got shorter
  });

  it('rejects anything else', () => {
    for (const junk of [null, undefined, 3, 'x', {}, { start: '1', end: 2 }, { start: 1 }, [1, 2]]) {
      expect(parseLoopRegion(s, junk)).toBeNull();
    }
  });

  it('compares by value', () => {
    expect(sameLoopRegion({ start: 1, end: 2 }, { start: 1, end: 2 })).toBe(true);
    expect(sameLoopRegion({ start: 1, end: 2 }, { start: 1, end: 3 })).toBe(false);
    expect(sameLoopRegion(null, null)).toBe(true);
    expect(sameLoopRegion(null, { start: 0, end: 0 })).toBe(false);
  });

  it('gives the span on the song clock', () => {
    expect(loopRegionSeconds(s, { start: 1, end: 3 })).toEqual({ start: 4, end: 16 });
  });
});

/** Feed order reports; collect the seeks (and apply them as the engine does: the next report is the target). */
function run(s: SongStructure, region: LoopRegion, reports: number[], tracker: LoopTracker = LOOP_TRACKER_IDLE) {
  const seeks: Array<[number, number]> = [];
  reports.forEach((order, i) => {
    const step = stepLoop(s, region, tracker, order);
    tracker = step.tracker;
    if (step.seekTo !== null) seeks.push([i, step.seekTo]);
  });
  return { seeks, tracker };
}

describe('stepLoop — the crossing detector', () => {
  const s = plain(6);
  const region = { start: 2, end: 3 };

  it('does not touch playback that has not reached the region yet', () => {
    expect(run(s, region, [0, 0, 1, 1, 1]).seeks).toEqual([]);
  });

  it('seeks to the start when playback runs out of the end', () => {
    expect(run(s, region, [1, 2, 2, 3, 3, 4]).seeks).toEqual([[5, 2]]);
  });

  it('does not seek twice for the reports still in flight after the loop seek', () => {
    // After the seek the engine's own position is the start; stale reports of order 4 may follow.
    const first = run(s, region, [2, 3, 4]);
    expect(first.seeks).toEqual([[2, 2]]);
    expect(run(s, region, [4, 4, 4, 2, 2, 3], first.tracker).seeks).toEqual([]);
    // …and the loop works again on the next pass.
    expect(run(s, region, [4, 2, 3, 4], first.tracker).seeks).toEqual([[3, 2]]);
  });

  it('a user seek out of the middle of the region leaves it alone', () => {
    expect(run(s, region, [2, 2, 5, 5, 5]).seeks).toEqual([]); // 2 → 5: not what playback does from 2
    expect(run(s, region, [3, 0, 0]).seeks).toEqual([]); // 3 → 0: not a successor of 3
  });

  it('a seek from the end into the region and back out is not a loop either', () => {
    expect(run(s, region, [3, 3, 1, 1]).seeks).toEqual([]);
  });

  it('re-arms after a seek back into the region from outside', () => {
    const r = run(s, region, [5, 5, 2, 3, 4]);
    expect(r.seeks).toEqual([[4, 2]]);
  });

  it('a one-order region loops that order', () => {
    expect(run(s, { start: 1, end: 1 }, [0, 1, 1, 2]).seeks).toEqual([[3, 1]]);
  });

  it('follows a jump out of the region (Bxx at an inner order)', () => {
    const jumps: SongJump[] = [{ kind: 'jump', fromOrder: 2, fromRow: 7, toOrder: 5, toRow: 0, loops: false }];
    const j = structureOf(Array.from({ length: 6 }, () => ({})), jumps, [0, 1, 2, 5, 3, 4]);
    // 2 jumps to 5: leaving the region (2–3) from order 2 by its own jump is a natural exit.
    expect(run(j, region, [1, 2, 5]).seeks).toEqual([[2, 2]]);
    // …but 5 straight after 3 is not (3 → 4 is what plays).
    expect(run(j, region, [3, 3, 5]).seeks).toEqual([]);
  });

  it('the last order played loops to the first: a region that ends there seeks back from the song loop', () => {
    const last = { start: 4, end: 5 };
    expect(run(s, last, [4, 5, 0]).seeks).toEqual([[2, 4]]);
  });

  it('skips +++ markers: the next order played is a successor even when indices jump', () => {
    const m = structureOf([{}, {}, { kind: 'skip' }, {}, {}]);
    expect(run(m, { start: 0, end: 1 }, [0, 1, 3]).seeks).toEqual([[2, 0]]);
  });
});

describe('song map view helpers', () => {
  const s = plain(4); // four equal chips
  const layout = layoutSongMap(s);

  it('orderAtPercent finds the chip under the pointer and clamps to the ends', () => {
    expect(orderAtPercent(layout, 0)).toBe(0);
    expect(orderAtPercent(layout, layout[2]!.left + 0.01)).toBe(2);
    expect(orderAtPercent(layout, layout[3]!.left - 0.01)).toBe(2);
    expect(orderAtPercent(layout, 100)).toBe(3);
    expect(orderAtPercent(layout, -20)).toBe(0);
    expect(orderAtPercent(layout, 500)).toBe(3);
    expect(orderAtPercent([], 10)).toBeNull();
    expect(orderAtPercent(layout, Number.NaN)).toBeNull();
  });

  it('loopBand spans from the start chip to the end of the end chip', () => {
    const band = loopBand(layout, { start: 1, end: 2 })!;
    expect(band.left).toBeCloseTo(layout[1]!.left, 9);
    expect(band.left + band.width).toBeCloseTo(layout[2]!.left + layout[2]!.width, 9);
    expect(loopBand(layout, null)).toBeNull();
    expect(loopBand(layout, { start: 9, end: 9 })).toBeNull();
  });

  it('selectSongMap carries the region (the map re-renders when it changes)', () => {
    const region = { start: 1, end: 2 };
    const view = selectSongMap({ songStructure: s, moduleInfo: { order: 3 }, loopRegion: region } as unknown as PlayerSnapshot);
    expect(view).toEqual({ structure: s, order: 3, loopRegion: region });
  });
});
