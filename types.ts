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
  _openmpt_module_get_num_orders: (modPtr: number) => number;
  _openmpt_module_get_order_pattern: (modPtr: number, order: number) => number;
  _openmpt_module_get_current_estimated_bpm: (modPtr: number) => number;
  _openmpt_module_set_position_order_row: (
    modPtr: number,
    order: number,
    row: number
  ) => void;
  UTF8ToString: (ptr: number) => string;
  stringToUTF8: (str: string) => number;
  HEAPU8: Uint8Array;
}

export type AudioEngine = 'worklet' | 'native-worklet' | 'scriptprocessor';

export interface PlaybackState {
  playheadRow: number;
  currentOrder: number;
  timeSec: number;
  beatPhase: number;
  kickTrigger: number;
  grooveAmount: number;
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
    libopenmptReady: Promise<LibOpenMPT>;
    libopenmpt: LibOpenMPT;
    _libopenmptReject?: (reason: Error) => void;
    webkitAudioContext?: typeof AudioContext;
  }
}
