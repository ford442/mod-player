import type { InstrumentTable } from '../../types/instruments';
import { emptyInstrumentTable } from '../../types/instruments';
import { extractModInstrumentTable, isProTrackerMod } from './mod';

export { downsamplePeaks } from './downsample';
export { extractModInstrumentTable, isProTrackerMod, MAX_SAMPLE_DECODE_BYTES } from './mod';

function formatFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/**
 * Extract instrument/sample table + downsampled waveforms from raw module bytes.
 * Runs on worker thread; only peak arrays cross to the main thread.
 */
export function extractInstrumentTable(
  fileData: Uint8Array,
  fileName: string,
): InstrumentTable {
  const ext = formatFromFileName(fileName);

  if (ext === 'mod' || isProTrackerMod(fileData)) {
    const table = extractModInstrumentTable(fileData);
    if (table.format !== 'unknown') return table;
  }

  // XM / IT / S3M parsers — phase 1b
  return emptyInstrumentTable();
}

/** Prefer libopenmpt instrument names when file parser left a slot name empty. */
export function mergeLibInstrumentNames(
  table: InstrumentTable,
  libNames: string[],
): InstrumentTable {
  if (!libNames.length) return table;

  const instruments = table.instruments.map((inst, i) => {
    const libName = libNames[i]?.trim() ?? '';
    if (!libName) return inst;
    const name = inst.name.trim() ? inst.name : libName;
    return name === inst.name ? inst : { ...inst, name };
  });

  const samples = table.samples.map((sample, i) => {
    const libName = libNames[i]?.trim() ?? '';
    if (!libName) return sample;
    const name = sample.name.trim() ? sample.name : libName;
    return name === sample.name ? sample : { ...sample, name };
  });

  return { ...table, instruments, samples };
}
