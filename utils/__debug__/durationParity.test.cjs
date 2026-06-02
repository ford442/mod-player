/**
 * DURA-001 CPU-path duration parity tests.
 *
 * Validates that `calculateNoteDurations` + `packPatternMatrixHighPrecision`
 * produce byte-for-byte correct output for every edge case in the duration
 * encoding contract.  This is the reference oracle that the GPU compute path
 * (compute_note_duration.wgsl) must match.
 *
 * Run with:  node utils/__debug__/durationParity.test.cjs
 *
 * Encoding contract (documented here as authoritative cross-reference):
 * ─────────────────────────────────────────────────────────────────────
 *   packedA: [note:8 | inst:8 | duration:8 | volPacked:8]
 *     note      – 0=empty, 1–119=note-on (C-0..B-9), 120+=note-off/cut
 *     inst      – bits 6:0 = instrument number; bit 7 = expression-only flag
 *     duration  – sustain tail length in rows, 1–255 (clamped); 1 = no tail
 *     volPacked – (volCmd>>4)<<4 | (volVal>>4); upper nibbles of volume fields
 *
 *   packedB: [effCmd:8 | effVal:8 | durationFlags:7 | reserved:1 | volCmd:8]
 *     effCmd        – effect command (0 = none)
 *     effVal        – effect value  (0 = none, except arpeggio exception)
 *     durationFlags – bits [6:1] = rowOffset (0-based offset from note-on row, max 63)
 *                     bit  [0]   = isNoteOff (1 only on the note-off/cut row itself)
 *     reserved      – 0
 *     volCmd        – full 8-bit volume command (for exact vol-effect matching in shader)
 *
 * Unpacking in WGSL (patternv0.50.wgsl `unpackDurationInfo`):
 *   duration  = (packedA >>  8) & 0xFF
 *   rowOffset = (packedB >>  9) & 0x3F   // durationFlags >> 1
 *   isNoteOff = (packedB >>  8) & 0x01   // durationFlags & 1
 *   volCmd    =  packedB        & 0xFF
 */

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const UTILS_DIR = path.resolve(__dirname, '..');
let failures = 0;

function runTsx(label, script) {
  const tmpFile = path.join(os.tmpdir(), `dura-test-${Date.now()}.ts`);
  fs.writeFileSync(tmpFile, script, 'utf8');
  try {
    const result = spawnSync(
      'npx', ['--yes', 'tsx', tmpFile],
      { cwd: UTILS_DIR, encoding: 'utf8', timeout: 30000 }
    );
    if (result.stdout) process.stdout.write(result.stdout);
    const stderrLines = (result.stderr || '').split('\n')
      .filter(l => !l.includes('ExperimentalWarning') && !l.includes('npm warn') && l.trim());
    if (stderrLines.length) process.stderr.write(stderrLines.join('\n') + '\n');
    if (result.status !== 0) {
      console.error(`  FAIL: ${label}\n`);
      failures++;
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Helper: build a minimal PatternMatrix
// ---------------------------------------------------------------------------
const HELPERS = `
import { calculateNoteDurations } from '${UTILS_DIR}/gpuPacking.ts';
import { packPatternMatrixHighPrecision } from '${UTILS_DIR}/gpuPacking.ts';
import type { PatternMatrix } from '${UTILS_DIR}/../types.ts';

type CellSpec = {
  note?: number; inst?: number;
  volCmd?: number; volVal?: number;
  effCmd?: number; effVal?: number;
};

function makeMatrix(numRows: number, channelRows: CellSpec[][]): PatternMatrix {
  const numChannels = channelRows.length;
  const rows: any[][] = [];
  for (let r = 0; r < numRows; r++) {
    const row: any[] = [];
    for (let c = 0; c < numChannels; c++) {
      const spec = channelRows[c]?.[r] ?? {};
      const note = spec.note ?? 0;
      row.push({
        type: note > 0 ? 'note' : 'empty',
        text: '',
        note,
        inst:   spec.inst   ?? (note > 0 ? 1 : 0),
        volCmd: spec.volCmd ?? 0,
        volVal: spec.volVal ?? 0,
        effCmd: spec.effCmd ?? 0,
        effVal: spec.effVal ?? 0,
      });
    }
    rows.push(row);
  }
  return { order: 0, patternIndex: 0, numRows, numChannels, rows };
}

// Unpack fields from packed output for readable assertions
function unpackCell(pa: number, pb: number) {
  const note      = (pa >>> 24) & 0xFF;
  const inst      = (pa >>> 16) & 0xFF;
  const duration  = (pa >>>  8) & 0xFF;
  const volPacked =  pa         & 0xFF;
  const effCmd    = (pb >>> 24) & 0xFF;
  const effVal    = (pb >>> 16) & 0xFF;
  const durFlags  = (pb >>>  8) & 0x7F;
  const volCmd    =  pb         & 0xFF;
  const rowOffset = (durFlags >> 1) & 0x3F;
  const isNoteOff =  durFlags & 1;
  return { note, inst, duration, volPacked, effCmd, effVal, rowOffset, isNoteOff, volCmd };
}

function getCell(packed: Uint32Array, row: number, ch: number, numChannels: number) {
  const idx = (row * numChannels + ch) * 2;
  return unpackCell(packed[idx]!, packed[idx + 1]!);
}

function assertField(
  label: string, row: number, ch: number,
  field: string, got: number, expected: number
) {
  if (got !== expected) {
    console.error(\`  FAIL [\${label}] r\${row} ch\${ch} \${field}: expected \${expected}, got \${got}\`);
    process.exit(1);
  }
}
`;

// ---------------------------------------------------------------------------
// Test 1: Simple note sustaining to end of pattern
// ---------------------------------------------------------------------------
runTsx('T1: note sustains to end of pattern', HELPERS + `
// Single channel, 1 note at row 0, pattern length 8
const mat = makeMatrix(8, [[
  { note: 60 }, // row 0: C-4
  // rows 1-7: empty
  ...Array(7).fill({}),
]]);

const { packedData } = packPatternMatrixHighPrecision(mat);

// Row 0: trigger, duration=8, offset=0
let c = getCell(packedData, 0, 0, 1);
assertField('T1', 0, 0, 'duration', c.duration, 8);
assertField('T1', 0, 0, 'rowOffset', c.rowOffset, 0);
assertField('T1', 0, 0, 'isNoteOff', c.isNoteOff, 0);

// Row 4: sustain, duration=8, offset=4
c = getCell(packedData, 4, 0, 1);
assertField('T1', 4, 0, 'duration', c.duration, 8);
assertField('T1', 4, 0, 'rowOffset', c.rowOffset, 4);
assertField('T1', 4, 0, 'isNoteOff', c.isNoteOff, 0);

// Row 7: sustain, offset=7
c = getCell(packedData, 7, 0, 1);
assertField('T1', 7, 0, 'duration', c.duration, 8);
assertField('T1', 7, 0, 'rowOffset', c.rowOffset, 7);

console.log('  PASS T1: note sustains to end of pattern');
`);

// ---------------------------------------------------------------------------
// Test 2: Note cut by following note
// ---------------------------------------------------------------------------
runTsx('T2: note cut by following note', HELPERS + `
const mat = makeMatrix(8, [[
  { note: 60 }, // row 0: C-4
  {}, {}, {},
  { note: 64 }, // row 4: E-4
  {}, {}, {},
]]);

const { packedData } = packPatternMatrixHighPrecision(mat);

// First note: duration=4, rows 0-3
let c = getCell(packedData, 0, 0, 1);
assertField('T2', 0, 0, 'duration', c.duration, 4);
assertField('T2', 0, 0, 'rowOffset', c.rowOffset, 0);

c = getCell(packedData, 3, 0, 1);
assertField('T2', 3, 0, 'duration', c.duration, 4);
assertField('T2', 3, 0, 'rowOffset', c.rowOffset, 3);
assertField('T2', 3, 0, 'isNoteOff', c.isNoteOff, 0);

// Second note: duration=4 (rows 4-7), trigger row
c = getCell(packedData, 4, 0, 1);
assertField('T2', 4, 0, 'duration', c.duration, 4);
assertField('T2', 4, 0, 'rowOffset', c.rowOffset, 0);

console.log('  PASS T2: note cut by following note');
`);

// ---------------------------------------------------------------------------
// Test 3: Explicit note-off (value 255)
// ---------------------------------------------------------------------------
runTsx('T3: explicit note-off', HELPERS + `
const NOTE_OFF = 255;
const mat = makeMatrix(8, [[
  { note: 60 }, // row 0: C-4
  {}, {},
  { note: NOTE_OFF }, // row 3: note-off
  {}, {}, {}, {},
]]);

const { packedData } = packPatternMatrixHighPrecision(mat);

// rows 0-3: duration=4 (includes the off row)
let c = getCell(packedData, 0, 0, 1);
assertField('T3', 0, 0, 'duration', c.duration, 4);
assertField('T3', 0, 0, 'isNoteOff', c.isNoteOff, 0);

c = getCell(packedData, 3, 0, 1);
assertField('T3', 3, 0, 'duration', c.duration, 4);
assertField('T3', 3, 0, 'rowOffset', c.rowOffset, 3);
assertField('T3', 3, 0, 'isNoteOff', c.isNoteOff, 1); // only the off row

// rows 4+: duration=1, no sustain
c = getCell(packedData, 4, 0, 1);
assertField('T3', 4, 0, 'duration', c.duration, 1);
assertField('T3', 4, 0, 'rowOffset', c.rowOffset, 0);

console.log('  PASS T3: explicit note-off');
`);

// ---------------------------------------------------------------------------
// Test 4: ECx effect on a separate row terminates the note
// ---------------------------------------------------------------------------
runTsx('T4: ECx terminates note', HELPERS + `
// Effect E (decimal 14) with upper nibble C = EC3 cut
const ECx = { effCmd: 14, effVal: 0xC3 };
const mat = makeMatrix(8, [[
  { note: 60 },  // row 0
  {}, {},
  { ...ECx },    // row 3: EC3
  {}, {}, {}, {},
]]);

const { packedData } = packPatternMatrixHighPrecision(mat);

// rows 0-3: duration=4, row 3 is noteOff (ECx is treated as a cut)
let c = getCell(packedData, 0, 0, 1);
assertField('T4', 0, 0, 'duration', c.duration, 4);

c = getCell(packedData, 3, 0, 1);
assertField('T4', 3, 0, 'duration', c.duration, 4);
assertField('T4', 3, 0, 'rowOffset', c.rowOffset, 3);
assertField('T4', 3, 0, 'isNoteOff', c.isNoteOff, 1);

c = getCell(packedData, 4, 0, 1);
assertField('T4', 4, 0, 'duration', c.duration, 1);
assertField('T4', 4, 0, 'rowOffset', c.rowOffset, 0);

console.log('  PASS T4: ECx terminates note');
`);

// ---------------------------------------------------------------------------
// Test 5: ECx on the same row as a note-on → immediate cut, no tail
// ---------------------------------------------------------------------------
runTsx('T5: ECx on note-on row = no tail', HELPERS + `
const mat = makeMatrix(8, [[
  { note: 60, effCmd: 14, effVal: 0xC2 }, // row 0: C-4 + EC2
  {}, {}, {}, {}, {}, {}, {},
]]);

const { packedData } = packPatternMatrixHighPrecision(mat);

// row 0: trigger-only, duration=1, no tail
let c = getCell(packedData, 0, 0, 1);
assertField('T5', 0, 0, 'duration', c.duration, 1);
assertField('T5', 0, 0, 'rowOffset', c.rowOffset, 0);

// row 1: empty, duration=1
c = getCell(packedData, 1, 0, 1);
assertField('T5', 1, 0, 'duration', c.duration, 1);
assertField('T5', 1, 0, 'rowOffset', c.rowOffset, 0);

console.log('  PASS T5: ECx on note-on row = no tail');
`);

// ---------------------------------------------------------------------------
// Test 6: Volume-off (volCmd=0xC0, volVal=0) terminates note
// ---------------------------------------------------------------------------
runTsx('T6: volume-off (C00) terminates note', HELPERS + `
const mat = makeMatrix(8, [[
  { note: 60 },                       // row 0
  {}, {},
  { volCmd: 0xC0, volVal: 0 },        // row 3: C00
  {}, {}, {}, {},
]]);

const { packedData } = packPatternMatrixHighPrecision(mat);

let c = getCell(packedData, 0, 0, 1);
assertField('T6', 0, 0, 'duration', c.duration, 4);

c = getCell(packedData, 3, 0, 1);
assertField('T6', 3, 0, 'isNoteOff', c.isNoteOff, 1);

c = getCell(packedData, 4, 0, 1);
assertField('T6', 4, 0, 'duration', c.duration, 1);

console.log('  PASS T6: volume-off (C00) terminates note');
`);

// ---------------------------------------------------------------------------
// Test 7: Standalone note-off without a preceding note
// ---------------------------------------------------------------------------
runTsx('T7: standalone note-off', HELPERS + `
const mat = makeMatrix(8, [[
  {}, {}, {},
  { note: 255 }, // row 3: note-off with no open note
  {}, {}, {}, {},
]]);

const { packedData } = packPatternMatrixHighPrecision(mat);

// row 3 should be marked as isNoteOff, duration=1
let c = getCell(packedData, 3, 0, 1);
assertField('T7', 3, 0, 'isNoteOff', c.isNoteOff, 1);
assertField('T7', 3, 0, 'duration',  c.duration,  1);
assertField('T7', 3, 0, 'rowOffset', c.rowOffset, 0);

console.log('  PASS T7: standalone note-off');
`);

// ---------------------------------------------------------------------------
// Test 8: Short pattern (numRows < 64) — duration must not exceed numRows
// ---------------------------------------------------------------------------
runTsx('T8: short pattern, duration clamped to pattern length', HELPERS + `
const mat = makeMatrix(16, [[
  { note: 60 }, // row 0: sustains to end
  ...Array(15).fill({}),
]]);

const { packedData } = packPatternMatrixHighPrecision(mat);

let c = getCell(packedData, 0, 0, 1);
assertField('T8', 0, 0, 'duration', c.duration, 16);

c = getCell(packedData, 15, 0, 1);
assertField('T8', 15, 0, 'rowOffset', c.rowOffset, 15);
assertField('T8', 15, 0, 'duration',  c.duration,  16);

console.log('  PASS T8: short pattern duration clamped to numRows');
`);

// ---------------------------------------------------------------------------
// Test 9: Long sustain clamped to 255 rows
// ---------------------------------------------------------------------------
runTsx('T9: sustain duration clamped to 255', HELPERS + `
// 300-row pattern with a note at row 0
const NUM_ROWS = 300;
const channelRows = [{ note: 60 }, ...Array(NUM_ROWS - 1).fill({})];
const mat = makeMatrix(NUM_ROWS, [channelRows]);

const { packedData } = packPatternMatrixHighPrecision(mat);

// duration must be clamped to 255 even though actual length is 300
let c = getCell(packedData, 0, 0, 1);
assertField('T9', 0, 0, 'duration', c.duration, 255);

// row 63: offset clamped to 63
c = getCell(packedData, 63, 0, 1);
assertField('T9', 63, 0, 'rowOffset', c.rowOffset, 63);

// row 100: offset clamped to 63
c = getCell(packedData, 100, 0, 1);
assertField('T9', 100, 0, 'rowOffset', c.rowOffset, 63);

console.log('  PASS T9: sustain duration clamped to 255, offset clamped to 63');
`);

// ---------------------------------------------------------------------------
// Test 10: Multi-channel — channels are independent
// ---------------------------------------------------------------------------
runTsx('T10: multi-channel independence', HELPERS + `
// ch0: note at row 0–3; ch1: note at row 2–5
const NUM_ROWS = 8;
const ch0Rows = [{ note: 60 }, {}, {}, {}, { note: 62 }, {}, {}, {}]; // note at 0, 4
const ch1Rows = [{}, {}, { note: 64 }, {}, {}, {}, {}, {}];           // note at 2, sustains to end

const mat = makeMatrix(NUM_ROWS, [ch0Rows, ch1Rows]);
const { packedData } = packPatternMatrixHighPrecision(mat);

// ch0 row 0: duration=4
let c = getCell(packedData, 0, 0, 2);
assertField('T10', 0, 0, 'duration', c.duration, 4);

// ch0 row 3: last sustain of first note
c = getCell(packedData, 3, 0, 2);
assertField('T10', 3, 0, 'rowOffset', c.rowOffset, 3);

// ch1 row 2: note on, duration=6 (rows 2-7)
c = getCell(packedData, 2, 1, 2);
assertField('T10', 2, 1, 'duration', c.duration, 6);
assertField('T10', 2, 1, 'rowOffset', c.rowOffset, 0);

// ch1 row 5: sustain, offset=3
c = getCell(packedData, 5, 1, 2);
assertField('T10', 5, 1, 'rowOffset', c.rowOffset, 3);

console.log('  PASS T10: multi-channel independence');
`);

// ---------------------------------------------------------------------------
// Test 11: DURA-003 — sustain tail rows copy note pitch from trigger row
// ---------------------------------------------------------------------------
runTsx('T11: DURA-003 note pitch propagated to sustain tail', HELPERS + `
const mat = makeMatrix(4, [[
  { note: 60, inst: 5 }, // row 0: C-4 with inst 5
  {}, {}, {},
]]);

const { packedData } = packPatternMatrixHighPrecision(mat);

// row 0: trigger — note must be present
let c = getCell(packedData, 0, 0, 1);
assertField('T11', 0, 0, 'note', c.note, 60);

// row 1: sustain tail — note and inst must be copied from row 0
c = getCell(packedData, 1, 0, 1);
assertField('T11', 1, 0, 'note', c.note, 60);

// row 2: sustain tail
c = getCell(packedData, 2, 0, 1);
assertField('T11', 2, 0, 'note', c.note, 60);

console.log('  PASS T11: DURA-003 pitch copied to sustain tail rows');
`);

// ---------------------------------------------------------------------------
// Test 12: Expression-only cell — no note, has effect → inst bit 7 set
// ---------------------------------------------------------------------------
runTsx('T12: expression-only flag', HELPERS + `
const mat = makeMatrix(4, [[
  { effCmd: 4, effVal: 0x50 }, // row 0: vibrato, no note
  {}, {}, {},
]]);

const { packedData } = packPatternMatrixHighPrecision(mat);

let c = getCell(packedData, 0, 0, 1);
// inst bit 7 must be set
if ((c.inst & 0x80) === 0) {
  console.error('  FAIL T12: expression-only flag (inst bit 7) not set, inst=' + c.inst);
  process.exit(1);
}
// No sustain tail (duration=1)
assertField('T12', 0, 0, 'duration', c.duration, 1);

console.log('  PASS T12: expression-only inst bit 7 set');
`);

// ---------------------------------------------------------------------------
// Test 13: padTopChannel — channel data shifted one column right
// ---------------------------------------------------------------------------
runTsx('T13: padTopChannel inserts empty channel 0', HELPERS + `
const mat = makeMatrix(4, [[
  { note: 60 }, {}, {}, {},
]]);

const { packedData: unpadded } = packPatternMatrixHighPrecision(mat, false);
const { packedData: padded   } = packPatternMatrixHighPrecision(mat, true);

// padded has 2 channels, unpadded has 1
// channel 0 of padded should be all zeros (empty padding column)
for (let r = 0; r < 4; r++) {
  const idx = (r * 2 + 0) * 2; // ch 0 in 2-channel layout
  if (padded[idx] !== 0 || padded[idx + 1] !== 0) {
    console.error(\`  FAIL T13: padding column not zero at row \${r}\`);
    process.exit(1);
  }
}
// channel 1 of padded should match channel 0 of unpadded
for (let r = 0; r < 4; r++) {
  const paddedIdx   = (r * 2 + 1) * 2;
  const unpaddedIdx = (r * 1 + 0) * 2;
  if (padded[paddedIdx] !== unpadded[unpaddedIdx] || padded[paddedIdx + 1] !== unpadded[unpaddedIdx + 1]) {
    console.error(\`  FAIL T13: padded ch1 != unpadded ch0 at row \${r}\`);
    process.exit(1);
  }
}
console.log('  PASS T13: padTopChannel shifts data to column 1');
`);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll duration parity tests passed.');
