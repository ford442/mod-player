/**
 * Typed wrapper over the `xasm_*` module-inspection shim (wasm/xasm_inspect.cpp), linked into the
 * shared libopenmpt pair only (main thread + parser worker; never the AudioWorklet's playback heap).
 *
 * libopenmpt's C API exposes names and one pattern value per call; the shim reads the C++ object
 * libopenmpt already parsed, so every format it opens — containers (MMCMP / XPK / PP20) included —
 * gets sample info + waveform peaks, instrument envelopes, keymaps, a one-call pattern dump and a
 * linear song timeline, with no per-format TypeScript parser.
 *
 * Heap rules (utils/wasmHeap.ts): every `_malloc` is checked and freed on every path, and no heap
 * view is held across a call that may grow memory — each read re-derives `lib.HEAP*` after the call.
 * Struct layouts mirror the comments in wasm/xasm_inspect.cpp; bump XASM_INSPECT_ABI_VERSION on both
 * sides together.
 */
import type { LibOpenMPT } from '../types';
import { WAVEFORM_POINTS } from '../types/instruments';
import { copyToHeap, mallocOrThrow } from './wasmHeap';

/** Must equal `XASM_INSPECT_ABI_VERSION` in wasm/xasm_inspect.cpp (a mismatched wasm is refused). */
export const XASM_INSPECT_ABI_VERSION = 1;

const CREATE_SKIP_SAMPLES = 1;
const TIMELINE_EVERY_TICK = 1;

const MODULE_INFO_FIELDS = 6;
const SAMPLE_INFO_FIELDS = 16;
const INSTRUMENT_INFO_FIELDS = 14;
const ENVELOPE_HEADER_FIELDS = 7;
/** libopenmpt's MAX_ENVPOINTS. */
const MAX_ENVELOPE_POINTS = 240;
export const KEYMAP_NOTES = 128;
export const PATTERN_CELL_BYTES = 6;
const TIMELINE_VISIT_FIELDS = 4;
const TIMELINE_TEMPO_FIELDS = 5;
const TIMELINE_SUMMARY_FIELDS = 5;

/** The shim's exports, as the glue maps them onto the Module object. */
export interface XasmInspectExports {
  _xasm_inspect_abi_version: () => number;
  _xasm_inspect_create: (ptr: number, len: number, flags: number) => number;
  _xasm_inspect_destroy: (h: number) => void;
  _xasm_module_info: (h: number, out: number) => number;
  _xasm_pattern_num_rows: (h: number, pattern: number) => number;
  _xasm_pattern_dump: (h: number, pattern: number, out: number, maxBytes: number) => number;
  _xasm_sample_count: (h: number) => number;
  _xasm_sample_info: (h: number, index: number, out: number) => number;
  _xasm_sample_pcm_peaks: (h: number, index: number, buckets: number, out: number) => number;
  _xasm_sample_pcm: (h: number, index: number, out: number, maxValues: number) => number;
  _xasm_instrument_count: (h: number) => number;
  _xasm_instrument_info: (h: number, index: number, out: number) => number;
  _xasm_instrument_envelope: (h: number, index: number, kind: number, out: number, maxPoints: number) => number;
  _xasm_sample_map: (h: number, index: number, out: number, outNotes: number) => number;
  _xasm_song_timeline: (h: number, subsong: number, flags: number) => number;
  _xasm_timeline_visits: (h: number, out: number, maxVisits: number) => number;
  _xasm_timeline_tempo: (h: number, out: number, maxEvents: number) => number;
  _xasm_timeline_summary: (h: number, out: number) => number;
}

/** The heap views the wrapper reads (emsdk 3.x exports every HEAP* view on Module). */
interface HeapViews {
  HEAP32: Int32Array;
  HEAPU16: Uint16Array;
  HEAPF64: Float64Array;
}

export type InspectLib = Pick<LibOpenMPT, '_malloc' | '_free' | 'HEAPU8' | 'HEAPF32'> & XasmInspectExports & HeapViews;

/** Whether `lib` is a glue with the inspection shim at this ABI (the shared pair; not the playback pair). */
export function hasModuleInspect(lib: unknown): lib is InspectLib {
  const l = lib as Partial<InspectLib> | null;
  if (!l || typeof l._xasm_inspect_abi_version !== 'function' || typeof l._xasm_inspect_create !== 'function') return false;
  try {
    return l._xasm_inspect_abi_version() === XASM_INSPECT_ABI_VERSION && l.HEAP32 !== undefined && l.HEAPF64 !== undefined;
  } catch {
    return false;
  }
}

export interface ModuleInspectInfo {
  numChannels: number;
  numPatterns: number;
  numSamples: number;
  numInstruments: number;
  numSequences: number;
  /** Orders of sequence 0. */
  numOrders: number;
}

export interface InspectSampleFlags {
  is16Bit: boolean;
  stereo: boolean;
  loop: boolean;
  pingPongLoop: boolean;
  sustainLoop: boolean;
  pingPongSustain: boolean;
  /** The sample sets its own panning (`pan`). */
  forcedPanning: boolean;
  /** An OPL (AdLib) instrument: no PCM. */
  adlib: boolean;
  hasPcm: boolean;
  noDefaultVolume: boolean;
}

/** One sample header, straight from libopenmpt's ModSample. Positions are in frames. */
export interface InspectSampleInfo {
  length: number;
  loopStart: number;
  loopEnd: number;
  sustainStart: number;
  sustainEnd: number;
  flags: InspectSampleFlags;
  /** Middle-C rate as libopenmpt plays it (Hz). */
  sampleRate: number;
  /** Default volume 0..256. */
  volume: number;
  /** Default panning 0..256 (used when `flags.forcedPanning`). */
  pan: number;
  /** 0..64. */
  globalVolume: number;
  /** Semitones relative to middle C (MOD / XM). */
  relativeTone: number;
  /** 1/128 semitone (MOD / XM), −128..127. */
  finetune: number;
  vibratoType: number;
  vibratoSweep: number;
  vibratoDepth: number;
  vibratoRate: number;
}

export interface InspectInstrumentInfo {
  fadeOut: number;
  /** 0..64. */
  globalVolume: number;
  /** 0..256; applied when `panningEnabled`. */
  pan: number;
  panningEnabled: boolean;
  muted: boolean;
  newNoteAction: number;
  duplicateCheck: number;
  duplicateAction: number;
  panSwing: number;
  volSwing: number;
  /** Filter cutoff 0..127, or null when the instrument sets none. */
  cutoff: number | null;
  resonance: number | null;
  pitchPanSeparation: number;
  pitchPanCenter: number;
}

export type EnvelopeKind = 'volume' | 'panning' | 'pitch';
const ENVELOPE_KIND_INDEX: Record<EnvelopeKind, number> = { volume: 0, panning: 1, pitch: 2 };

export interface EnvelopePoint {
  tick: number;
  /** 0..64 (panning / pitch: 32 is the centre). */
  value: number;
}

export interface InstrumentEnvelope {
  enabled: boolean;
  loop: boolean;
  sustain: boolean;
  carry: boolean;
  /** Pitch envelope only: it drives the filter cutoff instead of the pitch. */
  filter: boolean;
  points: EnvelopePoint[];
  /** Node indices into `points`. */
  loopStart: number;
  loopEnd: number;
  sustainStart: number;
  sustainEnd: number;
  /** Release node (MPTM), or null. */
  releaseNode: number | null;
}

export interface SampleKeymap {
  /** Sample index (1-based; 0 = none) for notes 1..128 (index = note − 1). */
  samples: Uint16Array;
  /** The note each key plays (index = note − 1). */
  notes: Uint8Array;
}

export interface PatternDump {
  pattern: number;
  rows: number;
  channels: number;
  /** rows × channels × PATTERN_CELL_BYTES, row-major, in PatternCommand order (utils/openmptCommands.ts). */
  cells: Uint8Array;
}

export interface TimelineVisit {
  order: number;
  entryRow: number;
  exitRow: number;
  startSeconds: number;
}

export interface TimelineTempoEvent {
  seconds: number;
  order: number;
  row: number;
  /** Tracker tempo (may be fractional in MPTM / tempo slides). */
  tempo: number;
  speed: number;
}

export interface SongTimeline {
  /** In play order. An order can appear more than once (pattern-loop / jump paths). */
  visits: TimelineVisit[];
  tempoEvents: TimelineTempoEvent[];
  /** Seconds walked until playback stops or loops back. */
  durationSeconds: number;
  /** Where playback stops or loops back to. */
  endOrder: number;
  endRow: number;
  /** The walk hit its safety cap (pathological loops); the timeline is a prefix. */
  capped: boolean;
  ticks: number;
}

export interface OpenInspectOptions {
  /** Skip sample PCM (structure / timeline only: faster, less memory). */
  skipSamples?: boolean;
}

/** Run `fn` with a checked heap block of `bytes`, freed when it returns or throws. */
function withHeap<T>(lib: InspectLib, bytes: number, what: string, fn: (ptr: number) => T): T {
  const ptr = mallocOrThrow(lib, Math.max(1, bytes), what);
  try {
    return fn(ptr);
  } finally {
    lib._free(ptr);
  }
}

function int32s(lib: InspectLib, ptr: number, count: number): Int32Array {
  return lib.HEAP32.slice(ptr >> 2, (ptr >> 2) + count);
}

function float64s(lib: InspectLib, ptr: number, count: number): Float64Array {
  return lib.HEAPF64.slice(ptr >> 3, (ptr >> 3) + count);
}

/**
 * An inspection handle over one module (its own libopenmpt parse: never the playing module).
 * `destroy()` it on every path; it is idempotent, and every method throws after it.
 */
export class ModuleInspector {
  private handle: number;

  private constructor(private readonly lib: InspectLib, handle: number) {
    this.handle = handle;
  }

  /** Parse `bytes`, or null when libopenmpt rejects them. Throws when the heap cannot hold the copy. */
  static open(lib: InspectLib, bytes: Uint8Array, options: OpenInspectOptions = {}): ModuleInspector | null {
    const ptr = copyToHeap(lib, bytes);
    let handle = 0;
    try {
      handle = lib._xasm_inspect_create(ptr, bytes.byteLength, options.skipSamples ? CREATE_SKIP_SAMPLES : 0);
    } finally {
      lib._free(ptr);
    }
    return handle ? new ModuleInspector(lib, handle) : null;
  }

  get alive(): boolean {
    return this.handle !== 0;
  }

  destroy(): void {
    if (!this.handle) return;
    const h = this.handle;
    this.handle = 0;
    this.lib._xasm_inspect_destroy(h);
  }

  private h(): number {
    if (!this.handle) throw new Error('ModuleInspector used after destroy()');
    return this.handle;
  }

  info(): ModuleInspectInfo {
    const lib = this.lib;
    return withHeap(lib, 4 * MODULE_INFO_FIELDS, 'module info', (out) => {
      if (lib._xasm_module_info(this.h(), out) !== MODULE_INFO_FIELDS) throw new Error('xasm_module_info failed');
      const v = int32s(lib, out, MODULE_INFO_FIELDS);
      return {
        numChannels: v[0]!,
        numPatterns: v[1]!,
        numSamples: v[2]!,
        numInstruments: v[3]!,
        numSequences: v[4]!,
        numOrders: v[5]!,
      };
    });
  }

  patternRows(pattern: number): number {
    return this.lib._xasm_pattern_num_rows(this.h(), pattern);
  }

  /** One wasm call for the whole pattern. `channels` defaults to the module's. Rows 0 for a missing pattern. */
  dumpPattern(pattern: number, channels = this.info().numChannels): PatternDump {
    const lib = this.lib;
    const rows = this.patternRows(pattern);
    const size = rows * channels * PATTERN_CELL_BYTES;
    if (rows === 0 || size === 0) return { pattern, rows: 0, channels, cells: new Uint8Array(0) };
    return withHeap(lib, size, 'pattern dump', (out) => {
      const written = lib._xasm_pattern_dump(this.h(), pattern, out, size);
      if (written !== rows) throw new Error(`xasm_pattern_dump(${pattern}) returned ${written}, expected ${rows}`);
      return { pattern, rows, channels, cells: lib.HEAPU8.slice(out, out + size) };
    });
  }

  sampleCount(): number {
    return this.lib._xasm_sample_count(this.h());
  }

  /** 1-based `index`; null when out of range. */
  sampleInfo(index: number): InspectSampleInfo | null {
    const lib = this.lib;
    return withHeap(lib, 4 * SAMPLE_INFO_FIELDS, 'sample info', (out) => {
      if (lib._xasm_sample_info(this.h(), index, out) !== 1) return null;
      const v = int32s(lib, out, SAMPLE_INFO_FIELDS);
      const f = v[5]!;
      return {
        length: v[0]!,
        loopStart: v[1]!,
        loopEnd: v[2]!,
        sustainStart: v[3]!,
        sustainEnd: v[4]!,
        flags: {
          is16Bit: (f & 1) !== 0,
          stereo: (f & 2) !== 0,
          loop: (f & 4) !== 0,
          pingPongLoop: (f & 8) !== 0,
          sustainLoop: (f & 16) !== 0,
          pingPongSustain: (f & 32) !== 0,
          forcedPanning: (f & 64) !== 0,
          adlib: (f & 128) !== 0,
          hasPcm: (f & 256) !== 0,
          noDefaultVolume: (f & 512) !== 0,
        },
        sampleRate: v[6]!,
        volume: v[7]!,
        pan: v[8]!,
        globalVolume: v[9]!,
        relativeTone: v[10]!,
        finetune: v[11]!,
        vibratoType: v[12]!,
        vibratoSweep: v[13]!,
        vibratoDepth: v[14]!,
        vibratoRate: v[15]!,
      };
    });
  }

  /**
   * Min/max peaks, interleaved (min0, max0, min1, max1, …), `buckets` pairs in [-1, 1], computed in
   * C++ (the PCM never crosses into JS). Empty when the sample has no PCM.
   */
  samplePeaks(index: number, buckets = WAVEFORM_POINTS): Float32Array {
    const lib = this.lib;
    return withHeap(lib, 8 * buckets, 'sample peaks', (out) => {
      const n = lib._xasm_sample_pcm_peaks(this.h(), index, buckets, out);
      return n > 0 ? lib.HEAPF32.slice(out >> 2, (out >> 2) + 2 * n) : new Float32Array(0);
    });
  }

  /** Full PCM as floats in [-1, 1), interleaved when stereo (opt-in: large). */
  samplePcm(index: number): Float32Array {
    const info = this.sampleInfo(index);
    if (!info || !info.flags.hasPcm) return new Float32Array(0);
    const values = info.length * (info.flags.stereo ? 2 : 1);
    const lib = this.lib;
    return withHeap(lib, 4 * values, 'sample PCM', (out) => {
      const n = lib._xasm_sample_pcm(this.h(), index, out, values);
      return lib.HEAPF32.slice(out >> 2, (out >> 2) + n);
    });
  }

  instrumentCount(): number {
    return this.lib._xasm_instrument_count(this.h());
  }

  /** 1-based `index`; null when out of range or the slot is empty. */
  instrumentInfo(index: number): InspectInstrumentInfo | null {
    const lib = this.lib;
    return withHeap(lib, 4 * INSTRUMENT_INFO_FIELDS, 'instrument info', (out) => {
      if (lib._xasm_instrument_info(this.h(), index, out) !== 1) return null;
      const v = int32s(lib, out, INSTRUMENT_INFO_FIELDS);
      if (v[0] !== 1) return null;
      return {
        fadeOut: v[1]!,
        globalVolume: v[2]!,
        pan: v[3]!,
        panningEnabled: (v[4]! & 1) !== 0,
        muted: (v[4]! & 2) !== 0,
        newNoteAction: v[5]!,
        duplicateCheck: v[6]!,
        duplicateAction: v[7]!,
        panSwing: v[8]!,
        volSwing: v[9]!,
        cutoff: (v[10]! & 0x80) !== 0 ? v[10]! & 0x7f : null,
        resonance: (v[11]! & 0x80) !== 0 ? v[11]! & 0x7f : null,
        pitchPanSeparation: v[12]!,
        pitchPanCenter: v[13]!,
      };
    });
  }

  /** Null when the instrument does not exist. */
  envelope(index: number, kind: EnvelopeKind): InstrumentEnvelope | null {
    const lib = this.lib;
    return withHeap(lib, 4 * (ENVELOPE_HEADER_FIELDS + 2 * MAX_ENVELOPE_POINTS), 'envelope', (out) => {
      const total = lib._xasm_instrument_envelope(this.h(), index, ENVELOPE_KIND_INDEX[kind], out, MAX_ENVELOPE_POINTS);
      if (total < 0) return null;
      const n = Math.min(total, MAX_ENVELOPE_POINTS);
      const v = int32s(lib, out, ENVELOPE_HEADER_FIELDS + 2 * n);
      const flags = v[0]!;
      const points: EnvelopePoint[] = [];
      for (let i = 0; i < n; i++) {
        points.push({ tick: v[ENVELOPE_HEADER_FIELDS + 2 * i]!, value: v[ENVELOPE_HEADER_FIELDS + 2 * i + 1]! });
      }
      return {
        enabled: (flags & 1) !== 0,
        loop: (flags & 2) !== 0,
        sustain: (flags & 4) !== 0,
        carry: (flags & 8) !== 0,
        filter: (flags & 16) !== 0,
        points,
        loopStart: v[2]!,
        loopEnd: v[3]!,
        sustainStart: v[4]!,
        sustainEnd: v[5]!,
        releaseNode: v[6] === 0xff ? null : v[6]!,
      };
    });
  }

  /** The note → sample keymap; null when the instrument does not exist. */
  keymap(index: number): SampleKeymap | null {
    const lib = this.lib;
    return withHeap(lib, 3 * KEYMAP_NOTES, 'keymap', (out) => {
      const notesPtr = out + 2 * KEYMAP_NOTES;
      if (lib._xasm_sample_map(this.h(), index, out, notesPtr) !== KEYMAP_NOTES) return null;
      return {
        samples: lib.HEAPU16.slice(out >> 1, (out >> 1) + KEYMAP_NOTES),
        notes: lib.HEAPU8.slice(notesPtr, notesPtr + KEYMAP_NOTES),
      };
    });
  }

  /**
   * ONE playback-state walk of `subsong` (libopenmpt's own row/tick code, no mixing): every order
   * visit with its start on libopenmpt's clock, and the tempo / speed changes. Linear in song length.
   * `everyTick` runs the effect code on every tick (the reference the fast walk is tested against).
   * Moves this handle's play position.
   */
  songTimeline(subsong = 0, options: { everyTick?: boolean } = {}): SongTimeline {
    const lib = this.lib;
    const h = this.h();
    const count = lib._xasm_song_timeline(h, subsong, options.everyTick ? TIMELINE_EVERY_TICK : 0);
    if (count < 0) throw new Error('xasm_song_timeline failed');
    const visits: TimelineVisit[] = [];
    if (count > 0) {
      withHeap(lib, 8 * TIMELINE_VISIT_FIELDS * count, 'timeline visits', (out) => {
        const n = lib._xasm_timeline_visits(h, out, count);
        const v = float64s(lib, out, TIMELINE_VISIT_FIELDS * n);
        for (let i = 0; i < n; i++) {
          const o = TIMELINE_VISIT_FIELDS * i;
          visits.push({ order: v[o]!, entryRow: v[o + 1]!, exitRow: v[o + 2]!, startSeconds: v[o + 3]! });
        }
      });
    }
    const tempoEvents: TimelineTempoEvent[] = [];
    const tempoCount = lib._xasm_timeline_tempo(h, 0, 0);
    if (tempoCount > 0) {
      withHeap(lib, 8 * TIMELINE_TEMPO_FIELDS * tempoCount, 'timeline tempo', (out) => {
        const n = lib._xasm_timeline_tempo(h, out, tempoCount);
        const v = float64s(lib, out, TIMELINE_TEMPO_FIELDS * n);
        for (let i = 0; i < n; i++) {
          const o = TIMELINE_TEMPO_FIELDS * i;
          tempoEvents.push({ seconds: v[o]!, order: v[o + 1]!, row: v[o + 2]!, tempo: v[o + 3]!, speed: v[o + 4]! });
        }
      });
    }
    return withHeap(lib, 8 * TIMELINE_SUMMARY_FIELDS, 'timeline summary', (out) => {
      lib._xasm_timeline_summary(h, out);
      const s = float64s(lib, out, TIMELINE_SUMMARY_FIELDS);
      return {
        visits,
        tempoEvents,
        durationSeconds: s[0]!,
        endOrder: s[1]!,
        endRow: s[2]!,
        capped: s[3] === 1,
        ticks: s[4]!,
      };
    });
  }
}

/** `ModuleInspector.open`, or null when the glue has no inspection shim at this ABI. */
export function openModuleInspector(lib: unknown, bytes: Uint8Array, options: OpenInspectOptions = {}): ModuleInspector | null {
  if (!hasModuleInspect(lib)) return null;
  return ModuleInspector.open(lib, bytes, options);
}

/** First visit start (seconds) of every order the timeline reaches. */
export function firstVisitSeconds(timeline: SongTimeline): Map<number, TimelineVisit> {
  const first = new Map<number, TimelineVisit>();
  for (const v of timeline.visits) if (!first.has(v.order)) first.set(v.order, v);
  return first;
}
