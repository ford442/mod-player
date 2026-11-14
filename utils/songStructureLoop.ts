/**
 * The loop region of the song map (#537 phase 2): A / B as a span of orders, and the detector that
 * tells playback running out of B from a seek. Pure — no libopenmpt, no DOM, no Web Audio — so the
 * engine (audio/engine/PlayerEngine.ts) and the map (components/SongMap.tsx) share one model.
 *
 * A region is a pair of order indices, `start ≤ end`, both *playable* (reached by playback, not a
 * `+++` / `---` marker). It loops the whole span: when playback leaves `end` (or any order of the span
 * that jumps out of it), the engine seeks to the first row of `start` through the ordinary
 * pending-seek path. No worklet message is involved, so the loop point is as exact as the position
 * reports are — see `stepLoop`.
 */
import { successorsOf, type SongStructure } from './songStructure';

export interface LoopRegion {
  /** First order of the loop (inclusive). */
  readonly start: number;
  /** Last order of the loop (inclusive); playback leaving it goes back to `start`. */
  readonly end: number;
}

export function sameLoopRegion(a: LoopRegion | null, b: LoopRegion | null): boolean {
  if (a === b) return true;
  return a !== null && b !== null && a.start === b.start && a.end === b.end;
}

const isPlayable = (structure: SongStructure, order: number): boolean => {
  const entry = structure.orders[order];
  return !!entry && entry.reachable && !entry.isSkip && !entry.isEnd;
};

/**
 * The region spanning orders `a` and `b` (either way round), pulled in to playable orders: the start
 * moves forward to the first playable order, the end back to the last. Null when the span holds none
 * (or an index is not an integer).
 */
export function makeLoopRegion(structure: SongStructure, a: number, b: number): LoopRegion | null {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  const last = structure.orders.length - 1;
  let start = Math.max(0, Math.min(a, b));
  let end = Math.min(last, Math.max(a, b));
  while (start <= end && !isPlayable(structure, start)) start += 1;
  while (end >= start && !isPlayable(structure, end)) end -= 1;
  return start <= end ? { start, end } : null;
}

/**
 * Shift-click on an order chip: no region → that order alone; outside the region → grow to include it;
 * inside → shrink to that order alone, and clicking the only order of a one-order region clears it.
 */
export function extendLoopRegion(
  structure: SongStructure,
  region: LoopRegion | null,
  order: number,
): LoopRegion | null {
  if (!region) return makeLoopRegion(structure, order, order);
  if (order < region.start) return makeLoopRegion(structure, order, region.end);
  if (order > region.end) return makeLoopRegion(structure, region.start, order);
  if (region.start === region.end && order === region.start) return null;
  return makeLoopRegion(structure, order, order);
}

/**
 * Loop in / out at `order` (the keyboard: Shift+[ / Shift+]). The other end stays; when the new edge
 * would cross it, the region collapses to that order — the same as marking both.
 */
export function setLoopEdge(
  structure: SongStructure,
  region: LoopRegion | null,
  edge: 'start' | 'end',
  order: number,
): LoopRegion | null {
  if (!region) return makeLoopRegion(structure, order, order);
  return edge === 'start'
    ? makeLoopRegion(structure, order, Math.max(order, region.end))
    : makeLoopRegion(structure, Math.min(order, region.start), order);
}

/** A stored / untrusted value → a region valid for `structure`, or null. */
export function parseLoopRegion(structure: SongStructure, value: unknown): LoopRegion | null {
  if (typeof value !== 'object' || value === null) return null;
  const { start, end } = value as { start?: unknown; end?: unknown };
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  return makeLoopRegion(structure, start, end);
}

/** The span on the song's clock (first pass): where the region starts and where it ends. */
export function loopRegionSeconds(
  structure: SongStructure,
  region: LoopRegion,
): { start: number; end: number } {
  const first = structure.orders[region.start];
  const last = structure.orders[region.end];
  return {
    start: first?.startSeconds ?? 0,
    end: last ? last.startSeconds + last.durationSeconds : 0,
  };
}

/**
 * What the crossing detector remembers between position reports: whether the previous report was
 * inside the region, and in which order.
 */
export interface LoopTracker {
  readonly inside: boolean;
  readonly lastOrder: number;
}

export const LOOP_TRACKER_IDLE: LoopTracker = { inside: false, lastOrder: -1 };

export interface LoopStep {
  readonly tracker: LoopTracker;
  /** Order to seek to (its first row), or null to leave playback alone. */
  readonly seekTo: number | null;
}

/**
 * Feed one position report (the `order` playback is rendering now). Returns where to seek, if
 * playback just ran out of the region.
 *
 * Only a *natural* exit loops: the previous report was inside the region and `order` is somewhere
 * playback goes from there on its own (`successorsOf`: the next order played, a jump target, the song
 * loop). That is what keeps the loop out of the user's way:
 *   - playback that has not reached the region yet is not touched;
 *   - a seek out of the region (a chip click, `]`) lands somewhere that is not a successor of the
 *     order it left, so it leaves the region — until playback runs into it again, which arms it anew;
 *   - after the loop seeks, reports still in flight (the order after the region) are outside with no
 *     armed state, so they cannot trigger a second seek.
 * A seek from the region's end to the very next order is indistinguishable from playback getting
 * there and loops back.
 */
export function stepLoop(
  structure: SongStructure,
  region: LoopRegion,
  tracker: LoopTracker,
  order: number,
): LoopStep {
  if (order >= region.start && order <= region.end) {
    const same = tracker.inside && tracker.lastOrder === order;
    return { tracker: same ? tracker : { inside: true, lastOrder: order }, seekTo: null };
  }
  if (tracker.inside && successorsOf(structure, tracker.lastOrder).has(order)) {
    return { tracker: LOOP_TRACKER_IDLE, seekTo: region.start };
  }
  const same = !tracker.inside && tracker.lastOrder === order;
  return { tracker: same ? tracker : { inside: false, lastOrder: order }, seekTo: null };
}
