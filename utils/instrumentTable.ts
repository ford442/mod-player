/**
 * The instrument / sample table of a module (InstrumentPanel, the inspector), read from libopenmpt's
 * own parse through the inspection shim (utils/moduleInspect.ts) — every format libopenmpt opens,
 * containers included. Replaces the per-format TypeScript parsers (utils/sampleExtract/, #528).
 *
 * Names come from the C API (`openmpt_module_get_{sample,instrument}_name`, already read for the
 * metadata): the same libopenmpt parse, so they always match these indices — in particular an XM
 * instrument's samples keep their own names, not their instrument's.
 */
import type {
  InstrumentEnvelopeInfo,
  InstrumentInfo,
  InstrumentTable,
  SampleInfo,
} from '../types/instruments';
import { WAVEFORM_POINTS, emptyInstrumentTable } from '../types/instruments';
import type { ModuleInspector } from './moduleInspect';

export interface InstrumentTableNames {
  /** libopenmpt metadata `type`. */
  format: string;
  /** 0-based (index 0 = instrument 1). */
  instrumentNames: readonly string[];
  /** 0-based (index 0 = sample 1). */
  sampleNames: readonly string[];
}

/** Signed thumbnail peak per bucket from (min, max) pairs: whichever has the larger magnitude. */
export function waveformFromPeaks(peaks: Float32Array): Float32Array {
  const n = peaks.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = peaks[2 * i]!;
    const hi = peaks[2 * i + 1]!;
    out[i] = Math.abs(hi) >= Math.abs(lo) ? hi : lo;
  }
  return out;
}

const EMPTY_ENVELOPE: InstrumentEnvelopeInfo = {
  enabled: false, loop: false, sustain: false, carry: false, filter: false, points: [],
  loopStart: 0, loopEnd: 0, sustainStart: 0, sustainEnd: 0, releaseNode: null,
};

function readSample(inspector: ModuleInspector, index: number, name: string): SampleInfo | null {
  const info = inspector.sampleInfo(index);
  if (!info) return null;
  const { flags } = info;
  const length = flags.hasPcm ? info.length : 0;
  const peaks = flags.hasPcm ? inspector.samplePeaks(index, WAVEFORM_POINTS) : new Float32Array(0);
  const bytesPerFrame = (flags.is16Bit ? 2 : 1) * (flags.stereo ? 2 : 1);
  const loops = flags.loop && info.loopEnd > info.loopStart;
  const sustains = flags.sustainLoop && info.sustainEnd > info.sustainStart;
  return {
    index,
    name,
    length,
    bytes: length * bytesPerFrame,
    loopStart: loops ? info.loopStart : 0,
    loopEnd: loops ? info.loopEnd : 0,
    sustainStart: sustains ? info.sustainStart : 0,
    sustainEnd: sustains ? info.sustainEnd : 0,
    volume: Math.round(info.volume / 4),
    finetune: info.finetune,
    transpose: info.relativeTone,
    sampleRate: info.sampleRate,
    pan: flags.forcedPanning ? info.pan : null,
    is16Bit: flags.is16Bit,
    stereo: flags.stereo,
    pingPongLoop: loops && flags.pingPongLoop,
    hasPcm: flags.hasPcm,
    waveform: waveformFromPeaks(peaks),
    peaks,
  };
}

/** Read the whole table. Instrument-less formats (MOD, S3M, sample-mode IT) list one entry per sample. */
export function readInstrumentTable(inspector: ModuleInspector, names: InstrumentTableNames): InstrumentTable {
  const samples: SampleInfo[] = [];
  const byIndex = new Map<number, SampleInfo>();
  const numSamples = inspector.sampleCount();
  for (let i = 1; i <= numSamples; i++) {
    const s = readSample(inspector, i, names.sampleNames[i - 1] ?? '');
    if (!s) continue;
    samples.push(s);
    byIndex.set(i, s);
  }

  const instruments: InstrumentInfo[] = [];
  const numInstruments = inspector.instrumentCount();
  if (numInstruments === 0) {
    for (const s of samples) {
      instruments.push({ index: s.index, name: s.name, sampleIndices: [s.index], volume: s.volume, samples: [s] });
    }
  } else {
    for (let i = 1; i <= numInstruments; i++) {
      const name = names.instrumentNames[i - 1] ?? '';
      const info = inspector.instrumentInfo(i);
      if (!info) {
        // An empty slot inside the count (IT / XM leave gaps): listed by name, no samples.
        instruments.push({ index: i, name, sampleIndices: [], samples: [] });
        continue;
      }
      const keymap = inspector.keymap(i);
      const used = new Set<number>();
      if (keymap) for (const smp of keymap.samples) if (smp > 0 && byIndex.has(smp)) used.add(smp);
      const sampleIndices = [...used].sort((a, b) => a - b);
      instruments.push({
        index: i,
        name,
        sampleIndices,
        volume: info.globalVolume,
        samples: sampleIndices.map((s) => byIndex.get(s)!),
        ...(keymap ? { keymap: keymap.samples } : {}),
        envelopes: {
          volume: inspector.envelope(i, 'volume') ?? EMPTY_ENVELOPE,
          panning: inspector.envelope(i, 'panning') ?? EMPTY_ENVELOPE,
          pitch: inspector.envelope(i, 'pitch') ?? EMPTY_ENVELOPE,
        },
        fadeOut: info.fadeOut,
      });
    }
  }

  if (samples.length === 0 && instruments.length === 0) return emptyInstrumentTable();
  return { format: names.format || 'unknown', instruments, samples };
}

/**
 * The names-only table for a glue without the inspection shim (never the committed shared pair —
 * kept so a stale cached glue still lists the instruments).
 */
export function instrumentTableFromNames(names: InstrumentTableNames): InstrumentTable {
  const blank = (index: number, name: string): SampleInfo => ({
    index, name, length: 0, bytes: 0, loopStart: 0, loopEnd: 0, sustainStart: 0, sustainEnd: 0,
    volume: 0, finetune: 0, transpose: 0, sampleRate: 0, pan: null, is16Bit: false, stereo: false,
    pingPongLoop: false, hasPcm: false, waveform: new Float32Array(0), peaks: new Float32Array(0),
  });
  const samples = names.sampleNames.map((n, i) => blank(i + 1, n));
  const instruments: InstrumentInfo[] = names.instrumentNames.length
    ? names.instrumentNames.map((n, i) => ({ index: i + 1, name: n, sampleIndices: [], samples: [] }))
    : samples.map((s) => ({ index: s.index, name: s.name, sampleIndices: [s.index], samples: [s] }));
  if (!samples.length && !instruments.length) return emptyInstrumentTable();
  return { format: names.format || 'unknown', instruments, samples };
}
