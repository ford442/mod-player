/**
 * #537 / pitfall 17: the song map re-renders on load and on order change only; its playhead leaf is
 * the only row-rate subscriber. `usePlayerEngine(selector, isEqual)` re-renders a component exactly
 * when its selection changes under `isEqual` (hooks/usePlayerEngine.ts), so counting selection
 * changes of the components' own selectors per store notification is a render counter without a DOM.
 */
import { describe, expect, it } from 'vitest';
import { PlayerEngine, type PlayerSnapshot } from '../../audio/engine/PlayerEngine';
import type { LibOpenMPTSetters } from '../../hooks/libOpenMPT/types';
import { shallowEqual } from '../../hooks/usePlayerEngine';
import {
  layoutSongMap,
  playheadPercent,
  selectSongMap,
  selectSongMapPlayhead,
} from '../../components/songMapModel';
import type { SongOrder, SongStructure } from '../../utils/songStructure';

/** What `usePlayerEngine` does with a selector: count the renders it would cause. */
function renderCounter<T>(engine: PlayerEngine, selector: (s: PlayerSnapshot) => T, isEqual: (a: T, b: T) => boolean) {
  let value = selector(engine.getSnapshot());
  const counter = { renders: 1 };
  engine.subscribe(() => {
    const next = selector(engine.getSnapshot());
    if (!isEqual(value, next)) {
      value = next;
      counter.renders += 1;
    }
  });
  return counter;
}

const ROWS = 16;
function structure(orders: number): SongStructure {
  const list: SongOrder[] = Array.from({ length: orders }, (_, i) => ({
    index: i, pattern: i % 3, rows: ROWS, startSeconds: i * 2, durationSeconds: 2,
    entryRow: 0, exitRow: ROWS - 1, isSkip: false, isEnd: false, reachable: true,
  }));
  return { orders: list, tempoEvents: [], totalSeconds: orders * 2, playOrder: list.map((o) => o.index), approximate: false };
}

describe('SongMap render rate', () => {
  it('map: ≤ 10 Hz (once per order) while the playhead leaf follows every row', async () => {
    const engine = new PlayerEngine({ songStructureSource: null });
    const setters = (engine as unknown as { setters: LibOpenMPTSetters }).setters;
    (engine as unknown as { store: { patch: (p: Partial<PlayerSnapshot>) => void } }).store.patch({
      songStructure: structure(30),
    });
    await Promise.resolve();

    const map = renderCounter(engine, selectSongMap, shallowEqual);
    const leaf = renderCounter(engine, selectSongMapPlayhead, shallowEqual);

    // What createUpdateUI writes on every row change: a fast song, 64 rows/s (16-row orders → 4 Hz
    // order changes), for 3 seconds of playback, one store notification per row.
    const rowsPerSecond = 64;
    const seconds = 3;
    for (let n = 0; n < rowsPerSecond * seconds; n++) {
      const order = Math.floor(n / ROWS);
      const row = n % ROWS;
      setters.setModuleInfo((prev) => ({ ...prev, order, row, bpm: 125 }));
      setters.setSequencerCurrentRow(row);
      setters.setPlaybackSeconds(n / rowsPerSecond);
      setters.setPlaybackRowFraction(row + 0.5);
      await Promise.resolve();
    }

    const orderChanges = Math.floor((rowsPerSecond * seconds - 1) / ROWS);
    expect(map.renders - 1).toBe(orderChanges);
    expect((map.renders - 1) / seconds).toBeLessThanOrEqual(10);
    expect(leaf.renders - 1).toBe(rowsPerSecond * seconds);
  });

  it('playhead: chip left edge at the entry row, its right edge after the exit row', () => {
    const s = structure(4);
    const layout = layoutSongMap(s);
    expect(layout.reduce((n, c) => n + c.width, 0)).toBeCloseTo(100, 9);
    expect(playheadPercent(s, layout, 2, 0)).toBeCloseTo(layout[2]!.left, 9);
    expect(playheadPercent(s, layout, 2, ROWS)).toBeCloseTo(layout[2]!.left + layout[2]!.width, 9);
    expect(playheadPercent(s, layout, 9, 0)).toBeNull();
  });
});
