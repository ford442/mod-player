import type { LibOpenMPT, PatternMatrix, WorkerParseMetadata } from '../types';
import type { InstrumentTable } from '../types/instruments';
import { instrumentTableFromNames, readInstrumentTable } from './instrumentTable';
import { hasModuleInspect, ModuleInspector } from './moduleInspect';
import { getPatternMatrix, patternMatrixFromDump } from './patternExtractor';
import { createModuleFromBytes, readMetadataString } from './wasmHeap';

export interface ParsedModuleData {
  patternMatrices: PatternMatrix[];
  metadata: WorkerParseMetadata;
  /** Samples (header + waveform peaks), instruments (keymap, envelopes) — every format libopenmpt opens. */
  instrumentTable: InstrumentTable;
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

const LOAD_FAILED = 'Failed to load module (invalid format?)';

function createModulePtr(lib: LibOpenMPT, fileData: Uint8Array, ctls?: Record<string, string>): number {
  const modPtr = createModuleFromBytes(lib, fileData, ctls);
  if (modPtr === 0) {
    throw new Error(LOAD_FAILED);
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
  orderPatterns: number[] = [],
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
    orderPatterns.push(patIdx);
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

/** Where a parse reads patterns from, and the handle it owns. */
interface PatternSource {
  orderPattern(order: number): number;
  extract(patternIndex: number, order: number): PatternMatrix;
  destroy(): void;
}

/** The matrix for `order`, extracting its pattern only on first use. `extracted` says whether WASM work ran. */
function matrixForOrder(
  source: PatternSource,
  order: number,
  cache: PatternCache,
): { matrix: PatternMatrix; extracted: boolean } {
  const patIdx = source.orderPattern(order);
  const hit = cache.get(patIdx);
  if (hit) return { matrix: hit.order === order ? hit : { ...hit, order }, extracted: false };
  const matrix = source.extract(patIdx, order);
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
 * The parse on a glue with the inspection shim (the committed shared pair): ONE inspection handle
 * serves the patterns (one `xasm_pattern_dump` per pattern instead of six calls per cell), the
 * instrument table and the backfill. The C API metadata (names, duration, order list) is read from
 * a short-lived module created with `load.skip_samples` — sample data is the bulk of a load and the
 * metadata does not need it — and destroyed before this returns.
 */
function openInspectSource(
  lib: LibOpenMPT,
  fileData: Uint8Array,
  fileName: string,
): { source: PatternSource; metadata: WorkerParseMetadata; instrumentTable: InstrumentTable } {
  if (!hasModuleInspect(lib)) throw new Error('openInspectSource: no inspection shim');
  const inspector = ModuleInspector.open(lib, fileData);
  if (!inspector) throw new Error(LOAD_FAILED);
  try {
    const orderPatterns: number[] = [];
    const modPtr = createModulePtr(lib, fileData, { 'load.skip_samples': '1' });
    let metadata: WorkerParseMetadata;
    try {
      metadata = readModuleMetadata(lib, modPtr, fileName, orderPatterns);
    } finally {
      lib._openmpt_module_destroy(modPtr);
    }
    const instrumentTable = readInstrumentTable(inspector, {
      format: metadata.format,
      instrumentNames: metadata.instruments,
      sampleNames: metadata.samples,
    });
    const channels = metadata.numChannels;
    return {
      metadata,
      instrumentTable,
      source: {
        orderPattern: (order) => orderPatterns[order] ?? 0xffff,
        extract: (patIdx, order) => patternMatrixFromDump(inspector.dumpPattern(patIdx, channels), order),
        destroy: () => inspector.destroy(),
      },
    };
  } catch (err) {
    inspector.destroy();
    throw err;
  }
}

/** The C-API-only parse (a glue without the shim): metadata, names-only instruments, 6-call cells. */
function openCApiSource(
  lib: LibOpenMPT,
  fileData: Uint8Array,
  fileName: string,
): { source: PatternSource; metadata: WorkerParseMetadata; instrumentTable: InstrumentTable } {
  const modPtr = createModulePtr(lib, fileData);
  try {
    const metadata = readModuleMetadata(lib, modPtr, fileName);
    return {
      metadata,
      instrumentTable: instrumentTableFromNames({
        format: metadata.format,
        instrumentNames: metadata.instruments,
        sampleNames: metadata.samples,
      }),
      source: {
        orderPattern: (order) => lib._openmpt_module_get_order_pattern(modPtr, order),
        extract: (patIdx, order) => getPatternMatrix(lib, modPtr, patIdx, order),
        destroy: () => lib._openmpt_module_destroy(modPtr),
      },
    };
  } catch (err) {
    lib._openmpt_module_destroy(modPtr);
    throw err;
  }
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
  const { source, metadata, instrumentTable } = hasModuleInspect(lib)
    ? openInspectSource(lib, fileData, fileName)
    : openCApiSource(lib, fileData, fileName);
  let live = true;
  const dispose = () => {
    if (!live) return;
    live = false;
    source.destroy();
  };
  const cache: PatternCache = new Map();

  const patternMatrices: PatternMatrix[] = [];
  try {
    const ordersToExtract = Math.min(
      metadata.numOrders,
      options?.maxOrders ?? metadata.numOrders,
    );
    for (let i = 0; i < ordersToExtract; i++) {
      patternMatrices.push(matrixForOrder(source, i, cache).matrix);
    }
  } catch (err) {
    dispose();
    throw err;
  }
  const numOrders = metadata.numOrders;

  return {
    patternMatrices,
    metadata,
    instrumentTable,
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
          const { matrix, extracted } = matrixForOrder(source, i, cache);
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
  return { patternMatrices: open.patternMatrices, metadata: open.metadata, instrumentTable: open.instrumentTable };
}
