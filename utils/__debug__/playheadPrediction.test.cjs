/**
 * Node smoke test for playhead prediction helpers.
 * Run: node utils/__debug__/playheadPrediction.test.cjs
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
} from '${UTILS_DIR}/playheadPrediction.ts';

const errors: string[] = [];

const sample = {
  order: 0,
  row: 10,
  positionSeconds: 5.0,
  workletTime: 100.0,
  bpm: 120,
  speed: 6,
};

const predicted = predictPlayheadFromSample(sample, 100.05, 8);
if (Math.abs(predicted.playheadRow - 10.4) > 0.001) {
  errors.push(\`expected row 10.4, got \${predicted.playheadRow}\`);
}

const prev = { ...sample, row: 8, positionSeconds: 4.75, workletTime: 99.75 };
const rps = updateRowsPerSecondEstimate(prev, sample, 64, rowsPerSecondFromBpm(120));
if (rps < 4 || rps > 12) {
  errors.push(\`unexpected rows/sec estimate: \${rps}\`);
}

const fakeCtx = { currentTime: 10, baseLatency: 0.01, outputLatency: 0.02 } as AudioContext;
const heard = getAudioHeardTime(fakeCtx);
if (Math.abs(heard - 9.97) > 0.0001) {
  errors.push(\`heard time expected 9.97, got \${heard}\`);
}

if (errors.length) {
  console.error('playheadPrediction FAILURES:');
  errors.forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log('playheadPrediction: OK');
`, 'utf8');

const result = spawnSync('npx', ['--yes', 'tsx', tmpFile], { cwd: UTILS_DIR, encoding: 'utf8', timeout: 30000 });
try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
