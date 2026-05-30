// compute_note_duration.wgsl
// DURA-001 GPU compute path: reads raw-packed pattern data and writes
// high-precision packed cells with duration / sustain / expression flags.
//
// Input layout (per cell, 2 × u32):
//   packedA: [note:8][inst:8][volCmd:8][volVal:8]
//   packedB: [unused:16][effCmd:8][effVal:8]
//
// Output layout (per cell, 2 × u32) — identical to packPatternMatrixHighPrecision:
//   packedA: [note:8][inst:8][duration:8][volPacked:8]
//   packedB: [effCmd:8][effVal:8][durationFlags:7][reserved:1][volCmd:8]

struct ComputeParams {
    numRows: u32,
    numChannels: u32,
    padTopChannel: u32,
};

@group(0) @binding(0) var<storage, read> inputCells: array<u32>;
@group(0) @binding(1) var<storage, read_write> outputCells: array<u32>;
@group(0) @binding(2) var<uniform> params: ComputeParams;

// Must match gpuPacking.ts constants
const NOTE_MIN: u32       = 1u;
const NOTE_MAX: u32       = 119u;
const NOTE_OFF_MIN: u32   = 120u;
const EFFECT_E_DECIMAL: u32 = 14u;
const EFFECT_E_ASCII: u32   = 69u;
const EFFECT_E_LOWER: u32   = 101u;

// Maximum rows supported by this shader (IT format max = 1024).
// If a pattern exceeds this, the CPU fallback must be used.
const MAX_ROWS: u32 = 1024u;

fn getNote(packedA: u32) -> u32   { return (packedA >> 24u) & 0xFFu; }
fn getInst(packedA: u32) -> u32   { return (packedA >> 16u) & 0xFFu; }
fn getVolCmd(packedA: u32) -> u32 { return (packedA >> 8u) & 0xFFu; }
fn getVolVal(packedA: u32) -> u32 { return packedA & 0xFFu; }
fn getEffCmd(packedB: u32) -> u32 { return (packedB >> 8u) & 0xFFu; }
fn getEffVal(packedB: u32) -> u32 { return packedB & 0xFFu; }

fn isEffectCut(effCmd: u32, effVal: u32) -> bool {
    return (effCmd == EFFECT_E_DECIMAL || effCmd == EFFECT_E_ASCII || effCmd == EFFECT_E_LOWER)
           && (effVal & 0xF0u) == 0xC0u;
}

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let ch = gid.x;
    let numRows = params.numRows;
    let numChannels = params.numChannels;
    let padTop = params.padTopChannel != 0u;

    let rawChannels = select(numChannels, numChannels - 1u, padTop);
    if (ch >= rawChannels) { return; }

    // Column in the packed buffer (account for padding column 0)
    let srcCol = select(ch, ch + 1u, padTop);

    // Guard: pattern too large for shader arrays
    if (numRows > MAX_ROWS) { return; }

    // Per-row temporaries (sequential scan per channel)
    var durations: array<u32, 1024>;
    var rowOffsets: array<u32, 1024>;
    var noteOffFlags: array<u32, 1024>;

    // Initialize defaults
    for (var row: u32 = 0u; row < numRows; row = row + 1u) {
        durations[row] = 1u;
        rowOffsets[row] = 0u;
        noteOffFlags[row] = 0u;
    }

    // -----------------------------------------------------------------
    // Forward scan: detect note-on, note-off, volume-off, ECx cuts
    // -----------------------------------------------------------------
    var noteStartRow: i32 = -1;

    for (var row: u32 = 0u; row < numRows; row = row + 1u) {
        let idx = (row * numChannels + srcCol) * 2u;
        let pa = inputCells[idx];
        let pb = inputCells[idx + 1u];

        let note   = getNote(pa);
        let volCmd = getVolCmd(pa);
        let volVal = getVolVal(pa);
        let effCmd = getEffCmd(pb);
        let effVal = getEffVal(pb);

        let hasNote     = note >= NOTE_MIN && note <= NOTE_MAX;
        let isNoteOff   = note >= NOTE_OFF_MIN;
        let isVolumeOff = volCmd == 0xC0u && volVal == 0u;
        let effCut      = isEffectCut(effCmd, effVal);

        if (hasNote) {
            // End previous note
            if (noteStartRow >= 0) {
                let start = u32(noteStartRow);
                let dur   = min(row - start, 255u);
                for (var r = start; r < row; r = r + 1u) {
                    durations[r]    = dur;
                    rowOffsets[r]   = r - start;
                    noteOffFlags[r] = 0u;
                }
            }
            // Start new note at current row
            noteStartRow = i32(row);
            // Current row already has defaults: duration=1, offset=0, noff=0

            if (effCut) {
                // ECx on note-on row: immediate cut, no tail
                noteStartRow = -1;
            }
        } else if (isNoteOff || isVolumeOff || effCut) {
            if (noteStartRow >= 0) {
                let start = u32(noteStartRow);
                let dur   = min(row - start + 1u, 255u);
                for (var r = start; r <= row; r = r + 1u) {
                    durations[r]    = dur;
                    rowOffsets[r]   = r - start;
                    noteOffFlags[r] = select(0u, 1u, r == row);
                }
                noteStartRow = -1;
            } else {
                // Standalone note-off without preceding note
                noteOffFlags[row] = 1u;
            }
        }
        // else: empty cell while note is active — do nothing, will be filled at end or next event
    }

    // Handle notes that sustain to the end of the pattern
    if (noteStartRow >= 0) {
        let start = u32(noteStartRow);
        let dur   = min(numRows - start, 255u);
        for (var r = start; r < numRows; r = r + 1u) {
            durations[r]    = dur;
            rowOffsets[r]   = r - start;
            noteOffFlags[r] = 0u;
        }
    }

    // -----------------------------------------------------------------
    // Pack high-precision output
    // -----------------------------------------------------------------
    for (var row: u32 = 0u; row < numRows; row = row + 1u) {
        let idx = (row * numChannels + srcCol) * 2u;
        let pa = inputCells[idx];
        let pb = inputCells[idx + 1u];

        var note   = getNote(pa);
        var inst   = getInst(pa);
        let volCmd = getVolCmd(pa);
        let volVal = getVolVal(pa);
        let effCmd = getEffCmd(pb);
        let effVal = getEffVal(pb);

        // DURA-003: copy note from trigger row into sustain tail rows
        let dur    = durations[row];
        let offset = rowOffsets[row];
        let noff   = noteOffFlags[row];
        if (note == 0u && dur > 1u && offset > 0u && noff == 0u) {
            let startRow = row - offset;
            if (startRow < numRows) {
                let startIdx = (startRow * numChannels + srcCol) * 2u;
                let startNote = getNote(inputCells[startIdx]);
                let startInst = getInst(inputCells[startIdx]);
                if (startNote >= NOTE_MIN && startNote <= NOTE_MAX) {
                    note = startNote;
                    if (inst == 0u) {
                        inst = startInst;
                    }
                }
            }
        }

        // Strict expression check (mirrors packPatternMatrixHighPrecision)
        let hasValidNote = note >= NOTE_MIN && note <= NOTE_MAX;
        let hasNoteOff   = note >= NOTE_OFF_MIN;
        let hasNote      = hasValidNote || hasNoteOff;
        let hasVolEffect = volCmd > 0u;
        let hasEffect    = effCmd > 0u || (effCmd == 0u && effVal > 0u);
        let hasExpression = hasVolEffect || hasEffect;

        var outVolCmd = volCmd;
        var outVolVal = volVal;
        var outEffCmd = effCmd;
        var outEffVal = effVal;
        if (!hasVolEffect) { outVolCmd = 0u; outVolVal = 0u; }
        if (!hasEffect)    { outEffCmd = 0u; outEffVal = 0u; }

        // Expression-only flag in bit 7 of inst byte
        let isExpressionOnly = !hasNote && hasExpression;
        var outInst = inst & 0x7Fu;
        if (isExpressionOnly) {
            outInst = outInst | 0x80u;
        }

        // Pack duration fields
        let duration       = min(dur, 255u);
        let rowOffset      = min(offset, 63u);
        let isNoteOffFlag  = noff;
        let durationFlags  = (rowOffset << 1u) | isNoteOffFlag;

        // Compress volume to nibbles
        let volCmdNibble = (outVolCmd >> 4u) & 0x0Fu;
        let volValNibble = (outVolVal >> 4u) & 0x0Fu;
        let volPacked    = (volCmdNibble << 4u) | volValNibble;

        let outA = ((note & 0xFFu) << 24u) |
                   ((outInst & 0xFFu) << 16u) |
                   ((duration & 0xFFu) << 8u) |
                   (volPacked & 0xFFu);

        let outB = ((outEffCmd & 0xFFu) << 24u) |
                   ((outEffVal & 0xFFu) << 16u) |
                   ((durationFlags & 0x7Fu) << 8u) |
                   (outVolCmd & 0xFFu);

        outputCells[idx]     = outA;
        outputCells[idx + 1u] = outB;
    }
}
