// GPU data packing utilities for PatternDisplay.
// These functions convert tracker cell data and playback state into typed arrays
// suitable for uploading to GPU buffers.

import { ChannelShadowState, PatternMatrix } from '../types';
import { GRID_RECT } from './geometryConstants';
import type { LayoutType } from './shaderVersion';

export const DEFAULT_ROWS = 64;
export const DEFAULT_CHANNELS = 4;

const EMPTY_CHANNEL: ChannelShadowState = {
  volume: 1.0, pan: 0.5, freq: 440, trigger: 0, noteAge: 1000,
  activeEffect: 0, effectValue: 0, isMuted: 0
};

// Note constants for duration calculation (DURA-001)
const NOTE_MIN = 1;    // Minimum valid note
const NOTE_MAX = 119;  // Maximum valid note (C0–B9, covers MOD/XM/IT full range)
/** Any note value ≥ NOTE_OFF_MIN is a note-off, note-cut, or note-fade event. */
const NOTE_OFF_MIN = 120;

export const PLAYHEAD_EPSILON = 0.0001;

export const alignTo = (val: number, align: number): number =>
  Math.floor((val + align - 1) / align) * align;

export const clampPlayhead = (value: number, numRows: number): number => {
  if (numRows <= 0) return 0;
  return Math.min(Math.max(value, 0), Math.max(0, numRows - PLAYHEAD_EPSILON));
};

export const fillUniformPayload = (
  layoutType: LayoutType,
  params: {
    numRows: number;
    numChannels: number;
    playheadRow: number;
    playheadRowAsFloat?: boolean;
    isPlaying: boolean;
    cellW: number;
    cellH: number;
    canvasW: number;
    canvasH: number;
    tickOffset: number;
    bpm: number;
    timeSec: number;
    beatPhase: number;
    groove: number;
    kickTrigger: number;
    activeChannels: number[];
    isModuleLoaded: boolean;
    bloomIntensity?: number;
    bloomThreshold?: number;
    invertChannels?: boolean;
    dimFactor?: number;
    colorPalette?: number;
    analyserNode?: AnalyserNode | null;
    gridRect?: { x: number; y: number; w: number; h: number };
  },
  uint: Uint32Array,
  float: Float32Array
): number => {
  if (layoutType === 'extended') {
    uint[0] = Math.max(0, params.numRows) >>> 0;
    uint[1] = Math.max(0, params.numChannels) >>> 0;
    if (params.playheadRowAsFloat) {
      float[2] = Math.max(0, params.playheadRow);
    } else {
      uint[2] = Math.max(0, params.playheadRow) >>> 0;
    }
    uint[3] = params.isPlaying ? 1 : 0;
    float[4] = params.cellW;
    float[5] = params.cellH;
    float[6] = params.canvasW;
    float[7] = params.canvasH;
    float[8] = params.tickOffset;
    float[9] = params.bpm;
    float[10] = params.timeSec;
    float[11] = params.beatPhase;
    float[12] = params.groove;
    float[13] = params.kickTrigger;
    uint[14] = params.activeChannels.reduce((mask, ch) => mask | (1 << ch), 0) >>> 0;
    uint[15] = params.isModuleLoaded ? 1 : 0;
    float[16] = params.bloomIntensity ?? 1.0;
    float[17] = params.bloomThreshold ?? 0.8;
    uint[18] = params.invertChannels ? 1 : 0;
    float[19] = params.dimFactor ?? 1.0;
    float[20] = params.gridRect?.x ?? GRID_RECT.x;
    float[21] = params.gridRect?.y ?? GRID_RECT.y;
    float[22] = params.gridRect?.w ?? GRID_RECT.w;
    float[23] = params.gridRect?.h ?? GRID_RECT.h;
    uint[24] = Math.max(0, params.colorPalette ?? 0) >>> 0;
    return 100;
  }

  uint[0] = Math.max(0, params.numRows) >>> 0;
  uint[1] = Math.max(0, params.numChannels) >>> 0;
  if (params.playheadRowAsFloat) {
    float[2] = Math.max(0, params.playheadRow);
  } else {
    uint[2] = Math.max(0, params.playheadRow) >>> 0;
  }
  uint[3] = 0;
  float[4] = params.cellW;
  float[5] = params.cellH;
  float[6] = params.canvasW;
  float[7] = params.canvasH;
  if (layoutType === 'texture') {
    float[8] = 1; float[9] = 1; float[10] = 0; float[11] = 0; float[12] = 1; float[13] = 1;
    return 64;
  }
  return 32;
};

export const fillChannelStates = (channels: ChannelShadowState[], count: number, view: DataView, padTopChannel = false): void => {
  const startIdx = padTopChannel ? 1 : 0;

  for (let i = 0; i < count; i++) {
    const ch = channels[i] || EMPTY_CHANNEL;
    const offset = (startIdx + i) * 32;
    view.setFloat32(offset, ch.volume ?? 0, true);
    view.setFloat32(offset + 4, ch.pan ?? 0, true);
    view.setFloat32(offset + 8, ch.freq ?? 0, true);
    view.setUint32(offset + 12, (ch.trigger ?? 0) >>> 0, true);
    view.setFloat32(offset + 16, ch.noteAge ?? 0, true);
    view.setUint32(offset + 20, (ch.activeEffect ?? 0) >>> 0, true);
    view.setFloat32(offset + 24, ch.effectValue ?? 0, true);
    view.setUint32(offset + 28, (ch.isMuted ?? 0) >>> 0, true);
  }
};

// Parse helpers for text-based cells
export const parsePackedB = (text: string): number => {
  let volType = 0, volValue = 0;
  let effCode = 0, effParam = 0;
  const volMatch = text.match(/v(\d{1,3})/i);
  if (volMatch?.[1]) {
    volType = 1;
    const v = Math.min(255, Math.round((parseInt(volMatch[1], 10) / 64) * 255));
    volValue = isFinite(v) ? v : 0;
  }
  const panMatch = text.match(/p(\d{1,3})/i);
  if (panMatch?.[1]) {
    volType = 2;
    const p = Math.min(255, Math.round((parseInt(panMatch[1], 10) / 64) * 255));
    volValue = isFinite(p) ? p : 0;
  }
  const effMatch = text.match(/([A-Za-z])[ ]*([0-9A-Fa-f]{2})/);
  if (effMatch?.[1] && effMatch[2]) {
    effCode = effMatch[1].toUpperCase().charCodeAt(0) & 0xff;
    effParam = parseInt(effMatch[2], 16) & 0xff;
  } else {
    const effNum = text.match(/([0-9])[ ]*([0-9A-Fa-f]{2})/);
    if (effNum?.[1] && effNum[2]) {
      effCode = ('0'.charCodeAt(0) + (parseInt(effNum[1], 10) & 0xf)) & 0xff;
      effParam = parseInt(effNum[2], 16) & 0xff;
    }
  }
  return ((volType & 0xff) << 24) | ((volValue & 0xff) << 16) | ((effCode & 0xff) << 8) | (effParam & 0xff);
};

// Convert note text (like "C-4", "F#5") to numeric MIDI note value
export const encodeNoteText = (notePart: string): number => {
  const noteMap: Record<string, number> = {
    'C-': 1, 'C#': 2, 'DB': 2, 'D-': 3, 'D#': 4, 'EB': 4, 'E-': 5,
    'F-': 6, 'F#': 7, 'GB': 7, 'G-': 8, 'G#': 9, 'AB': 9, 'A-': 10,
    'A#': 11, 'BB': 11, 'B-': 12
  };

  if (notePart.length < 2) return 0;

  const key = notePart.slice(0, 2).toUpperCase();
  const octaveChar = notePart.charAt(2);

  if (key === 'OF' || key === '--') return 255; // Note off
  if (key === 'CU' || key === '==') return 254; // Note cut

  const noteBase = noteMap[key] || 0;
  const octave = (octaveChar >= '0' && octaveChar <= '9') ? parseInt(octaveChar, 10) : 0;

  return noteBase > 0 ? (octave + 1) * 12 + noteBase : 0;
};

export interface PackedPatternData {
  packedData: Uint32Array;
  noteCount: number;
}

/**
 * Note duration info for a single cell (DURA-001)
 */
export interface NoteDurationInfo {
  duration: number;    // Total duration in rows (1-255)
  rowOffset: number;   // Offset from note start (0 = note-on row)
  isNoteOff: boolean;  // Whether this is a note-off/cut/fade row
}
/**
 * Calculate note durations by scanning for note-off commands (DURA-001)
 * Returns a 2D array of duration info for each cell [row][channel]
 */
export const calculateNoteDurations = (
  matrix: PatternMatrix | null
): NoteDurationInfo[][] => {
  if (!matrix) return [];

  const { numRows, numChannels, rows } = matrix;

  // Initialize result
  const result: NoteDurationInfo[][] = Array.from({ length: numRows }, () =>
    Array.from({ length: numChannels }, () => ({
      duration: 1,
      rowOffset: 0,
      isNoteOff: false,
    }))
  );

  for (let ch = 0; ch < numChannels; ch++) {
    let noteStartRow = -1;

    for (let row = 0; row < numRows; row++) {
      const cell = rows[row]?.[ch];
      if (!cell) continue;

      const note = cell.note || 0;
      const hasNote = note >= NOTE_MIN && note <= NOTE_MAX;
      const isNoteOff = note >= NOTE_OFF_MIN;
      const isVolumeOff = cell.volCmd === 0xC0 && cell.volVal === 0;

      if (hasNote) {
        // New note starts → end previous note if any
        if (noteStartRow !== -1) {
          const duration = row - noteStartRow;
          for (let r = noteStartRow; r < row; r++) {
            const res = result[r]?.[ch];
            if (res) {
              res.duration = Math.min(duration, 255);
              res.rowOffset = r - noteStartRow;
              res.isNoteOff = false;
            }
          }
        }

        // Start new note
        noteStartRow = row;
        const res = result[row]?.[ch];
        if (res) {
          res.duration = 1;           // temporary
          res.rowOffset = 0;
          res.isNoteOff = false;
        }
      }
      else if (isNoteOff || isVolumeOff) {
        // Note-off / cut / fade → end current note
        if (noteStartRow !== -1) {
          const duration = row - noteStartRow + 1; // include the off row
          for (let r = noteStartRow; r <= row; r++) {
            const res = result[r]?.[ch];
            if (res) {
              res.duration = Math.min(duration, 255);
              res.rowOffset = r - noteStartRow;
              res.isNoteOff = (r === row); // only the last row is the actual off
            }
          }
          noteStartRow = -1;
        } else {
          // Standalone note-off without preceding note
          const res = result[row]?.[ch];
          if (res) {
            res.duration = 1;
            res.rowOffset = 0;
            res.isNoteOff = true;
          }
        }
      }
      // else: empty cell → continue current note (do nothing here)
    }

    // Handle notes that run until the end of the pattern
    if (noteStartRow !== -1) {
      const duration = numRows - noteStartRow;
      for (let r = noteStartRow; r < numRows; r++) {
        const res = result[r]?.[ch];
        if (res) {
          res.duration = Math.min(duration, 255);
          res.rowOffset = r - noteStartRow;
          res.isNoteOff = false;
        }
      }
    }
  }

  return result;
};

export const packPatternMatrix = (matrix: PatternMatrix | null, padTopChannel = false): PackedPatternData => {
  const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
  const numRows = matrix?.numRows ?? DEFAULT_ROWS;
  const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;
  const totalCells = numRows * numChannels;
  const packedData = new Uint32Array(totalCells * 2);

  if (!matrix) return { packedData, noteCount: 0 };

  const { rows } = matrix;
  const startCol = padTopChannel ? 1 : 0;
  let noteCount = 0;
  const maxOffset = packedData.length - 1;

  for (let r = 0; r < numRows; r++) {
    const rowCells = rows[r] || [];
    for (let c = 0; c < rawChannels; c++) {
      const offset = (r * numChannels + (c + startCol)) * 2;
      
      // BOUNDS CHECK: Prevent buffer overflow (DATA-001 fix)
      if (offset < 0 || offset + 1 > maxOffset) {
        console.warn(`[packPatternMatrix] BOUNDS VIOLATION: offset=${offset}, maxOffset=${maxOffset}, r=${r}, c=${c}, numChannels=${numChannels}`);
        continue;
      }
      
      const cell = rowCells[c];

      let note = 0, inst = 0, volCmd = 0, volVal = 0, effCmd = 0, effVal = 0;

      if (cell) {
        if (cell.note && cell.note > 0) {
          note = cell.note;
          inst = cell.inst || 0;
          volCmd = cell.volCmd || 0;
          volVal = cell.volVal || 0;
          effCmd = cell.effCmd || 0;
          effVal = cell.effVal || 0;
        } else if (cell.text && cell.text.trim()) {
          const text = cell.text.trim();
          const upper = text.toUpperCase();
          const notePart = upper.slice(0, 3).padEnd(3, '\u0000');
          const instMatch = text.match(/(\d{1,3})$/);
          inst = instMatch?.[1] ? Math.min(255, parseInt(instMatch[1], 10)) : 0;
          note = encodeNoteText(notePart);
          packedData[offset + 1] = parsePackedB(text) >>> 0;
        }
        if (note > 0) noteCount++;
      }

      packedData[offset] = ((note & 0xFF) << 24) | ((inst & 0xFF) << 16) | ((volCmd & 0xFF) << 8) | (volVal & 0xFF);
      if (!cell?.text) {
        packedData[offset + 1] = ((effCmd & 0xFF) << 8) | (effVal & 0xFF);
      }
    }
  }
  // DEV INVARIANT: packed buffer must exactly match declared dimensions
  if (import.meta.env?.DEV) {
    const allocatedCells = packedData.length / 2;
    const expectedCells = numRows * numChannels;
    if (allocatedCells !== expectedCells) {
      console.error(
        `[gpuPacking INVARIANT] packPatternMatrix: buffer size mismatch. ` +
        `allocatedCells=${allocatedCells}, expectedCells=${expectedCells} ` +
        `(${numRows} rows × ${numChannels} channels). packedData.length=${packedData.length}`
      );
    }
  }

  return { packedData, noteCount };
};

export const packPatternMatrixHighPrecision = (matrix: PatternMatrix | null, padTopChannel = false): PackedPatternData => {
  const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
  const numRows = matrix?.numRows ?? DEFAULT_ROWS;
  const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;
  const totalCells = numRows * numChannels;
  const packedData = new Uint32Array(totalCells * 2);

  if (!matrix) return { packedData, noteCount: 0 };

  const { rows } = matrix;
  const startCol = padTopChannel ? 1 : 0;

  // DURA-001: Calculate note durations for sustain visualization
  const durationInfo = calculateNoteDurations(matrix);

  let notesPacked = 0;
  let cellsWritten = 0;
  let expressionOnlyCount = 0;
  const maxOffset = packedData.length - 1;

  for (let r = 0; r < numRows; r++) {
    const rowCells = rows[r] || [];
    for (let c = 0; c < rawChannels; c++) {
      const offset = (r * numChannels + (c + startCol)) * 2;
      
      // BOUNDS CHECK: Prevent buffer overflow (DATA-001 fix)
      if (offset < 0 || offset + 1 > maxOffset) {
        console.warn(`[packPatternMatrixHighPrecision] BOUNDS VIOLATION: offset=${offset}, maxOffset=${maxOffset}, r=${r}, c=${c}, numChannels=${numChannels}`);
        continue;
      }
      
      const cell = rowCells[c];
      const dInfo = durationInfo[r]?.[c] || { duration: 1, rowOffset: 0, isNoteOff: false };
      cellsWritten++;

      let note = 0, inst = 0, volCmd = 0, volVal = 0, effCmd = 0, effVal = 0;

      if (cell) {
        if (cell.note && cell.note > 0) {
          note = cell.note;
        } else if (cell.text && cell.text.trim()) {
          const text = cell.text.trim().toUpperCase();
          note = encodeNoteText(text.slice(0, 3));
        }

        inst = cell.inst || 0;
        volCmd = cell.volCmd || 0;
        volVal = cell.volVal || 0;
        effCmd = cell.effCmd || 0;
        effVal = cell.effVal || 0;

        if (note > 0) notesPacked++;
      }

      // DURA-003: For duration tail rows, copy the note value from the note-on row
      // so shaders can identify and color sustain tail cells. This is essential for
      // strict Duration Tail visualizers (e.g., v0.45b) where every row in the sustain
      // must know which pitch it belongs to.
      if (note === 0 && dInfo.duration > 1 && dInfo.rowOffset > 0 && !dInfo.isNoteOff) {
        const startRow = r - dInfo.rowOffset;
        if (startRow >= 0) {
          const startCell = rows[startRow]?.[c];
          if (startCell && startCell.note && startCell.note >= NOTE_MIN && startCell.note <= NOTE_MAX) {
            note = startCell.note;
            if (inst === 0) inst = startCell.inst || 0;
          }
        }
      }

      // Strict expression check — mirrors patternExtractor rules.
      // hasNote covers both note-on (1–119) and note-off/cut (120+).
      const hasValidNote  = note >= NOTE_MIN && note <= NOTE_MAX;
      const hasNoteOff    = note >= NOTE_OFF_MIN;
      const hasNote       = hasValidNote || hasNoteOff;

      // Volume effect present when column cmd 2 > 0.
      // Effect present when cmd 4 > 0, or arpeggio exception: cmd 4 == 0 with non-zero param.
      const hasVolEffect  = volCmd > 0;
      const hasEffect     = effCmd > 0 || (effCmd === 0 && effVal > 0);
      const hasExpression = hasVolEffect || hasEffect;

      // Belt-and-suspenders: zero out expression fields that didn't pass strict check.
      // Catches any residual default values that weren't sanitized by patternExtractor.
      if (!hasVolEffect) { volCmd = 0; volVal = 0; }
      if (!hasEffect)    { effCmd = 0; effVal = 0; }

      // Detect expression-only steps (EXPR-001): volume/effect present but no note pitch.
      // Bit 7 of packedA (inst field) is used as the expression-only flag.
      const isExpressionOnly = !hasNote && hasExpression;
      
      if (isExpressionOnly) {
        expressionOnlyCount++;
        // Use bit 15 (0x8000) of the inst field to flag expression-only rows
        // Instrument is limited to 7 bits (0-127) in the shader when this flag is used
        inst = (inst & 0x7F) | 0x80;
      }

      // DURA-002: Pack duration data into cell structure
      // New packing scheme for high-precision mode:
      // packedA: [note:8][inst:8][duration:8][volPacked:8]
      //   - note: 8 bits (0-255, where 97=note-off)
      //   - inst: 8 bits (bit 7 is expression-only flag)
      //   - duration: 8 bits (1-255 rows)
      //   - volPacked: 4 bits volCmd + 4 bits volVal (upper nibbles)
      // packedB: [effCmd:8][effVal:8][durationFlags:7][reserved:1][volCmd:8]
      //   - effCmd: 8 bits (effect command)
      //   - effVal: 8 bits (effect value)
      //   - durationFlags: 7 bits [rowOffset:6][isNoteOff:1]
      //   - reserved: 1 bit
      //   - volCmd: 8 bits (full volume command for shader)
      
      const duration = Math.min(dInfo.duration, 255);
      const rowOffset = Math.min(dInfo.rowOffset, 63);
      const isNoteOffFlag = dInfo.isNoteOff ? 1 : 0;
      const durationFlags = (rowOffset << 1) | isNoteOffFlag;
      
      // Compress volume to fit in one byte
      const volCmdNibble = (volCmd >> 4) & 0x0F;
      const volValNibble = (volVal >> 4) & 0x0F;
      const volPacked = (volCmdNibble << 4) | volValNibble;

      packedData[offset] = ((note & 0xFF) << 24) | 
                           ((inst & 0xFF) << 16) | 
                           ((duration & 0xFF) << 8) | 
                           (volPacked & 0xFF);
      
      packedData[offset + 1] = ((effCmd & 0xFF) << 24) | 
                               ((effVal & 0xFF) << 16) | 
                               ((durationFlags & 0x7F) << 8) | 
                               (volCmd & 0xFF);
    }
  }

  // DEBUG: Log packing statistics with buffer size verification (DATA-001)
  
  // Verify consistency
  if (cellsWritten !== rawChannels * numRows) {
    console.warn(`[packPatternMatrixHighPrecision] CELL COUNT MISMATCH: expected=${rawChannels * numRows}, actual=${cellsWritten}`);
  }

  // DEV INVARIANT: packed buffer must exactly match declared dimensions
  if (import.meta.env?.DEV) {
    const allocatedCells = packedData.length / 2;
    const expectedCells = numRows * numChannels;
    if (allocatedCells !== expectedCells) {
      console.error(
        `[gpuPacking INVARIANT] packPatternMatrixHighPrecision: buffer size mismatch. ` +
        `allocatedCells=${allocatedCells}, expectedCells=${expectedCells} ` +
        `(${numRows} rows × ${numChannels} channels = ${totalCells}). packedData.length=${packedData.length}`
      );
    }
  }

  return { packedData, noteCount: notesPacked };
};

export const createBufferWithData = (device: GPUDevice, data: ArrayBufferView | ArrayBuffer, usage: GPUBufferUsageFlags): GPUBuffer => {
  const byteLength = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
  const buffer = device.createBuffer({
    size: Math.max(16, byteLength),
    usage,
    mappedAtCreation: true,
  });
  const dst = new Uint8Array(buffer.getMappedRange());
  if (data instanceof ArrayBuffer) {
    dst.set(new Uint8Array(data));
  } else {
    dst.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  buffer.unmap();
  return buffer;
};

export const buildRowFlags = (numRows: number): Uint32Array => {
  const flags = new Uint32Array(numRows);
  for (let r = 0; r < numRows; r++) {
    let f = 0;
    if (r % 4 === 0) f |= 1;
    if (r % 16 === 0) f |= 2;
    flags[r] = f;
  }
  return flags;
};
