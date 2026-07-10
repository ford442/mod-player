/**
 * Node smoke test for playhead prediction helpers.
 * Run: node utils/__debug__/playheadPrediction.test.cjs
 *  or: npm run test:playhead
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const UTILS_DIR = path.resolve(__dirname, '..');
const tmpFile = path.join(os.tmpdir(), `playhead-test-${Date.now()}.ts`);
fs.writeFileSync(tmpFile, `
import {
  predictPlayheadFromSample,
  updateRowsPerSecondEstimate,
  rowsPerSecondFromBpm,
  getAudioHeardTime,
  fractionalRowFromTimeMarkers,
  expectedLatencyRows,
  TARGET_MAX_LAG_ROWS,
} from '${UTILS_DIR}/playheadPrediction.ts';

const errors: string[] = [];

// ── Forward prediction (message slightly behind heard time) ──────────
const sample = {
  order: 0,
  row: 10.0,
  rowInt: 10,
  positionSeconds: 5.0,
  workletTime: 100.0,
  bpm: 125,
  speed: 6,
};

const predicted = predictPlayheadFromSample(sample, 100.05, 8);
if (Math.abs(predicted.playheadRow - 10.4) > 0.001) {
  errors.push(\`forward: expected row 10.4, got \${predicted.playheadRow}\`);
}

// ── Negative dt: output latency compensation ─────────────────────────
// Sample tagged at audioTime=100; speaker-heard is 99.97 (30ms latency).
// Playhead must step *behind* the sample so visuals match the ear.
const latPredicted = predictPlayheadFromSample(sample, 99.97, 8.333);
// dt = -0.03 → row delta ≈ -0.25
if (latPredicted.dtSec >= 0) {
  errors.push(\`latency: expected negative dt, got \${latPredicted.dtSec}\`);
}
if (latPredicted.playheadRow >= sample.row) {
  errors.push(
    \`latency: expected playhead < sample.row, got \${latPredicted.playheadRow} vs \${sample.row}\`,
  );
}

// ── Budget at 125 BPM / ~30ms device latency ─────────────────────────
const lagRows = expectedLatencyRows(0.03, 125);
if (lagRows > TARGET_MAX_LAG_ROWS + 0.05) {
  // Pure device latency at 125BPM is ~0.25 rows for 30ms — well under 1 row.
  // This asserts the *measurement helper* math, not a wall-clock capture.
  errors.push(\`budget helper: unexpected lagRows=\${lagRows}\`);
}
// At 125 BPM, 1 row ≈ 120ms; 30ms latency ≈ 0.25 rows — must be < 1
if (lagRows >= 1) {
  errors.push(\`budget: 30ms at 125BPM should be < 1 row, got \${lagRows}\`);
}

// ── Rows/sec estimate ────────────────────────────────────────────────
const prev = { ...sample, row: 8, positionSeconds: 4.75, workletTime: 99.75 };
const rps = updateRowsPerSecondEstimate(prev, sample, 64, rowsPerSecondFromBpm(125));
if (rps < 4 || rps > 12) {
  errors.push(\`unexpected rows/sec estimate: \${rps}\`);
}

// ── Heard time ───────────────────────────────────────────────────────
const fakeCtx = { currentTime: 10, baseLatency: 0.01, outputLatency: 0.02 } as AudioContext;
const heard = getAudioHeardTime(fakeCtx);
if (Math.abs(heard - 9.97) > 0.0001) {
  errors.push(\`heard time expected 9.97, got \${heard}\`);
}

// ── Fractional row from time markers ─────────────────────────────────
const frac = fractionalRowFromTimeMarkers(12, 5.05, 5.0, 5.1);
if (Math.abs(frac - 12.5) > 0.001) {
  errors.push(\`fractionalRow expected 12.5, got \${frac}\`);
}

// ── 125 BPM / speed 6: one-row duration and prediction horizon ───────
const rps125 = rowsPerSecondFromBpm(125);
const rowSec = 1 / rps125;
// After 1 quantum (~2.9ms @ 128/44100) prediction step must stay << 1 row
const quantum = 128 / 44100;
const step = quantum * rps125;
if (step > 0.1) {
  errors.push(\`quantum step too large: \${step} rows (expected << 1)\`);
}
if (rowSec < 0.05 || rowSec > 0.2) {
  errors.push(\`row duration at 125BPM unexpected: \${rowSec}s\`);
}

if (errors.length) {
  console.error('playheadPrediction FAILURES:');
  errors.forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log('playheadPrediction: OK');
console.log('  rps@125BPM=', rps125.toFixed(3), 'rowSec=', rowSec.toFixed(4),
  '30msLagRows=', lagRows.toFixed(3), 'quantumStep=', step.toFixed(4));
`, 'utf8');

const result = spawnSync('npx', ['--yes', 'tsx', tmpFile], {
  cwd: UTILS_DIR,
  encoding: 'utf8',
  timeout: 60000,
});
try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
