import type { LibOpenMPT, PatternMatrix, WorkerParseMetadata } from '../types';
import { getPatternMatrix } from './patternExtractor';
import { createModuleFromBytes, readMetadataString } from './wasmHeap';

export interface ParsedModuleData {
  patternMatrices: PatternMatrix[];
  metadata: WorkerParseMetadata;
}

export interface ParseModuleOptions {
  /**
   * Extract at most this many orders (1 = first order only).
   * Metadata still reflects the full module. Use `parseModuleWithLibOpen(…).backfill()`
   * to load remaining orders without blocking playback start.
   */
  maxOrders?: number;
}

export interface BackfillPatternOptions {
  /** First order to fill (default: the first one the parse did not extract). */
  startOrder?: number;
  /** Yield to the main thread every N extracted patterns (keeps UI + audio responsive). */
  yieldEvery?: number;
  signal?: AbortSignal;
}

/** Yield so long synchronous WASM walks do not block play() / resize. */
export async function yieldToMainThread(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sched && typeof sched.yield === 'function') {
    await sched.yield();
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createModulePtr(lib: LibOpenMPT, fileData: Uint8Array): number {
  const modPtr = createModuleFromBytes(lib, fileData);
  if (modPtr === 0) {
    throw new Error('Failed to load module (invalid format?)');
  }
  return modPtr;
}

/** Read a libopenmpt name list (0-based indices). Soft-fails if getters are missing. */
export function readOpenMPTNameList(
  lib: LibOpenMPT,
  modPtr: number,
  count: number,
  getName: ((modPtr: number, index: number) => number) | undefined,
): string[] {
  if (typeof getName !== 'function' || count <= 0) return [];
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const namePtr = getName(modPtr, i);
    names.push(lib.UTF8ToString(namePtr));
    lib._openmpt_free_string(namePtr);
  }
  return names;
}

function readModuleMetadata(
  lib: LibOpenMPT,
  modPtr: number,
  fileName: string,
): WorkerParseMetadata {
  // The key C strings are freed again (they used to leak three mallocs per parse).
  const title = readMetadataString(lib, modPtr, 'title');
  const comments = readMetadataString(lib, modPtr, 'message');
  const format = readMetadataString(lib, modPtr, 'type');

  const numOrders = lib._openmpt_module_get_num_orders(modPtr);
  const numChannels = lib._openmpt_module_get_num_channels(modPtr);
  const initialBpm = lib._openmpt_module_get_current_estimated_bpm(modPtr);
  const durationSeconds = lib._openmpt_module_get_duration_seconds(modPtr);
  const numInstruments = lib._openmpt_module_get_num_instruments(modPtr);
  const instruments = readOpenMPTNameList(
    lib,
    modPtr,
    numInstruments,
    lib._openmpt_module_get_instrument_name,
  );

  const numSamples =
    typeof lib._openmpt_module_get_num_samples === 'function'
      ? lib._openmpt_module_get_num_samples(modPtr)
      : 0;
  const samples = readOpenMPTNameList(
    lib,
    modPtr,
    numSamples,
    lib._openmpt_module_get_sample_name,
  );

  let totalPatternRows = 0;
  for (let i = 0; i < numOrders; i++) {
    const patIdx = lib._openmpt_module_get_order_pattern(modPtr, i);
    totalPatternRows += lib._openmpt_module_get_pattern_num_rows(modPtr, patIdx);
  }

  return {
    title: title || fileName,
    numOrders,
    numChannels,
    initialBpm,
    durationSeconds,
    totalPatternRows,
    numInstruments,
    instruments,
    numSamples,
    samples,
    format,
    comments,
  };
}

/**
 * Extracted patterns by pattern index. An order list plays the same pattern many times; each order
 * gets its own PatternMatrix (its `order` differs) over the SAME `rows`, extracted once. Matrices
 * are immutable once built — edits clone them (utils/patternEdit.ts) — so sharing rows is safe,
 * and a structured clone (the parser worker's reply) keeps the sharing.
 */
type PatternCache = Map<number, PatternMatrix>;

/** The matrix for `order`, extracting its pattern only on first use. `extracted` says whether WASM work ran. */
function matrixForOrder(
  lib: LibOpenMPT,
  modPtr: number,
  order: number,
  cache: PatternCache,
): { matrix: PatternMatrix; extracted: boolean } {
  const patIdx = lib._openmpt_module_get_order_pattern(modPtr, order);
  const hit = cache.get(patIdx);
  if (hit) return { matrix: hit.order === order ? hit : { ...hit, order }, extracted: false };
  const matrix = getPatternMatrix(lib, modPtr, patIdx, order);
  cache.set(patIdx, matrix);
  return { matrix, extracted: true };
}

/** A parse whose module handle is still open, for the pattern backfill. The caller owns the handle. */
export interface OpenModuleParse extends ParsedModuleData {
  /**
   * Fill `target` (sparse, indexed by order) from the orders after the parsed ones, on the SAME
   * module handle the parse created (no second create), yielding to the main thread every
   * `yieldEvery` extracted patterns. Destroys the handle when it ends, finishes or is aborted.
   */
  backfill(target: (PatternMatrix | null)[], options?: BackfillPatternOptions): Promise<void>;
  /** Destroy the module handle without backfilling. Idempotent; a running backfill stops. */
  dispose(): void;
}

/**
 * Parse an in-memory module and keep its handle open for `backfill()` (main thread: order 0 now,
 * the rest after playback starts). The caller must call `backfill()` or `dispose()`.
 */
export function parseModuleWithLibOpen(
  lib: LibOpenMPT,
  fileData: Uint8Array,
  fileName: string,
  options?: ParseModuleOptions,
): OpenModuleParse {
  const modPtr = createModulePtr(lib, fileData);
  let live = true;
  const dispose = () => {
    if (!live) return;
    live = false;
    lib._openmpt_module_destroy(modPtr);
  };
  const cache: PatternCache = new Map();

  let metadata: WorkerParseMetadata;
  const patternMatrices: PatternMatrix[] = [];
  try {
    metadata = readModuleMetadata(lib, modPtr, fileName);
    const ordersToExtract = Math.min(
      metadata.numOrders,
      options?.maxOrders ?? metadata.numOrders,
    );
    for (let i = 0; i < ordersToExtract; i++) {
      patternMatrices.push(matrixForOrder(lib, modPtr, i, cache).matrix);
    }
  } catch (err) {
    dispose();
    throw err;
  }
  const numOrders = metadata.numOrders;

  return {
    patternMatrices,
    metadata,
    dispose,
    async backfill(target, backfillOptions) {
      const startOrder = backfillOptions?.startOrder ?? patternMatrices.length;
      const yieldEvery = backfillOptions?.yieldEvery ?? 2;
      const signal = backfillOptions?.signal;
      let extractedCount = 0;
      try {
        for (let i = startOrder; i < numOrders; i++) {
          if (!live || signal?.aborted) return;
          if (target[i]) continue;
          const { matrix, extracted } = matrixForOrder(lib, modPtr, i, cache);
          target[i] = matrix;
          if (extracted && yieldEvery > 0 && ++extractedCount % yieldEvery === 0) {
            await yieldToMainThread();
          }
        }
      } finally {
        dispose();
      }
    },
  };
}

/**
 * Parse tracker pattern data from an in-memory module using an initialized libopenmpt instance.
 * Creates a temporary module handle and destroys it before returning.
 */
export function parseModuleWithLib(
  lib: LibOpenMPT,
  fileData: Uint8Array,
  fileName: string,
  options?: ParseModuleOptions,
): ParsedModuleData {
  const open = parseModuleWithLibOpen(lib, fileData, fileName, options);
  open.dispose();
  return { patternMatrices: open.patternMatrices, metadata: open.metadata };
}
