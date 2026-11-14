/**
 * Song map (#537 phase 1): the order list as a strip of chips under the seek bar — one per order,
 * width ∝ how long it plays, hue by pattern, `+++` / `---` markers as such. Click a chip to play
 * from that order (EngineCommand `seekOrder`, which also starts a stopped transport).
 *
 * Phase 2 draws the jumps; there is no tempo lane yet. Re-renders on load and on
 * order change only; the row-rate playhead is `SongMapPlayhead` (pitfall 17).
 */
import { memo, useMemo } from 'react';
import { shallowEqual, usePlayerEngine, usePlayerEngineInstance } from '../hooks/usePlayerEngine';
import type { SongOrder, SongStructure } from '../utils/songStructure';
import {
  arcPath,
  formatClock,
  jumpLabel,
  layoutJumps,
  layoutSongMap,
  patternHue,
  playheadPercent,
  selectSongMap,
  selectSongMapPlayhead,
  type ChipLayout,
  type JumpMark,
} from './songMapModel';

/** Height of the arc strip above the chips, in SVG units (= px: the strip is h-3). */
const ARC_STRIP = 12;

/**
 * Jumps over the chips: a curve from where playback leaves to where it lands (position jumps /
 * pattern breaks that skip or go back), amber and dashed when the jump is the song looping. A pattern
 * break to the next order is no arc — it is a tick on the chip it cuts short (`BreakTick`).
 */
const JumpArcs = memo(function JumpArcs({ marks }: { marks: readonly JumpMark[] }) {
  const arcs = marks.filter((m) => m.shape !== 'sequential');
  if (arcs.length === 0) return null;
  return (
    <div className="relative h-3" data-testid="song-map-jumps">
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox={`0 0 100 ${ARC_STRIP}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${arcs.length} jump${arcs.length === 1 ? '' : 's'}`}
      >
        {arcs.map((m, i) => (
          <path
            key={i}
            d={arcPath(m.fromX, m.toX, ARC_STRIP)}
            fill="none"
            vectorEffect="non-scaling-stroke"
            strokeWidth={1.25}
            strokeDasharray={m.jump.loops ? '3 2' : undefined}
            className={m.jump.loops ? 'stroke-amber-400' : 'stroke-cyan-300/80'}
            data-loop={m.jump.loops ? 'true' : undefined}
          >
            <title>{jumpLabel(m.jump)}</title>
          </path>
        ))}
      </svg>
      {arcs.map((m, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`pointer-events-none absolute bottom-0 -translate-x-1/2 text-[8px] leading-none ${m.jump.loops ? 'text-amber-400' : 'text-cyan-300'}`}
          style={{ left: `${m.toX}%` }}
        >
          ▾
        </span>
      ))}
    </div>
  );
});

/** Pattern breaks that cut a pattern short and fall into the next order: a tick where they leave. */
const BreakTicks = memo(function BreakTicks({ marks }: { marks: readonly JumpMark[] }) {
  return (
    <>
      {marks
        .filter((m) => m.shape === 'sequential')
        .map((m, i) => (
          <div
            key={i}
            className="pointer-events-none absolute bottom-0 h-2 w-px bg-white/80"
            style={{ left: `${m.fromX}%` }}
            title={jumpLabel(m.jump)}
            data-testid="song-map-break"
          />
        ))}
    </>
  );
});

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
  const marks = useMemo(() => (structure ? layoutJumps(structure, layout) : []), [structure, layout]);
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
      <JumpArcs marks={marks} />
      <div className="relative h-6 overflow-hidden rounded bg-panel-inset">
        {structure.orders.map((entry, i) => (
          <Chip key={i} entry={entry} chip={layout[i]!} active={i === order} onSelect={onSelect} />
        ))}
        <BreakTicks marks={marks} />
        <SongMapPlayhead structure={structure} layout={layout} />
      </div>
      <div className="mt-0.5 flex justify-between font-mono text-[9px] text-gray-500">
        <span>
          {structure.orders.length} orders
          {structure.jumps.length > 0 ? ` · ${structure.jumps.length} jump${structure.jumps.length === 1 ? '' : 's'}` : ''}
          {structure.approximate ? ' · ≈ timing' : ''}
        </span>
        <span>[ / ] order</span>
      </div>
    </nav>
  );
}
