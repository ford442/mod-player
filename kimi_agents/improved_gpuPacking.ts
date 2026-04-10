// ============================================================================
// IMPROVED GPU DATA PACKING - Note Duration & Expression Support
// ============================================================================
// This module provides improved data packing functions that support:
// - Note duration tracking
// - Note-off flags
// - Proper expression detection
// ============================================================================

// MOD file constants
const NOTE_NONE = 0;
const NOTE_MIN = 1;
const NOTE_MAX = 96;
const NOTE_OFF = 97;   // MOD note-off
const NOTE_CUT = 98;   // MOD note-cut
const NOTE_FADE = 99;  // MOD note-fade

// Volume command constants
const VOL_CMD_SET = 0xC0;

// Effect command that acts as note-off
const EFF_CMD_DELAY = 0xED;

/**
 * Extended note cell interface with duration support
 */
export interface NoteCell {
    note: number;        // 0=none, 1-96=note, 97=note-off, 98=note-cut
    instrument: number;  // 0-255
    volumeCmd: number;   // 0-255
    volumeVal: number;   // 0-255
    effectCmd: number;   // 0-255
    effectVal: number;   // 0-255
    duration?: number;   // Note duration in rows (0-255, default: 1)
    flags?: number;      // Bit flags: noteOff, slide, arp, etc.
}

/**
 * Packed cell data structure (8 bytes per cell)
 */
export interface PackedCell {
    packedA: number;  // u32: [note:8][inst:8][volCmd:4][volVal:4][duration:8]
    packedB: number;  // u32: [effCmd:8][effVal:8][flags:8][reserved:8]
}

/**
 * Note state analysis result
 */
export interface NoteState {
    hasNote: boolean;
    isNoteOff: boolean;
    hasExpression: boolean;
    expressionOnly: boolean;
    noteWithExpression: boolean;
}

/**
 * Pack a note cell into the improved 8-byte format
 * 
 * Layout:
 * packedA: [note:8][instrument:8][volumeCmd:4][volumeVal:4][duration:8]
 * packedB: [effectCmd:8][effectVal:8][flags:8][reserved:8]
 * 
 * @param cell The note cell to pack
 * @returns Packed 8-byte representation
 */
export function packNoteCell(cell: NoteCell): PackedCell {
    // Compress volume command and value to 4 bits each
    // This gives us 16 volume commands (0xC0-0xCF) and 16 volume values (0-15)
    const volCmdCompressed = (cell.volumeCmd >> 4) & 0x0F;
    const volValCompressed = (cell.volumeVal >> 4) & 0x0F;
    
    // Duration defaults to 1 if not specified
    const duration = Math.min(cell.duration ?? 1, 255);
    
    // Build flags
    let flags = 0;
    if (cell.flags !== undefined) {
        flags = cell.flags & 0xFF;
    } else {
        // Auto-detect flags
        if (cell.note === NOTE_OFF) flags |= 0x01;  // Note-off flag
        if (cell.note === NOTE_CUT) flags |= 0x02;  // Note-cut flag
        if (cell.volumeCmd === VOL_CMD_SET && cell.volumeVal === 0) {
            flags |= 0x01;  // Volume zero = note-off
        }
    }
    
    return {
        packedA: ((cell.note & 0xFF) << 24) |
                 ((cell.instrument & 0xFF) << 16) |
                 ((volCmdCompressed & 0x0F) << 12) |
                 ((volValCompressed & 0x0F) << 8) |
                 (duration & 0xFF),
        packedB: ((cell.effectCmd & 0xFF) << 24) |
                 ((cell.effectVal & 0xFF) << 16) |
                 ((flags & 0xFF) << 8) |
                 0x00  // Reserved
    };
}

/**
 * Unpack a cell from the 8-byte format
 * 
 * @param packed The packed cell data
 * @returns Unpacked note cell
 */
export function unpackNoteCell(packed: PackedCell): NoteCell {
    const packedA = packed.packedA >>> 0;  // Convert to unsigned
    const packedB = packed.packedB >>> 0;
    
    // Extract packedA
    const note = (packedA >> 24) & 0xFF;
    const instrument = (packedA >> 16) & 0xFF;
    const volCmdCompressed = (packedA >> 12) & 0x0F;
    const volValCompressed = (packedA >> 8) & 0x0F;
    const duration = packedA & 0xFF;
    
    // Expand compressed values
    const volumeCmd = volCmdCompressed << 4;
    const volumeVal = volValCompressed << 4;
    
    // Extract packedB
    const effectCmd = (packedB >> 24) & 0xFF;
    const effectVal = (packedB >> 16) & 0xFF;
    const flags = (packedB >> 8) & 0xFF;
    
    return {
        note,
        instrument,
        volumeCmd,
        volumeVal,
        effectCmd,
        effectVal,
        duration,
        flags
    };
}

/**
 * Analyze note state for LED display logic
 * 
 * @param cell The note cell to analyze
 * @returns State analysis for LED control
 */
export function analyzeNoteState(cell: NoteCell): NoteState {
    // Valid note range (1-96)
    const hasNote = cell.note >= NOTE_MIN && cell.note <= NOTE_MAX;
    
    // Note-off detection
    const isNoteOff = cell.note === NOTE_OFF ||
                      cell.note === NOTE_CUT ||
                      cell.note === NOTE_FADE ||
                      (cell.volumeCmd === VOL_CMD_SET && cell.volumeVal === 0);
    
    // Expression detection (exclude empty commands)
    const volCmdValid = cell.volumeCmd > 0 && 
                        !(cell.volumeCmd === VOL_CMD_SET && cell.volumeVal === 0);
    const effCmdValid = cell.effectCmd > 0;
    const hasExpression = volCmdValid || effCmdValid;
    
    return {
        hasNote,
        isNoteOff,
        hasExpression,
        expressionOnly: !hasNote && hasExpression,
        noteWithExpression: hasNote && hasExpression
    };
}

/**
 * Calculate note duration by scanning forward for note-off
 * 
 * This function analyzes a pattern to determine how long each note
 * sustains before being cut off by a note-off or another note.
 * 
 * @param pattern 2D array of note cells [row][channel]
 * @returns Pattern with duration field populated
 */
export function calculateNoteDurations(pattern: NoteCell[][]): NoteCell[][] {
    const rows = pattern.length;
    if (rows === 0) return pattern;
    
    const channels = pattern[0].length;
    const result: NoteCell[][] = pattern.map(row => 
        row.map(cell => ({ ...cell, duration: 1 }))
    );
    
    // For each channel, calculate note durations
    for (let ch = 0; ch < channels; ch++) {
        let currentNoteStart = -1;
        let currentNoteRow = -1;
        
        for (let row = 0; row < rows; row++) {
            const cell = result[row][ch];
            const state = analyzeNoteState(cell);
            
            if (state.hasNote) {
                // New note - end previous note if exists
                if (currentNoteStart >= 0) {
                    const duration = row - currentNoteRow;
                    for (let r = currentNoteRow; r < row; r++) {
                        result[r][ch].duration = Math.min(duration, 255);
                    }
                }
                
                // Start new note
                currentNoteStart = row;
                currentNoteRow = row;
                result[row][ch].duration = 1;  // Will be extended
                
            } else if (state.isNoteOff || state.expressionOnly) {
                // Note-off or expression - end current note
                if (currentNoteStart >= 0) {
                    const duration = row - currentNoteRow + 1;
                    for (let r = currentNoteRow; r <= row; r++) {
                        result[r][ch].duration = Math.min(duration, 255);
                    }
                    currentNoteStart = -1;
                    currentNoteRow = -1;
                }
            }
        }
        
        // Handle notes that extend to end of pattern
        if (currentNoteStart >= 0) {
            const duration = rows - currentNoteRow;
            for (let r = currentNoteRow; r < rows; r++) {
                result[r][ch].duration = Math.min(duration, 255);
            }
        }
    }
    
    return result;
}

/**
 * Pack an entire pattern into a Uint32Array for GPU upload
 * 
 * @param pattern 2D array of note cells [row][channel]
 * @returns Flattened packed data as Uint32Array
 */
export function packPatternForGPU(pattern: NoteCell[][]): Uint32Array {
    const rows = pattern.length;
    if (rows === 0) return new Uint32Array(0);
    
    const channels = pattern[0].length;
    
    // Calculate durations first
    const patternWithDurations = calculateNoteDurations(pattern);
    
    // Create output buffer (2 u32 per cell)
    const output = new Uint32Array(rows * channels * 2);
    
    for (let row = 0; row < rows; row++) {
        for (let ch = 0; ch < channels; ch++) {
            const cell = patternWithDurations[row][ch];
            const packed = packNoteCell(cell);
            const idx = (row * channels + ch) * 2;
            
            output[idx] = packed.packedA >>> 0;
            output[idx + 1] = packed.packedB >>> 0;
        }
    }
    
    return output;
}

/**
 * Create a GPU texture from packed pattern data
 * 
 * @param device WebGPU device
 * @param pattern Packed pattern data
 * @returns GPU texture
 */
export function createPatternTexture(
    device: GPUDevice, 
    packedData: Uint32Array,
    channels: number,
    rows: number
): GPUTexture {
    const texture = device.createTexture({
        size: [channels, rows],
        format: 'rg32uint',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    
    device.queue.writeTexture(
        { texture },
        packedData,
        { bytesPerRow: channels * 8 },  // 8 bytes per cell (2 x u32)
        [channels, rows]
    );
    
    return texture;
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

/*
// Example: Create a pattern with notes and expression data
const pattern: NoteCell[][] = [
    // Row 0: C-4 with volume
    [{ note: 49, instrument: 1, volumeCmd: 0xC0, volumeVal: 64, effectCmd: 0, effectVal: 0 }],
    // Row 1: Expression only (volume slide)
    [{ note: 0, instrument: 0, volumeCmd: 0xC0, volumeVal: 48, effectCmd: 0, effectVal: 0 }],
    // Row 2: Note-off
    [{ note: 97, instrument: 0, volumeCmd: 0, volumeVal: 0, effectCmd: 0, effectVal: 0 }],
    // Row 3: Empty
    [{ note: 0, instrument: 0, volumeCmd: 0, volumeVal: 0, effectCmd: 0, effectVal: 0 }],
];

// Calculate durations and pack for GPU
const packedData = packPatternForGPU(pattern);

// Create GPU texture
const texture = createPatternTexture(device, packedData, 1, 4);
*/

// Export constants for external use
export {
    NOTE_NONE,
    NOTE_MIN,
    NOTE_MAX,
    NOTE_OFF,
    NOTE_CUT,
    NOTE_FADE,
    VOL_CMD_SET,
    EFF_CMD_DELAY
};
