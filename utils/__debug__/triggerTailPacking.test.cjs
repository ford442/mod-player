/**
 * TRIG-001 / DURA-001 verification: trigger flag + sustain tail packing.
 *
 * Run: node utils/__debug__/triggerTailPacking.test.cjs
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const UTILS_DIR = path.resolve(__dirname, '..');

const testScript = `
import {
  calculateNoteDurations,
  packPatternMatrixHighPrecision,
  PACKEDB_TRIGGER_FLAG,
  isTriggerFromPackedB,
} from '${UTILS_DIR}/gpuPacking.ts';

// 8-row pattern: note-on row 0, sustain rows 1-6, note-off row 7
const matrix = {
  numRows: 8,
  numChannels: 1,
  rows: [
    [{ note: 60, inst: 1, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
    [{ note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
    [{ note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
    [{ note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
    [{ note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
    [{ note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
    [{ note: 0, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
    [{ note: 120, inst: 0, volCmd: 0, volVal: 0, effCmd: 0, effVal: 0 }],
  ],
};

const durations = calculateNoteDurations(matrix);
const d0 = durations[0][0];
const d3 = durations[3][0];
const d7 = durations[7][0];

if (!d0?.isTrigger) throw new Error('row 0 should be trigger');
if (d0?.isSustained) throw new Error('row 0 should not be sustained');
if (!d3?.isSustained) throw new Error('row 3 should be sustained');
if (d3?.isTrigger) throw new Error('row 3 should not be trigger');
if (!d7?.isNoteOff) throw new Error('row 7 should be note-off');

const { packedData } = packPatternMatrixHighPrecision(matrix, false);

function readCell(row, ch) {
  const offset = (row * 1 + ch) * 2;
  return { packedA: packedData[offset], packedB: packedData[offset + 1] };
}

const triggerCell = readCell(0, 0);
const sustainCell = readCell(3, 0);

const triggerNote = (triggerCell.packedA >> 24) & 0xff;
const sustainNote = (sustainCell.packedA >> 24) & 0xff;

if (triggerNote !== 60) throw new Error(\`trigger row note expected 60, got \${triggerNote}\`);
if (sustainNote !== 60) throw new Error(\`sustain row should copy pitch (DURA-003), got \${sustainNote}\`);
if ((triggerCell.packedB & PACKEDB_TRIGGER_FLAG) === 0) {
  throw new Error('trigger row must set PACKEDB_TRIGGER_FLAG (bit 15)');
}
if ((sustainCell.packedB & PACKEDB_TRIGGER_FLAG) !== 0) {
  throw new Error('sustain row must NOT set trigger flag');
}

const durationFlags3 = (sustainCell.packedB >> 8) & 0x7f;
const rowOffset3 = durationFlags3 >> 1;
if (isTriggerFromPackedB(sustainCell.packedB, rowOffset3, false, true)) {
  throw new Error('isTriggerFromPackedB should be false on sustain row');
}
if (!isTriggerFromPackedB(triggerCell.packedB, 0, false, true)) {
  throw new Error('isTriggerFromPackedB should be true on trigger row');
}
if (isTriggerFromPackedB(0, 0, false, false)) {
  throw new Error('isTriggerFromPackedB must be false on empty cells');
}

console.log('OK: trigger row flag set, sustain tail pitch copied, duration grid correct');
`;

const tmpFile = path.join(os.tmpdir(), `trigger-tail-test-${Date.now()}.ts`);
fs.writeFileSync(tmpFile, testScript, 'utf8');

try {
  const result = spawnSync('npx', ['--yes', 'tsx', tmpFile], {
    cwd: UTILS_DIR,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) {
    const lines = result.stderr.split('\n').filter((l) =>
      !l.includes('ExperimentalWarning') && !l.includes('npm warn') && l.trim(),
    );
    if (lines.length) process.stderr.write(lines.join('\n') + '\n');
  }
  if (result.status !== 0) {
    console.error('FAILED: triggerTailPacking.test.cjs');
    process.exit(1);
  }
} finally {
  fs.unlinkSync(tmpFile);
}

console.log('triggerTailPacking.test.cjs passed');