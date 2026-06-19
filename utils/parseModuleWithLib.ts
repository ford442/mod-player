import type { LibOpenMPT, PatternMatrix, WorkerParseMetadata } from '../types';
import { getPatternMatrix } from './patternExtractor';

export interface ParsedModuleData {
  patternMatrices: PatternMatrix[];
  metadata: WorkerParseMetadata;
}

/**
 * Parse tracker pattern data from an in-memory module using an initialized libopenmpt instance.
 * Creates a temporary module handle and destroys it before returning.
 */
export function parseModuleWithLib(
  lib: LibOpenMPT,
  fileData: Uint8Array,
  fileName: string,
): ParsedModuleData {
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

  try {
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

    const patternMatrices: PatternMatrix[] = [];
    let totalPatternRows = 0;
    for (let i = 0; i < numOrders; i++) {
      const patIdx = lib._openmpt_module_get_order_pattern(modPtr, i);
      const matrix = getPatternMatrix(lib, modPtr, patIdx, i);
      patternMatrices.push(matrix);
      totalPatternRows += matrix.numRows;
    }

    return {
      patternMatrices,
      metadata: {
        title: title || fileName,
        numOrders,
        numChannels,
        initialBpm,
        durationSeconds,
        totalPatternRows,
        numInstruments,
        instruments,
        comments,
      },
    };
  } finally {
    lib._openmpt_module_destroy(modPtr);
  }
}
