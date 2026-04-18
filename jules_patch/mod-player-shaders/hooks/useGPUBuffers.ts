// hooks/useGPUBuffers.ts
// GPU buffer management (uniform, storage, packed data)

import { useRef, useCallback, useEffect } from 'react';
import { PatternMatrix, ChannelShadowState } from '../types';
import { LayoutType } from '../utils/shaderConfig';

const DEFAULT_ROWS = 64;
const DEFAULT_CHANNELS = 4;

const EMPTY_CHANNEL: ChannelShadowState = {
  volume: 1.0,
  pan: 0.5,
  freq: 440,
  trigger: 0,
  noteAge: 1000,
  activeEffect: 0,
  effectValue: 0,
  isMuted: 0
};

const alignTo = (val: number, align: number) => Math.floor((val + align - 1) / align) * align;

// Parse helpers for pattern packing
// Helper to convert note text (like "C-4", "F#5") to numeric note value
const encodeNoteText = (notePart: string): number => {
  // Note mapping: C=1, C#=2, D=3, D#=4, E=5, F=6, F#=7, G=8, G#=9, A=10, A#=11, B=12
  const noteMap: Record<string, number> = {
    'C-': 1, 'C#': 2, 'DB': 2, 'D-': 3, 'D#': 4, 'EB': 4, 'E-': 5,
    'F-': 6, 'F#': 7, 'GB': 7, 'G-': 8, 'G#': 9, 'AB': 9, 'A-': 10,
    'A#': 11, 'BB': 11, 'B-': 12
  };
  
  if (notePart.length < 2) return 0;
  
  const key = notePart.slice(0, 2).toUpperCase();
  const octaveChar = notePart.charAt(2);
  
  if (key === 'OFF' || key === '---') return 255; // Note off
  if (key === 'CUT' || key === '===') return 254; // Note cut
  
  const noteBase = noteMap[key] || 0;
  const octave = (octaveChar >= '0' && octaveChar <= '9') ? parseInt(octaveChar, 10) : 0;
  
  // Return MIDI note number (C-0 = 12, C-4 = 60, etc.)
  return noteBase > 0 ? (octave + 1) * 12 + noteBase : 0;
};

const parsePackedB = (text: string) => {
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
  
  return ((volType & 0xff) << 24) | ((volValue & 0xff) << 16) | 
         ((effCode & 0xff) << 8) | (effParam & 0xff);
};

export interface PackedPatternData {
  packedData: Uint32Array;
  noteCount: number;
}

export const packPatternMatrix = (matrix: PatternMatrix | null, padTopChannel = false): PackedPatternData => {
  const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
  const numRows = matrix?.numRows ?? DEFAULT_ROWS;
  const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;
  const packedData = new Uint32Array(numRows * numChannels * 2);

  if (!matrix) return { packedData, noteCount: 0 };

  const { rows } = matrix;
  const startCol = padTopChannel ? 1 : 0;
  let noteCount = 0;

  for (let r = 0; r < numRows; r++) {
    const rowCells = rows[r] || [];
    for (let c = 0; c < rawChannels; c++) {
      const offset = (r * numChannels + (c + startCol)) * 2;
      const cell = rowCells[c];
      
      // FIXED: Always write data for every cell position
      let note = 0;
      let inst = 0;
      let volCmd = 0;
      let volVal = 0;
      let effCmd = 0;
      let effVal = 0;
      let wordB = 0;
      
      if (cell) {
        // First try numeric fields (from getPatternMatrix)
        if (cell.note && cell.note > 0) {
          note = cell.note;
          inst = cell.inst || 0;
          volCmd = cell.volCmd || 0;
          volVal = cell.volVal || 0;
          effCmd = cell.effCmd || 0;
          effVal = cell.effVal || 0;
          wordB = ((effCmd & 0xFF) << 8) | (effVal & 0xFF);
        }
        // Fall back to parsing text if available
        else if (cell.text && cell.text.trim()) {
          const text = cell.text.trim();
          const upper = text.toUpperCase();
          const notePart = upper.slice(0, 3).padEnd(3, '\0');
          const instMatch = text.match(/(\d{1,3})$/);
          inst = instMatch?.[1] ? Math.min(255, parseInt(instMatch[1], 10)) : 0;
          note = encodeNoteText(notePart);
          wordB = parsePackedB(text) >>> 0;
        }
        if (note > 0) noteCount++;
      }
      
      // Always write packed data for this cell position
      packedData[offset] = ((note & 0xFF) << 24) | ((inst & 0xFF) << 16) | ((volCmd & 0xFF) << 8) | (volVal & 0xFF);
      packedData[offset + 1] = wordB;
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
  const packedData = new Uint32Array(numRows * numChannels * 2);

  if (!matrix) return { packedData, noteCount: 0 };

  const { rows } = matrix;
  const startCol = padTopChannel ? 1 : 0;

  // DEBUG: Track how many notes we pack
  let notesPacked = 0;
  let totalCells = 0;

  for (let r = 0; r < numRows; r++) {
    const rowCells = rows[r] || [];
    for (let c = 0; c < rawChannels; c++) {
      const offset = (r * numChannels + (c + startCol)) * 2;
      const cell = rowCells[c];
      totalCells++;
      
      // FIXED: Always write data for every cell position (don't skip null cells)
      let note = 0;
      let inst = 0;
      let volCmd = 0;
      let volVal = 0;
      let effCmd = 0;
      let effVal = 0;
      
      if (cell) {
        // Get note value - handle both numeric and text representations
        if (cell.note && cell.note > 0) {
          note = cell.note;
        } else if (cell.text && cell.text.trim()) {
          // Parse note from text (e.g., "C-4", "F#5")
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

      // ALWAYS write packed data for this cell position
      packedData[offset] = ((note & 0xFF) << 24) | ((inst & 0xFF) << 16) | ((volCmd & 0xFF) << 8) | (volVal & 0xFF);
      packedData[offset + 1] = ((effCmd & 0xFF) << 8) | (effVal & 0xFF);
    }
  }
  
  // DEBUG: Log packing statistics
  console.log(`[packPatternMatrixHighPrecision] Packed ${notesPacked} notes into ${totalCells} cells (${numRows} rows x ${numChannels} channels)`);
  
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

export const createBufferWithData = (
  device: GPUDevice,
  data: ArrayBufferView | ArrayBuffer,
  usage: GPUBufferUsageFlags
): GPUBuffer => {
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

export const fillChannelStates = (
  channels: ChannelShadowState[],
  count: number,
  view: DataView,
  padTopChannel = false
): void => {
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

export interface UseGPUBuffersOptions {
  device: GPUDevice | null;
  matrix: PatternMatrix | null;
  channels: ChannelShadowState[];
  layoutType: LayoutType;
  padTopChannel: boolean;
  isHighPrecision: boolean;
}

export interface GPUBuffers {
  cellsBuffer: GPUBuffer | null;
  uniformBuffer: GPUBuffer | null;
  rowFlagsBuffer: GPUBuffer | null;
  channelsBuffer: GPUBuffer | null;
  refreshBindGroup: () => void;
}

export function useGPUBuffers({
  device,
  matrix,
  channels,
  layoutType,
  padTopChannel,
  isHighPrecision
}: UseGPUBuffersOptions): GPUBuffers {
  const cellsBufferRef = useRef<GPUBuffer | null>(null);
  const uniformBufferRef = useRef<GPUBuffer | null>(null);
  const rowFlagsBufferRef = useRef<GPUBuffer | null>(null);
  const channelsBufferRef = useRef<GPUBuffer | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cellsBufferRef.current?.destroy();
      uniformBufferRef.current?.destroy();
      rowFlagsBufferRef.current?.destroy();
      channelsBufferRef.current?.destroy();
    };
  }, []);

  // Create/update cells buffer when matrix changes
  useEffect(() => {
    if (!device) return;

    // Destroy old buffer
    if (cellsBufferRef.current) {
      cellsBufferRef.current.destroy();
    }

    const packFunc = isHighPrecision ? packPatternMatrixHighPrecision : packPatternMatrix;
    const { packedData } = packFunc(matrix, padTopChannel);
    cellsBufferRef.current = createBufferWithData(
      device,
      packedData,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // Update row flags for extended layout
    if (layoutType === 'extended') {
      const numRows = matrix?.numRows ?? DEFAULT_ROWS;
      const flags = buildRowFlags(numRows);
      
      if (!rowFlagsBufferRef.current || rowFlagsBufferRef.current.size < flags.byteLength) {
        rowFlagsBufferRef.current?.destroy();
        rowFlagsBufferRef.current = createBufferWithData(device, flags, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      } else {
        device.queue.writeBuffer(rowFlagsBufferRef.current, 0, flags.buffer, flags.byteOffset, flags.byteLength);
      }
    }
  }, [device, matrix, layoutType, padTopChannel, isHighPrecision]);

  // Create/update channels buffer
  useEffect(() => {
    if (!device || layoutType !== 'extended') return;

    const count = Math.max(1, matrix?.numChannels ?? DEFAULT_CHANNELS);
    const totalCount = padTopChannel ? count + 1 : count;
    const requiredSize = totalCount * 32;

    const buffer = new ArrayBuffer(requiredSize);
    const view = new DataView(buffer);
    fillChannelStates(channels, count, view, padTopChannel);

    if (!channelsBufferRef.current || channelsBufferRef.current.size < requiredSize) {
      channelsBufferRef.current?.destroy();
      channelsBufferRef.current = createBufferWithData(device, buffer, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    } else {
      device.queue.writeBuffer(channelsBufferRef.current, 0, buffer, 0, requiredSize);
    }
  }, [device, channels, matrix?.numChannels, layoutType, padTopChannel]);

  // Initialize uniform buffer
  useEffect(() => {
    if (!device) return;

    const uniformSize = layoutType === 'extended' ? 96 : (layoutType === 'texture' ? 64 : 32);
    uniformBufferRef.current = device.createBuffer({
      size: alignTo(uniformSize, 256),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    return () => {
      uniformBufferRef.current?.destroy();
      uniformBufferRef.current = null;
    };
  }, [device, layoutType]);

  const refreshBindGroup = useCallback(() => {
    // This is called when bind group needs to be recreated
    // The actual bind group creation happens in the main component
  }, []);

  return {
    cellsBuffer: cellsBufferRef.current,
    uniformBuffer: uniformBufferRef.current,
    rowFlagsBuffer: rowFlagsBufferRef.current,
    channelsBuffer: channelsBufferRef.current,
    refreshBindGroup
  };
}

export default useGPUBuffers;
