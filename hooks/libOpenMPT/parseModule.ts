import type { LibOpenMPT } from '../../types';
import type { InstrumentTable } from '../../types/instruments';
import { emptyInstrumentTable } from '../../types/instruments';
import { extractInstrumentTable, mergeLibInstrumentNames } from '../../utils/sampleExtract';
import { parseModuleWithLib } from '../../utils/parseModuleWithLib';
import { parserLog } from '../../utils/parserDebug';
import { parseInWorker } from '../../utils/parserWorker';
import type { WorkerParseError, WorkerParseResponse } from '../../types';

export function isLibReadyForParse(lib: LibOpenMPT): boolean {
  return typeof lib._openmpt_module_create_from_memory2 === 'function';
}

function parseOnMainThread(
  lib: LibOpenMPT,
  fileData: Uint8Array,
  fileName: string,
): WorkerParseResponse {
  parserLog('main-thread parse (fast path: order 0)', fileName, fileData.byteLength);
  const parsed = parseModuleWithLib(lib, fileData, fileName, { maxOrders: 1 });
  if (!parsed.patternMatrices.length) {
    throw new Error('No pattern data in module');
  }
  console.log(
    `[Parser] main-thread fast parse OK (${fileName}):`,
    parsed.metadata.numOrders,
    'orders (order 0 ready, backfill pending),',
    parsed.metadata.numChannels,
    'channels',
  );
  return {
    type: 'parsed',
    patternMatrices: parsed.patternMatrices,
    metadata: parsed.metadata,
    instrumentTable: mergeLibInstrumentNames(
      extractInstrumentTable(fileData, fileName),
      parsed.metadata.instruments,
    ),
  };
}

export async function resolveParsedModule(
  lib: LibOpenMPT,
  worker: Worker | null,
  workerRefObj: { current: Worker | null },
  fileDataForWorker: Uint8Array,
  fileDataCopy: Uint8Array,
  fileName: string,
  onParseProgress?: (stage: 'fetch' | 'wasm' | 'patterns' | 'instruments') => void,
): Promise<WorkerParseResponse> {
  // Main thread already has initialized libopenmpt from index.html — use it directly.
  // The worker re-fetches WASM from CDN (slow, can fail under strict COEP/CORP).
  if (isLibReadyForParse(lib)) {
    onParseProgress?.('patterns');
    return parseOnMainThread(lib, fileDataCopy, fileName);
  }

  let workerResult: WorkerParseResponse | WorkerParseError | null = null;

  if (worker) {
    try {
      workerResult = await parseInWorker(
        worker,
        { type: 'parse', fileData: fileDataForWorker, fileName },
        [fileDataForWorker.buffer],
        onParseProgress,
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
      console.warn(`[Parser] worker path failed (${fileName}) — main-thread fallback:`, err);
      parserLog('worker failed', fileName, err);
    } finally {
      // The worker is now either hung (timeout terminated it) or in a bad state;
      // discard it so the next load gets a fresh worker.
      if (workerRefObj.current) {
        try { workerRefObj.current.terminate(); } catch { /* ignore */ }
        workerRefObj.current = null;
      }
    }
  }

  return parseOnMainThread(lib, fileDataCopy, fileName);
}

export { emptyInstrumentTable };
export type { InstrumentTable };
