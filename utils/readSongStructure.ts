/**
 * Fill a SongStructure (utils/songStructure.ts) from a libopenmpt module (#537 phase 1).
 *
 * Two passes over a *scratch* module — never the one that is playing, and never on the audio thread
 * (the #513 rule: create / seek stay off the worklet):
 *
 *   1. Order flow. Follow the order list from order 0 row 0 the way playback does, reading each row's
 *      effect commands: pattern break (`CMD_PATTERNBREAK`) and position jump (`CMD_POSITIONJUMP`)
 *      move to another order, skip (`+++`) orders are passed over, an end (`---`) order or a revisit
 *      (the song looping back) ends it. Speed / tempo (`CMD_SPEED` / `CMD_TEMPO`) and row delays are
 *      tracked on the way, which gives the tempo events and a tick-count clock used only to place
 *      rows *within* an order.
 *   2. Exact starts. For every order the flow visits, `set_position_order_row` + `get_position_seconds`
 *      — libopenmpt's own clock. Each call simulates the song from the start, so the walk is quadratic
 *      in song length (~4 ms for a 30-order XM, seconds for a 250-order 64-channel IT); past
 *      `budgetMs` the remaining starts are extrapolated from the tick clock and the result is flagged
 *      `approximate`.
 *
 * The walk also reports the jumps / breaks it followed (`SongStructure.jumps`, phase 2). Phase 1
 * reads the selected subsong only (subsong 0 until #526).
 */
import type { LibOpenMPT } from '../types';
import { EffectCommand, PatternCommand } from './openmptCommands';
import {
  ORDER_PATTERN_END,
  ORDER_PATTERN_SKIP,
  type SongJump,
  type SongOrder,
  type SongStructure,
  type SongTempoEvent,
} from './songStructure';

export interface ReadSongStructureOptions {
  /** Wall-clock budget for the exact (quadratic) pass, ms. Default 8000. */
  budgetMs?: number;
  /** Clock for the budget (tests). */
  now?: () => number;
}

/** Parameter high nibble of `CMD_MODCMDEX` (MOD/XM `EEx`) / `CMD_S3MCMDEX` (S3M/IT `SEx`): row delay. */
const ROW_DELAY_SUBCOMMAND = 0xe0;
/** `CMD_S3MCMDEX` `S6x`: fine pattern delay (x extra ticks). */
const FINE_DELAY_SUBCOMMAND = 0x60;
/** `CMD_TEMPO` below this is a tempo slide (S3M/IT `T0x` / `T1x`), not a tempo. */
const MIN_TEMPO = 0x20;

interface Visit {
  order: number;
  entryRow: number;
  exitRow: number;
  /** Tick-clock seconds at this visit's entry. */
  simStart: number;
  simDuration: number;
  events: Array<{ row: number; simOffset: number; bpm: number; speed: number }>;
  /** How the order was left, when a Bxx / Dxx did it (the target after skipping `+++` orders). */
  exit: { kind: 'jump' | 'break'; toOrder: number; toRow: number } | null;
  /** The walk stopped here because the order playback moved on to was already played. */
  loopTarget: number | null;
}

function readFlow(lib: LibOpenMPT, modPtr: number, numOrders: number): Visit[] {
  const numChannels = lib._openmpt_module_get_num_channels(modPtr);
  const numPatterns = lib._openmpt_module_get_num_patterns?.(modPtr) ?? Number.POSITIVE_INFINITY;
  const command = lib._openmpt_module_get_pattern_row_channel_command;

  lib._openmpt_module_set_position_order_row(modPtr, 0, 0);
  let speed = lib._openmpt_module_get_current_speed(modPtr) || 6;
  let tempo = lib._openmpt_module_get_current_tempo2?.(modPtr) || 125;

  const visits: Visit[] = [];
  const visited = new Set<number>();
  let order = 0;
  let row = 0;
  let sim = 0;
  let first = true;

  while (order < numOrders) {
    const pattern = lib._openmpt_module_get_order_pattern(modPtr, order);
    if (pattern === ORDER_PATTERN_SKIP) {
      order += 1;
      row = 0;
      continue;
    }
    if (pattern === ORDER_PATTERN_END || pattern >= numPatterns) break;
    if (visited.has(order)) {
      const last = visits[visits.length - 1];
      if (last) last.loopTarget = order;
      break;
    }
    visited.add(order);

    const rows = lib._openmpt_module_get_pattern_num_rows(modPtr, pattern);
    if (row >= rows) row = 0;
    const visit: Visit = { order, entryRow: row, exitRow: Math.max(row, rows - 1), simStart: sim, simDuration: 0, events: [], exit: null, loopTarget: null };
    if (first) {
      visit.events.push({ row, simOffset: 0, bpm: tempo, speed });
      first = false;
    }

    let nextOrder = order + 1;
    let nextRow = 0;
    let r = row;
    let exit: Visit['exit'] = null;
    for (; r < rows; r++) {
      let jumpTo = -1;
      let breakTo = -1;
      let delayRows = 0;
      let extraTicks = 0;
      let changed = false;
      for (let c = 0; c < numChannels; c++) {
        const effect = command(modPtr, pattern, r, c, PatternCommand.EFFECT);
        if (effect === EffectCommand.CMD_NONE) continue;
        const param = command(modPtr, pattern, r, c, PatternCommand.PARAMETER);
        switch (effect) {
          case EffectCommand.CMD_SPEED:
            if (param > 0 && param !== speed) { speed = param; changed = true; }
            break;
          case EffectCommand.CMD_TEMPO:
            if (param >= MIN_TEMPO && param !== tempo) { tempo = param; changed = true; }
            break;
          case EffectCommand.CMD_POSITIONJUMP:
            jumpTo = param;
            break;
          case EffectCommand.CMD_PATTERNBREAK:
            breakTo = param;
            break;
          case EffectCommand.CMD_MODCMDEX:
          case EffectCommand.CMD_S3MCMDEX:
            if ((param & 0xf0) === ROW_DELAY_SUBCOMMAND) delayRows = Math.max(delayRows, param & 0x0f);
            else if (effect === EffectCommand.CMD_S3MCMDEX && (param & 0xf0) === FINE_DELAY_SUBCOMMAND) {
              extraTicks += param & 0x0f;
            }
            break;
          default:
            break;
        }
      }
      if (changed) visit.events.push({ row: r, simOffset: sim - visit.simStart, bpm: tempo, speed });
      // Classic tempo mode: a tick lasts 2.5 / tempo seconds.
      sim += (speed * (1 + delayRows) + extraTicks) * (2.5 / tempo);
      if (jumpTo >= 0 || breakTo >= 0) {
        if (jumpTo >= 0) nextOrder = jumpTo;
        nextRow = Math.max(0, breakTo);
        exit = { kind: jumpTo >= 0 ? 'jump' : 'break', toOrder: nextOrder, toRow: nextRow };
        break;
      }
    }
    visit.exitRow = Math.min(r, rows - 1);
    visit.simDuration = sim - visit.simStart;
    if (exit) {
      // The walk passes `+++` orders (and drops the row); the arc should end where playback lands.
      let landed = exit.toOrder;
      while (landed < numOrders && lib._openmpt_module_get_order_pattern(modPtr, landed) === ORDER_PATTERN_SKIP) landed += 1;
      // A target past the order list (or an end marker) is the song ending, not a place on the map.
      const targetPattern = landed < numOrders ? lib._openmpt_module_get_order_pattern(modPtr, landed) : ORDER_PATTERN_END;
      if (targetPattern !== ORDER_PATTERN_END) {
        visit.exit = { kind: exit.kind, toOrder: landed, toRow: landed === exit.toOrder ? exit.toRow : 0 };
      }
    }
    visits.push(visit);
    order = nextOrder;
    row = nextRow;
  }
  return visits;
}

export function readSongStructure(
  lib: LibOpenMPT,
  modPtr: number,
  options: ReadSongStructureOptions = {},
): SongStructure {
  const budgetMs = options.budgetMs ?? 8000;
  const now = options.now ?? (() => performance.now());
  const numOrders = lib._openmpt_module_get_num_orders(modPtr);
  const totalSeconds = lib._openmpt_module_get_duration_seconds(modPtr);

  const visits = readFlow(lib, modPtr, numOrders);

  // Exact starts, in play order, until the budget runs out.
  const starts: number[] = [];
  let approximate = false;
  const began = now();
  let lastExact = -1;
  for (let i = 0; i < visits.length; i++) {
    const v = visits[i]!;
    if (now() - began <= budgetMs) {
      lib._openmpt_module_set_position_order_row(modPtr, v.order, v.entryRow);
      const exact = lib._openmpt_module_get_position_seconds(modPtr);
      starts.push(Math.max(exact, starts[i - 1] ?? 0));
      lastExact = i;
      continue;
    }
    approximate = true;
    // Scale the tick clock to libopenmpt's clock over the exact part.
    const anchor = visits[lastExact]!;
    const ratio = anchor.simStart > 0 ? starts[lastExact]! / anchor.simStart : 1;
    starts.push(starts[lastExact]! + (v.simStart - anchor.simStart) * ratio);
  }
  lib._openmpt_module_set_position_order_row(modPtr, 0, 0);

  const byOrder = new Map<number, { start: number; duration: number; visit: Visit }>();
  const tempoEvents: SongTempoEvent[] = [];
  visits.forEach((v, i) => {
    const start = starts[i]!;
    const end = i + 1 < visits.length ? starts[i + 1]! : Math.max(totalSeconds, start);
    const duration = Math.max(0, end - start);
    byOrder.set(v.order, { start, duration, visit: v });
    const scale = v.simDuration > 0 ? duration / v.simDuration : 0;
    for (const e of v.events) {
      tempoEvents.push({ seconds: start + e.simOffset * scale, order: v.order, row: e.row, bpm: e.bpm, speed: e.speed });
    }
  });

  const orders: SongOrder[] = [];
  let layoutEnd = 0;
  for (let index = 0; index < numOrders; index++) {
    const pattern = lib._openmpt_module_get_order_pattern(modPtr, index);
    const isSkip = pattern === ORDER_PATTERN_SKIP;
    const isEnd = pattern === ORDER_PATTERN_END;
    const rows = isSkip || isEnd ? 0 : lib._openmpt_module_get_pattern_num_rows(modPtr, pattern);
    const hit = byOrder.get(index);
    if (hit) {
      orders.push({
        index, pattern, rows, isSkip, isEnd, reachable: true,
        startSeconds: hit.start,
        durationSeconds: hit.duration,
        entryRow: hit.visit.entryRow,
        exitRow: hit.visit.exitRow,
      });
      layoutEnd = Math.max(layoutEnd, hit.start + hit.duration);
    } else {
      orders.push({
        index, pattern, rows, isSkip, isEnd, reachable: false,
        startSeconds: layoutEnd,
        durationSeconds: 0,
        entryRow: 0,
        exitRow: Math.max(0, rows - 1),
      });
    }
  }

  const jumps: SongJump[] = [];
  for (const v of visits) {
    const loops = v.loopTarget !== null;
    if (v.exit) {
      jumps.push({ kind: v.exit.kind, fromOrder: v.order, fromRow: v.exitRow, toOrder: v.exit.toOrder, toRow: v.exit.toRow, loops });
    } else if (v.loopTarget !== null) {
      jumps.push({ kind: 'flow', fromOrder: v.order, fromRow: v.exitRow, toOrder: v.loopTarget, toRow: 0, loops: true });
    }
  }

  return {
    orders,
    jumps,
    tempoEvents,
    totalSeconds,
    playOrder: visits.map((v) => v.order),
    approximate,
  };
}

/** Create a scratch module from `fileData`, read its structure, destroy it. */
export function readSongStructureFromBytes(
  lib: LibOpenMPT,
  fileData: Uint8Array,
  options: ReadSongStructureOptions = {},
): SongStructure {
  const ptr = lib._malloc(fileData.byteLength);
  lib.HEAPU8.set(fileData, ptr);
  const modPtr = lib._openmpt_module_create_from_memory2(ptr, fileData.byteLength, 0, 0, 0, 0, 0, 0, 0);
  lib._free(ptr);
  if (modPtr === 0) throw new Error('Failed to load module (invalid format?)');
  try {
    return readSongStructure(lib, modPtr, options);
  } finally {
    lib._openmpt_module_destroy(modPtr);
  }
}
