import type { LibOpenMPT, PatternMatrix, WorkerParseMetadata } from '../types';
import { getPatternMatrix } from './patternExtractor';

export interface ParsedModuleData {
  patternMatrices: PatternMatrix[];
  metadata: WorkerParseMetadata;
}

export interface ParseModuleOptions {
  /**
   * Extract at most this many orders (1 = first order only).
   * Metadata still reflects the full module. Use with `backfillPatternMatrices`
   * to load remaining orders without blocking playback start.
   */
  maxOrders?: number;
}

export interface BackfillPatternOptions {
  startOrder?: number;
  /** Yield to the main thread every N orders (keeps UI + audio responsive). */
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
  const bufferSize = fileData.byteLength;
  const bufferPtr = lib._malloc(bufferSize);
  lib.HEAPU8.set(fileData, bufferPtr);

  const modPtr = lib._openmpt_module_create_from_memory2(
    bufferPtr,
    bufferSize,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  );
  lib._free(bufferPtr);

  if (modPtr === 0) {
    throw new Error('Failed to load module (invalid format?)');
  }
  return modPtr;
}

function readModuleMetadata(
  lib: LibOpenMPT,
  modPtr: number,
  fileName: string,
): WorkerParseMetadata {
  const titlePtr = lib._openmpt_module_get_metadata(modPtr, lib.stringToUTF8('title'));
  const title = lib.UTF8ToString(titlePtr);
  lib._openmpt_free_string(titlePtr);
  const commentsPtr = lib._openmpt_module_get_metadata(modPtr, lib.stringToUTF8('message'));
  const comments = lib.UTF8ToString(commentsPtr);
  lib._openmpt_free_string(commentsPtr);

  const numOrders = lib._openmpt_module_get_num_orders(modPtr);
  const numChannels = lib._openmpt_module_get_num_channels(modPtr);
  const initialBpm = lib._openmpt_module_get_current_estimated_bpm(modPtr);
  const durationSeconds = lib._openmpt_module_get_duration_seconds(modPtr);
  const numInstruments = lib._openmpt_module_get_num_instruments(modPtr);

  const instruments: string[] = [];
  for (let i = 0; i < numInstruments; i++) {
    const namePtr = lib._openmpt_module_get_instrument_name(modPtr, i);
    instruments.push(lib.UTF8ToString(namePtr));
    lib._openmpt_free_string(namePtr);
  }

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
    comments,
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
  const modPtr = createModulePtr(lib, fileData);

  try {
    const metadata = readModuleMetadata(lib, modPtr, fileName);
    const ordersToExtract = Math.min(
      metadata.numOrders,
      options?.maxOrders ?? metadata.numOrders,
    );

    const patternMatrices: PatternMatrix[] = [];
    for (let i = 0; i < ordersToExtract; i++) {
      const patIdx = lib._openmpt_module_get_order_pattern(modPtr, i);
      patternMatrices.push(getPatternMatrix(lib, modPtr, patIdx, i));
    }

    return { patternMatrices, metadata };
  } finally {
    lib._openmpt_module_destroy(modPtr);
  }
}

/**
 * Fill remaining order slots in `target` (sparse array indexed by order).
 * Re-opens the module once and yields periodically so XM backfill does not
 * block audio startup or resize handling.
 */
export async function backfillPatternMatrices(
  lib: LibOpenMPT,
  fileData: Uint8Array,
  numOrders: number,
  target: (PatternMatrix | null)[],
  options?: BackfillPatternOptions,
): Promise<void> {
  const startOrder = options?.startOrder ?? 0;
  const yieldEvery = options?.yieldEvery ?? 2;
  const signal = options?.signal;

  if (startOrder >= numOrders) return;

  const modPtr = createModulePtr(lib, fileData);
  try {
    for (let i = startOrder; i < numOrders; i++) {
      if (signal?.aborted) return;
      if (target[i]) continue;

      const patIdx = lib._openmpt_module_get_order_pattern(modPtr, i);
      target[i] = getPatternMatrix(lib, modPtr, patIdx, i);

      const ordersDone = i - startOrder + 1;
      if (yieldEvery > 0 && ordersDone % yieldEvery === 0) {
        await yieldToMainThread();
      }
    }
  } finally {
    lib._openmpt_module_destroy(modPtr);
  }
}
