import type { PatternCell, PatternMatrix } from '../types';

export const PATTERN_DUMP_VERSION = 1 as const;

export interface PatternDumpPayload {
  version: typeof PATTERN_DUMP_VERSION;
  moduleFileName?: string;
  order: number;
  patternIndex: number;
  numRows: number;
  numChannels: number;
  rows: PatternCell[][];
}

export function serializePatternDump(
  matrix: PatternMatrix,
  options?: { moduleFileName?: string },
): PatternDumpPayload {
  const payload: PatternDumpPayload = {
    version: PATTERN_DUMP_VERSION,
    order: matrix.order,
    patternIndex: matrix.patternIndex,
    numRows: matrix.numRows,
    numChannels: matrix.numChannels,
    rows: matrix.rows.map((row) => row.map((cell) => ({ ...cell }))),
  };
  if (options?.moduleFileName) {
    payload.moduleFileName = options.moduleFileName;
  }
  return payload;
}

export function patternDumpFileName(moduleFileName: string | undefined, order: number): string {
  const base = (moduleFileName || 'pattern')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 64) || 'pattern';
  return `${base}-pattern-o${order}.json`;
}

/** Trigger a browser download of the edited pattern matrix as JSON. */
export function downloadPatternDump(
  matrix: PatternMatrix,
  options?: { moduleFileName?: string },
): void {
  const payload = serializePatternDump(matrix, options);
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = patternDumpFileName(options?.moduleFileName, matrix.order);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
