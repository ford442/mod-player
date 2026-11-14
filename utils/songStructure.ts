/**
 * The song-structure model of the song map (#537, phase 1): one entry per order of the order list,
 * with where that order starts on the song's clock and how long it plays, plus the tempo / speed
 * events. Pure — no libopenmpt, no DOM. `utils/readSongStructure.ts` fills it from a module (in the
 * parser worker); `components/SongMap.tsx` draws it; #518 (frame-accurate seek) reuses the seconds.
 *
 * Phase 2 adds `jumps` (the position jumps / pattern breaks the walk followed) and the loop-region
 * model (utils/songStructureLoop.ts).
 */

/** `openmpt_module_get_order_pattern` for a skip (`+++`) order (libopenmpt PATTERNINDEX_SKIP). */
export const ORDER_PATTERN_SKIP = 0xfffe;
/** `openmpt_module_get_order_pattern` for an end-of-song (`---`) order (PATTERNINDEX_INVALID). */
export const ORDER_PATTERN_END = 0xffff;

export interface SongOrder {
  /** Position in the order list. */
  readonly index: number;
  /** Pattern this order plays; ORDER_PATTERN_SKIP / ORDER_PATTERN_END for the markers. */
  readonly pattern: number;
  /** Rows of that pattern (0 for a marker). */
  readonly rows: number;
  /**
   * When playback first reaches this order, on the song's clock — exactly what libopenmpt's
   * `set_position_order_row` + `get_position_seconds` report. For an order playback never reaches
   * (`reachable: false`, markers included), the end of the closest reached order before it, so a
   * list laid out in index order stays monotonic.
   */
  readonly startSeconds: number;
  /** How long this order plays on its first pass; 0 when it is never reached. */
  readonly durationSeconds: number;
  /** First row played (a pattern break from the previous order can enter it mid-pattern). */
  readonly entryRow: number;
  /** Last row played on the first pass (a break / jump can leave it early). */
  readonly exitRow: number;
  readonly isSkip: boolean;
  readonly isEnd: boolean;
  /** Playback of the (first) subsong passes through this order. */
  readonly reachable: boolean;
}

export interface SongTempoEvent {
  readonly seconds: number;
  readonly order: number;
  readonly row: number;
  /** Tracker tempo ("BPM" column of the format) after this row's commands. */
  readonly bpm: number;
  /** Ticks per row after this row's commands. */
  readonly speed: number;
}

/**
 * How playback left an order: `jump` = a position jump (`Bxx`, with or without a `Dxx` on the same
 * row), `break` = a pattern break (`Dxx`) alone, `flow` = it ran on into an order it had already
 * played (no command involved).
 */
export type SongJumpKind = 'jump' | 'break' | 'flow';

/** One way out of an order that the order-flow walk followed (first pass only, like the rest). */
export interface SongJump {
  readonly kind: SongJumpKind;
  readonly fromOrder: number;
  /** The row the jump / break sits on (the last row the order plays). */
  readonly fromRow: number;
  readonly toOrder: number;
  readonly toRow: number;
  /**
   * The target is an order playback already played: the song loops here (the walk stops). Only a
   * jump the walk followed is reported — the implicit end-of-song restart is not (libopenmpt's C API
   * does not expose the restart position).
   */
  readonly loops: boolean;
}

export interface SongStructure {
  readonly orders: readonly SongOrder[];
  /** The jumps / breaks the walk followed, in play order (at most one per visited order). */
  readonly jumps: readonly SongJump[];
  /** In play order. The first event is the song's initial tempo / speed at order 0's entry. */
  readonly tempoEvents: readonly SongTempoEvent[];
  /** libopenmpt's `get_duration_seconds` (the selected subsong). */
  readonly totalSeconds: number;
  /** Indices of the reached orders, in the order playback visits them (= ascending startSeconds). */
  readonly playOrder: readonly number[];
  /**
   * Some order starts were estimated instead of read from libopenmpt (the exact walk is quadratic
   * in song length and stops at a time budget — see readSongStructure).
   */
  readonly approximate: boolean;
}

export const EMPTY_SONG_STRUCTURE: SongStructure = {
  orders: [],
  jumps: [],
  tempoEvents: [],
  totalSeconds: 0,
  playOrder: [],
  approximate: false,
};

/**
 * The reached order playing at `seconds` (its first pass), or -1 when there is none (no reached
 * order, or a negative time). Past the end, the last order played.
 */
export function orderAtSeconds(structure: SongStructure, seconds: number): number {
  const { playOrder, orders } = structure;
  if (playOrder.length === 0 || !(seconds >= 0)) return -1;
  // Binary search over the play order (its startSeconds ascend).
  let lo = 0;
  let hi = playOrder.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const start = orders[playOrder[mid]!]!.startSeconds;
    if (start <= seconds) lo = mid;
    else hi = mid - 1;
  }
  return playOrder[lo]!;
}

/**
 * Seconds at `row` of `order` on its first pass: the order's start plus the row's share of the
 * rows it plays (linear within the order). Rows before the entry row clamp to the start, rows past
 * the exit row to the end. An order that is never reached returns its (layout) start.
 */
export function secondsAtOrderRow(structure: SongStructure, order: number, row: number): number {
  const entry = structure.orders[order];
  if (!entry) return 0;
  if (!entry.reachable || entry.durationSeconds <= 0) return entry.startSeconds;
  const played = entry.exitRow - entry.entryRow + 1;
  const fraction = Math.min(1, Math.max(0, (row - entry.entryRow) / played));
  return entry.startSeconds + fraction * entry.durationSeconds;
}

/**
 * Fraction 0…1 along an order's chip for a (fractional) row: rows played on the first pass map to
 * the full width. The song map's playhead uses it.
 */
export function rowFractionInOrder(entry: SongOrder, row: number): number {
  if (entry.rows <= 0) return 0;
  const played = Math.max(1, entry.exitRow - entry.entryRow + 1);
  return Math.min(1, Math.max(0, (row - entry.entryRow) / played));
}

/** Tempo / speed in effect at `seconds` (the last event at or before it), or null without events. */
export function tempoAtSeconds(structure: SongStructure, seconds: number): SongTempoEvent | null {
  let current: SongTempoEvent | null = null;
  for (const event of structure.tempoEvents) {
    if (event.seconds > seconds) break;
    current = event;
  }
  return current ?? structure.tempoEvents[0] ?? null;
}

/**
 * The shape of a jump on the map: `sequential` ends up at the next order that plays anyway (a
 * pattern break cutting a pattern short — a tick on the chip, not an arc), `forward` skips orders,
 * `back` goes to an earlier order, `self` stays in the same order.
 */
export type SongJumpShape = 'sequential' | 'forward' | 'back' | 'self';

export function jumpShape(structure: SongStructure, jump: SongJump): SongJumpShape {
  if (jump.toOrder === jump.fromOrder) return 'self';
  if (jump.toOrder < jump.fromOrder) return 'back';
  for (let o = jump.fromOrder + 1; o < jump.toOrder; o++) {
    if (!structure.orders[o]?.isSkip) return 'forward';
  }
  return 'sequential';
}

/**
 * The orders playback can go to when it leaves `order` on its own: the next reached order in play
 * order, the target of a jump out of it, and — for the last order played — the first (the song
 * looping). The loop region uses it to tell playback running out of its end from a seek.
 */
export function successorsOf(structure: SongStructure, order: number): ReadonlySet<number> {
  const out = new Set<number>();
  const { playOrder } = structure;
  const at = playOrder.indexOf(order);
  if (at >= 0) {
    out.add(playOrder[at + 1] ?? playOrder[0]!);
  } else if (structure.orders[order]) {
    // Not on the first pass (a revisited / unreached order): any later order is a natural next.
    out.add(order + 1);
  }
  for (const j of structure.jumps) if (j.fromOrder === order) out.add(j.toOrder);
  return out;
}
