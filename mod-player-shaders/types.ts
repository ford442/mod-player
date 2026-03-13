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

/**
 * Channel shadow state - real-time channel properties for visualization
 * 
 * activeEffect field uses standardized effect IDs (0-15):
 * 0 = None
 * 1 = Vibrato, 2 = Portamento, 3 = Tremolo
 * 4 = Arpeggio, 5 = Retrigger
 * 6 = Portamento Up, 7 = Portamento Down
 * 8 = Volume Slide, 9 = Set Panning
 * 10 = Sample Offset, 11 = Set Speed/BPM
 * 12 = Note Cut, 13 = Note Delay
 * 14 = Panning Slide, 15 = Global Volume Slide
 * 
 * See utils/effectCodes.ts for full documentation and color mappings
 */
export interface ChannelShadowState {
  volume: number;
  pan: number;
  freq: number;
  trigger: number;
  noteAge: number;
  activeEffect: number;  // 0-15, see effect ID reference above
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
  numSamples: number;
  durationSeconds: number;
  currentBpm: number;
  instruments: string[];
  samples: string[];
  format: string;
  comments: string;
  orderList: number[];
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
  _openmpt_module_get_num_instruments: (modPtr: number) => number;
  _openmpt_module_get_instrument_name: (modPtr: number, index: number) => number;
  _openmpt_module_get_num_samples: (modPtr: number) => number;
  _openmpt_module_get_sample_name: (modPtr: number, index: number) => number;
  _openmpt_module_get_order_pattern: (modPtr: number, order: number) => number;
  _openmpt_module_get_current_estimated_bpm: (modPtr: number) => number;
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
  _openmpt_module_set_channel_mute: (
    modPtr: number,
    channel: number,
    mute: number
  ) => void;
  UTF8ToString: (ptr: number) => string;
  stringToUTF8: (str: string) => number;
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
}

export type AudioEngine = 'worklet' | 'native-worklet' | 'scriptprocessor';

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
}

// Window extensions
declare global {
  interface Window {


    _libopenmptReject?: (reason: Error) => void;
    webkitAudioContext?: typeof AudioContext;
  }
}
