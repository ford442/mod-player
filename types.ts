// Core type definitions for MOD Player

export interface PatternCell {
  type: 'note' | 'instrument' | 'effect' | 'empty';
  text: string;
  note?: number | undefined;
  inst?: number | undefined;
  volCmd?: number | undefined;
  volVal?: number | undefined;
  effCmd?: number | undefined;
  effVal?: number | undefined;
  // Note duration fields (computed by calculateNoteDurations in gpuPacking.ts)
  noteDuration?: number | undefined;
  isSustained?: boolean | undefined;
  isTrigger?: boolean | undefined;
}

export interface PatternRow {
  cells: PatternCell[];
}

export interface PatternMatrix {
  order: number;
  patternIndex: number;
  numRows: number;
  numChannels: number;
  rows: PatternCell[][];
}

export interface ChannelShadowState {
  volume: number;
  pan: number;
  freq: number;
  trigger: number;
  noteAge: number;
  activeEffect: number;
  effectValue: number;
  isMuted: number;
}

export interface ModuleInfo {
  title: string;
  order: number;
  row: number;
  bpm: number;
  numChannels: number;
}

export interface ModuleMetadata {
  title: string;
  artist: string;
  tracker: string;
  numChannels: number;
  numOrders: number;
  numPatterns: number;
  numInstruments: number;
  durationSeconds: number;
  currentBpm: number;
  instruments: string[];
}

export interface LibOpenMPT {
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  _openmpt_module_create_from_memory2: (
    bufferPtr: number,
    bufferSize: number,
    logFunc: number,
    errorFunc: number,
    errorCodePtr: number,
    errorMsgPtr: number,
    ctls: number,
    reserved1: number,
    reserved2: number
  ) => number;
  _openmpt_module_destroy: (modPtr: number) => void;
  _openmpt_module_get_metadata: (modPtr: number, keyPtr: number) => number;
  _openmpt_free_string: (strPtr: number) => void;
  _openmpt_module_get_pattern_num_rows: (modPtr: number, patternIndex: number) => number;
  _openmpt_module_get_num_channels: (modPtr: number) => number;
  _openmpt_module_get_pattern_row_channel_command: (
    modPtr: number,
    patternIndex: number,
    row: number,
    channel: number,
    command: number
  ) => number;
  _openmpt_module_get_current_order: (modPtr: number) => number;
  _openmpt_module_get_current_row: (modPtr: number) => number;
  _openmpt_module_get_position_seconds: (modPtr: number) => number;
  _openmpt_module_get_duration_seconds: (modPtr: number) => number;
  _openmpt_module_get_num_orders: (modPtr: number) => number;
  _openmpt_module_get_order_pattern: (modPtr: number, order: number) => number;
  _openmpt_module_get_current_estimated_bpm: (modPtr: number) => number;
  _openmpt_module_get_current_channel_vu_mono: (modPtr: number, channel: number) => number;
  _openmpt_module_get_num_instruments: (modPtr: number) => number;
  _openmpt_module_get_instrument_name: (modPtr: number, index: number) => number;
  _openmpt_module_set_position_order_row: (
    modPtr: number,
    order: number,
    row: number
  ) => void;
  _openmpt_module_read_float_stereo: (
    modPtr: number,
    sampleRate: number,
    count: number,
    leftPtr: number,
    rightPtr: number
  ) => number;
  _openmpt_module_set_render_param: (
    modPtr: number,
    param: number,
    value: number
  ) => void;
  UTF8ToString: (ptr: number) => string;
  stringToUTF8: (str: string) => number;
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
}

export type AudioEngine = 'worklet' | 'native-worklet' | 'scriptprocessor';

// Web Worker parse protocol
export interface WorkerParseRequest {
  type: 'parse';
  fileData: Uint8Array;
  fileName: string;
}

export interface WorkerParseMetadata {
  title: string;
  numOrders: number;
  numChannels: number;
  initialBpm: number;
  durationSeconds: number;
  totalPatternRows: number;
  numInstruments: number;
  instruments: string[];
}

export interface WorkerParseResponse {
  type: 'parsed';
  patternMatrices: PatternMatrix[];
  metadata: WorkerParseMetadata;
}

export interface WorkerParseError {
  type: 'error';
  message: string;
}

export type WorkerParseMessage = WorkerParseRequest;
export type WorkerParseResult = WorkerParseResponse | WorkerParseError;

export interface PlaybackState {
  playheadRow: number;
  currentOrder: number;
  timeSec: number;
  beatPhase: number;
  kickTrigger: number;
  grooveAmount: number;
  lastUpdateTimestamp: number;
}

export interface MediaItem {
  id: string;
  kind: 'video' | 'image' | 'gif';
  url: string;
  fileName: string;
  mimeType: string;
  loop?: boolean;
  muted?: boolean;
  fit?: 'cover' | 'contain' | 'fill' | 'none';
  isObjectUrl?: boolean;
}

export interface SyncDebugInfo {
  mode: string;
  bufferMs: number;
  driftMs: number;
  row: number;
  starvationCount: number;

  // AUDIO-001 Enhanced diagnostics
  audioContextState: string;
  sampleRate: number;
  baseLatency: number;
  outputLatency: number;
  workletSupported: boolean;
  wasmSupported: boolean;
  driftAccumulator: number;
  lastCorrectedTime: number;
  lastWorkletUpdate: number;
  seekPending: boolean;
  bufferHealth?: number;
}

// Window extensions
declare global {
  interface Window {
    libopenmptReady: Promise<LibOpenMPT>;
    libopenmpt: LibOpenMPT;
    _libopenmptReject?: (reason: Error) => void;
    webkitAudioContext?: typeof AudioContext;
    /** Force pattern renderer backend: `webgpu` | `webgl2` | `html` */
    DEBUG_RENDERER?: 'webgpu' | 'webgl2' | 'html';
    /** Agent/CI handle — set by the active pattern renderer */
    currentPatternRenderer: import('./src/renderers/types').CurrentPatternRenderer | null;
    /** Headless Chrome / Playwright automation hooks (dev + CI) */
    __TEST_HOOKS__?: {
      seekToRow: (row: number) => void;
      isModuleLoaded: () => boolean;
      getPatternRenderer: () => import('./src/renderers/types').CurrentPatternRenderer | null;
      loadModuleFromUrl: (url: string) => Promise<void>;
      getTriggerTailStats: () => { triggers: number; sustains: number; rows: number; channels: number } | null;
      getRowNotes: (row: number) => {
        row: number;
        channels: number;
        cells: Array<{
          ch: number;
          note: number;
          inst: number;
          isTrigger: boolean;
          isSustained: boolean;
          duration: number;
          rowOffset: number;
          isNoteOff: boolean;
        }>;
      } | null;
      getPackedCell: (row: number, ch: number) => {
        row: number;
        ch: number;
        packedA: number;
        packedB: number;
        note: number;
        duration: number;
        triggerFlag: boolean;
        rowOffset: number;
        isNoteOff: boolean;
        isTrigger: boolean;
      } | null;
      getPlaybackRow: () => number;
      getActiveRenderer: () => string | null;
      getShaderFile: () => string | null;
    };
  }
}
