/**
 * Song map (#537 phase 1): the order list as a strip of chips under the seek bar — one per order,
 * width ∝ how long it plays, hue by pattern, `+++` / `---` markers as such. Click a chip to play
 * from that order (EngineCommand `seekOrder`, which also starts a stopped transport).
 *
 * Phase 2 draws the jumps and sets the loop region: Shift+click a chip (first click = that order,
 * later ones grow / shrink the span) or drag across chips to mark A…B; playback that runs out of B
 * seeks back to A (PlayerEngine.stepLoopRegion). There is no tempo lane yet. Re-renders on load, on
 * order change and on a region change only; the row-rate playhead is `SongMapPlayhead` (pitfall 17).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shallowEqual, usePlayerEngine, usePlayerEngineInstance } from '../hooks/usePlayerEngine';
import type { SongOrder, SongStructure } from '../utils/songStructure';
import { extendLoopRegion, loopRegionSeconds, makeLoopRegion, type LoopRegion } from '../utils/songStructureLoop';
import {
  arcPath,
  formatClock,
  jumpLabel,
  layoutJumps,
  layoutSongMap,
  loopBand,
  orderAtPercent,
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
  onSelect: (order: number, shiftKey: boolean) => void;
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
      onClick={(e) => onSelect(entry.index, e.shiftKey)}
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

/** The loop region's band over the chips (`preview`: the span a drag would set). */
const LoopBand = memo(function LoopBand({
  layout,
  region,
  preview,
}: {
  layout: readonly ChipLayout[];
  region: LoopRegion | null;
  preview?: boolean;
}) {
  const band = loopBand(layout, region);
  if (!band) return null;
  return (
    <div
      className={[
        'pointer-events-none absolute inset-y-0 border-y-2 border-amber-300',
        preview ? 'border-dashed bg-amber-300/10' : 'bg-amber-300/15',
      ].join(' ')}
      style={{ left: `${band.left}%`, width: `${band.width}%` }}
      data-testid={preview ? 'song-map-loop-preview' : 'song-map-loop'}
      aria-hidden="true"
    >
      {!preview && (
        <>
          <span className="absolute left-0 top-0 bg-amber-300 px-0.5 text-[8px] font-bold leading-[10px] text-black">A</span>
          <span className="absolute bottom-0 right-0 bg-amber-300 px-0.5 text-[8px] font-bold leading-[10px] text-black">B</span>
        </>
      )}
    </div>
  );
});

interface DragState {
  from: number;
  to: number;
  /** The pointer reached another chip: this is a drag, not a click. */
  moved: boolean;
}

export function SongMap() {
  const engine = usePlayerEngineInstance();
  const { structure, order, loopRegion } = usePlayerEngine(selectSongMap, shallowEqual);
  const layout = useMemo(() => (structure ? layoutSongMap(structure) : []), [structure]);
  const marks = useMemo(() => (structure ? layoutJumps(structure, layout) : []), [structure, layout]);
  const stripRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  /** A drag ended on the chip it started on: the click that follows is not a seek. */
  const swallowClickRef = useRef(false);
  const stopDragRef = useRef<(() => void) | null>(null);
  const [preview, setPreview] = useState<LoopRegion | null>(null);

  useEffect(() => () => stopDragRef.current?.(), []);

  const setRegion = useCallback(
    (region: LoopRegion | null) => {
      engine.dispatch(
        region ? { type: 'setLoopRegion', start: region.start, end: region.end } : { type: 'clearLoopRegion' },
      );
    },
    [engine],
  );

  const onSelect = useCallback(
    (target: number, shiftKey: boolean) => {
      if (swallowClickRef.current) {
        swallowClickRef.current = false;
        return;
      }
      if (shiftKey && structure) setRegion(extendLoopRegion(structure, loopRegion, target));
      else engine.dispatch({ type: 'seekOrder', order: target });
    },
    [engine, structure, loopRegion, setRegion],
  );

  const orderAtPointer = useCallback(
    (clientX: number): number | null => {
      const rect = stripRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return null;
      return orderAtPercent(layout, ((clientX - rect.left) / rect.width) * 100);
    },
    [layout],
  );

  /** Drag across chips to set the loop span; a press that never leaves its chip stays a click. */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !structure) return;
    const from = orderAtPointer(e.clientX);
    if (from === null) return;
    swallowClickRef.current = false;
    dragRef.current = { from, to: from, moved: false };
    const move = (ev: PointerEvent) => {
      const drag = dragRef.current;
      const to = orderAtPointer(ev.clientX);
      if (!drag || to === null || to === drag.to) return;
      drag.to = to;
      if (to !== drag.from) drag.moved = true;
      setPreview(drag.moved ? makeLoopRegion(structure, drag.from, drag.to) : null);
    };
    const up = () => {
      const drag = dragRef.current;
      stopDragRef.current?.();
      if (!drag?.moved) return;
      swallowClickRef.current = true;
      setRegion(makeLoopRegion(structure, drag.from, drag.to));
    };
    stopDragRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dragRef.current = null;
      stopDragRef.current = null;
      setPreview(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  if (!structure) {
    return (
      <div className="h-6 animate-pulse rounded bg-panel-inset" role="status" aria-label="Mapping song" />
    );
  }

  const span = loopRegion ? loopRegionSeconds(structure, loopRegion) : null;

  return (
    <nav aria-label="Song map — order list" className="select-none">
      <JumpArcs marks={marks} />
      <div
        ref={stripRef}
        className="relative h-6 touch-none overflow-hidden rounded bg-panel-inset"
        onPointerDown={onPointerDown}
      >
        {structure.orders.map((entry, i) => (
          <Chip key={i} entry={entry} chip={layout[i]!} active={i === order} onSelect={onSelect} />
        ))}
        <LoopBand layout={layout} region={loopRegion} />
        <LoopBand layout={layout} region={preview} preview />
        <BreakTicks marks={marks} />
        <SongMapPlayhead structure={structure} layout={layout} />
      </div>
      <div className="mt-0.5 flex justify-between gap-2 font-mono text-[9px] text-gray-500">
        <span>
          {structure.orders.length} orders
          {structure.jumps.length > 0 ? ` · ${structure.jumps.length} jump${structure.jumps.length === 1 ? '' : 's'}` : ''}
          {structure.approximate ? ' · ≈ timing' : ''}
          {loopRegion && span && (
            <span className="ml-2 text-amber-300" data-testid="song-map-loop-label">
              ⟲ loop {loopRegion.start === loopRegion.end ? `order ${loopRegion.start}` : `orders ${loopRegion.start}–${loopRegion.end}`}
              {' '}({formatClock(span.start)}–{formatClock(span.end)})
              <button
                type="button"
                className="ml-1 rounded px-1 text-gray-400 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-cyan-300"
                aria-label="Clear loop region"
                title="Clear loop region (\)"
                onClick={() => setRegion(null)}
              >
                ✕
              </button>
            </span>
          )}
        </span>
        <span className="shrink-0">[ / ] order · ⇧ click / drag: loop</span>
      </div>
    </nav>
  );
}
