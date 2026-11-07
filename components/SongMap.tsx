/**
 * Song map (#537 phase 1): the order list as a strip of chips under the seek bar — one per order,
 * width ∝ how long it plays, hue by pattern, `+++` / `---` markers as such. Click a chip to play
 * from that order (EngineCommand `seekOrder`, which also starts a stopped transport).
 *
 * Read-only half of #537: no loop region, jump arcs or tempo lane yet. Re-renders on load and on
 * order change only; the row-rate playhead is `SongMapPlayhead` (pitfall 17).
 */
import { memo, useMemo } from 'react';
import { shallowEqual, usePlayerEngine, usePlayerEngineInstance } from '../hooks/usePlayerEngine';
import type { SongOrder, SongStructure } from '../utils/songStructure';
import {
  formatClock,
  layoutSongMap,
  patternHue,
  playheadPercent,
  selectSongMap,
  selectSongMapPlayhead,
  type ChipLayout,
} from './songMapModel';

function chipLabel(o: SongOrder): string {
  if (o.isSkip) return '+++';
  if (o.isEnd) return '---';
  return String(o.pattern);
}

function chipTitle(o: SongOrder): string {
  if (o.isSkip) return `Order ${o.index}: skip (+++)`;
  if (o.isEnd) return `Order ${o.index}: end of song (---)`;
  const base = `Order ${o.index} · pattern ${o.pattern} · ${o.rows} rows`;
  if (!o.reachable) return `${base} · not reached by playback`;
  return `${base} · ${formatClock(o.startSeconds)}–${formatClock(o.startSeconds + o.durationSeconds)}`;
}

/** The only row-rate subscriber of the map. */
const SongMapPlayhead = memo(function SongMapPlayhead({
  structure,
  layout,
}: {
  structure: SongStructure;
  layout: readonly ChipLayout[];
}) {
  const { order, row } = usePlayerEngine(selectSongMapPlayhead, shallowEqual);
  const left = playheadPercent(structure, layout, order, row);
  if (left === null) return null;
  return (
    <div
      className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]"
      style={{ left: `${left}%` }}
      aria-hidden="true"
    />
  );
});

const Chip = memo(function Chip({
  entry,
  chip,
  active,
  onSelect,
}: {
  entry: SongOrder;
  chip: ChipLayout;
  active: boolean;
  onSelect: (order: number) => void;
}) {
  const marker = entry.isSkip || entry.isEnd;
  const hue = patternHue(entry.pattern);
  const style = {
    left: `${chip.left}%`,
    width: `${chip.width}%`,
    ...(marker ? {} : { backgroundColor: `hsl(${hue} 55% ${active ? 52 : 34}%)` }),
  };
  return (
    <button
      type="button"
      title={chipTitle(entry)}
      aria-label={chipTitle(entry)}
      aria-current={active ? 'step' : undefined}
      onClick={() => onSelect(entry.index)}
      className={[
        'absolute inset-y-0 overflow-hidden border-r border-black/40 text-[9px] font-mono leading-none text-white/80',
        'hover:brightness-125 focus-visible:z-10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-cyan-300',
        marker ? 'bg-gray-700/60 text-gray-400' : '',
        !entry.reachable && !marker ? 'opacity-40' : '',
        active ? 'ring-1 ring-inset ring-white/70' : '',
      ].join(' ')}
      style={style}
    >
      <span className="pointer-events-none block truncate px-px">{chipLabel(entry)}</span>
    </button>
  );
});

export function SongMap() {
  const engine = usePlayerEngineInstance();
  const { structure, order } = usePlayerEngine(selectSongMap, shallowEqual);
  const layout = useMemo(() => (structure ? layoutSongMap(structure) : []), [structure]);
  const onSelect = useMemo(
    () => (target: number) => engine.dispatch({ type: 'seekOrder', order: target }),
    [engine],
  );

  if (!structure) {
    return (
      <div className="h-6 animate-pulse rounded bg-panel-inset" role="status" aria-label="Mapping song" />
    );
  }

  return (
    <nav aria-label="Song map — order list" className="select-none">
      <div className="relative h-6 overflow-hidden rounded bg-panel-inset">
        {structure.orders.map((entry, i) => (
          <Chip key={i} entry={entry} chip={layout[i]!} active={i === order} onSelect={onSelect} />
        ))}
        <SongMapPlayhead structure={structure} layout={layout} />
      </div>
      <div className="mt-0.5 flex justify-between font-mono text-[9px] text-gray-500">
        <span>
          {structure.orders.length} orders{structure.approximate ? ' · ≈ timing' : ''}
        </span>
        <span>[ / ] order</span>
      </div>
    </nav>
  );
}
