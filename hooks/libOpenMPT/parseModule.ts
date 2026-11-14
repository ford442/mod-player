import type { LibOpenMPT } from '../../types';
import type { InstrumentTable } from '../../types/instruments';
import { emptyInstrumentTable } from '../../types/instruments';
import { extractInstrumentTable, mergeLibInstrumentNames } from '../../utils/sampleExtract';
import { parseModuleWithLibOpen, type OpenModuleParse } from '../../utils/parseModuleWithLib';
import { parserLog } from '../../utils/parserDebug';
import type { ParseProgressStage, ParserWorkerClient } from '../../utils/parserWorker';
import type { WorkerParseError, WorkerParseResponse } from '../../types';
import { createLogger } from '../../utils/log';

const log = createLogger('Parser');

export function isLibReadyForParse(lib: LibOpenMPT): boolean {
  return typeof lib._openmpt_module_create_from_memory2 === 'function';
}

/** A parse result, plus — for a main-thread parse — the module handle it left open for the backfill. */
export interface ResolvedModuleParse extends WorkerParseResponse {
  /**
   * Main-thread parse only: the handle the order-0 parse created, kept open so the pattern
   * backfill reads the rest of the song from it instead of creating the module a second time.
   * The caller owns it: `backfill()` or `dispose()` it on every path.
   */
  openModule?: OpenModuleParse;
}

function parseOnMainThread(
  lib: LibOpenMPT,
  fileData: Uint8Array,
  fileName: string,
): ResolvedModuleParse {
  parserLog('main-thread parse (fast path: order 0)', fileName, fileData.byteLength);
  const parsed = parseModuleWithLibOpen(lib, fileData, fileName, { maxOrders: 1 });
  if (!parsed.patternMatrices.length) {
    parsed.dispose();
    throw new Error('No pattern data in module');
  }
  log.log(
    `main-thread fast parse OK (${fileName}):`,
    parsed.metadata.numOrders,
    'orders (order 0 ready, backfill pending),',
    parsed.metadata.numChannels,
    'channels',
  );
  let instrumentTable: InstrumentTable;
  try {
    instrumentTable = mergeLibInstrumentNames(
      extractInstrumentTable(fileData, fileName),
      parsed.metadata.instruments,
    );
  } catch (err) {
    parsed.dispose();
    throw err;
  }
  return {
    type: 'parsed',
    patternMatrices: parsed.patternMatrices,
    metadata: parsed.metadata,
    instrumentTable,
    openModule: parsed,
  };
}

/**
 * Parse `fileData` (the caller's copy: it is only read here). On the main thread when its
 * libopenmpt is ready; otherwise in the warm parser worker, which gets a copy of its own
 * (transferred, so the caller's bytes stay intact), falling back to the main thread if it fails.
 */
export async function resolveParsedModule(
  lib: LibOpenMPT,
  parser: ParserWorkerClient | null,
  fileData: Uint8Array,
  fileName: string,
  onParseProgress?: (stage: ParseProgressStage) => void,
): Promise<ResolvedModuleParse> {
  // Main thread already has initialized libopenmpt from index.html — use it directly.
  // The worker re-fetches WASM from CDN (slow, can fail under strict COEP/CORP).
  if (isLibReadyForParse(lib)) {
    onParseProgress?.('patterns');
    return parseOnMainThread(lib, fileData, fileName);
  }

  if (parser) {
    let workerResult: WorkerParseResponse | WorkerParseError | null = null;
    try {
      workerResult = await parser.parse(
        fileData.slice(),
        fileName,
        onParseProgress ? { onProgress: onParseProgress } : {},
      );
      if (
        workerResult.type === 'parsed' &&
        workerResult.patternMatrices.length > 0
      ) {
        return workerResult;
      }
      if (workerResult.type === 'error') {
        console.warn(`[Parser] worker error (${fileName}):`, workerResult.message);
      } else {
        console.warn(`[Parser] worker returned empty patternMatrices (${fileName})`);
      }
    } catch (err) {
      // The client already dropped a failed / hung worker; the next parse gets a fresh one.
      console.warn(`[Parser] worker path failed (${fileName}) — main-thread fallback:`, err);
      parserLog('worker failed', fileName, err);
    }
  }

  return parseOnMainThread(lib, fileData, fileName);
}

export { emptyInstrumentTable };
export type { InstrumentTable };
