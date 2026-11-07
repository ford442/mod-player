/**
 * Song map (#537) view model: chip layout, pattern hues and the two snapshot selectors. Kept out of
 * the .tsx so the render-rate test (tests/unit/songMapRenderRate.test.ts) runs the exact selectors
 * the components use, without a DOM.
 *
 * The map re-renders on load and on order change only (`selectSongMap`); the row-rate playhead is a
 * leaf with its own selector (`selectSongMapPlayhead`) — pitfall 17.
 */
import type { PlayerSnapshot } from '../audio/engine/PlayerEngine';
import { rowFractionInOrder, type SongStructure } from '../utils/songStructure';

export interface ChipLayout {
  /** Percent of the map's width. */
  readonly left: number;
  readonly width: number;
}

/**
 * Chips in order-list order, width ∝ the order's first-pass duration, plus a floor so markers and
 * never-reached orders stay visible (and clickable). The floor shrinks with long order lists so it
 * never takes more than ~30% of the width.
 */
export function layoutSongMap(structure: SongStructure): ChipLayout[] {
  const n = structure.orders.length;
  if (n === 0) return [];
  const minPct = Math.min(0.6, 30 / n);
  const total = structure.orders.reduce((sum, o) => sum + o.durationSeconds, 0);
  const share = 100 - n * minPct;
  let left = 0;
  return structure.orders.map((o) => {
    const width = minPct + (total > 0 ? (share * o.durationSeconds) / total : share / n);
    const chip = { left, width };
    left += width;
    return chip;
  });
}

/** Same pattern → same hue (golden-angle spacing), so repeats read as repeats. A fixed palette. */
export function patternHue(pattern: number): number {
  return Math.round((pattern * 137.508) % 360);
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface SongMapView {
  structure: SongStructure | null;
  order: number;
}

/** SongMap: the structure (once per load) and the current order (a few per second at most). */
export const selectSongMap = (s: PlayerSnapshot): SongMapView => ({
  structure: s.songStructure,
  order: s.moduleInfo.order,
});

/** The playhead leaf: order + fractional row — row rate. */
export const selectSongMapPlayhead = (s: PlayerSnapshot): { order: number; row: number } => ({
  order: s.moduleInfo.order,
  row: s.playbackRowFraction,
});

/** Playhead position along the map, percent; null when the order has no chip. */
export function playheadPercent(
  structure: SongStructure,
  layout: readonly ChipLayout[],
  order: number,
  row: number,
): number | null {
  const chip = layout[order];
  const entry = structure.orders[order];
  if (!chip || !entry) return null;
  return chip.left + rowFractionInOrder(entry, row) * chip.width;
}
