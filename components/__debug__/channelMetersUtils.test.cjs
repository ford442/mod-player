const { spawnSync } = require('child_process');
const fs = require('fs');

console.log('Running channelMetersUtils tests...');

const testScript = `
import {
  linearToDb,
  dbToNormalized,
  DB_FLOOR,
  simulatePeakDecay,
} from '../channelMetersUtils.ts';
const silentDb = linearToDb(0);
if (!Number.isFinite(silentDb)) {
  console.error('FAIL: linearToDb(0) is not finite:', silentDb);
  process.exit(1);
}
if (silentDb !== DB_FLOOR) {
  console.error('FAIL: linearToDb(0) expected', DB_FLOOR, 'got', silentDb);
  process.exit(1);
}
const silentNorm = dbToNormalized(silentDb);
if (!Number.isFinite(silentNorm) || silentNorm < 0) {
  console.error('FAIL: dbToNormalized at floor is invalid:', silentNorm);
  process.exit(1);
}
// Quiet passage still shows visible movement
const quietNorm = dbToNormalized(linearToDb(0.003));
if (quietNorm <= 0) {
  console.error('FAIL: quiet level should map above 0, got', quietNorm);
  process.exit(1);
}

// Peak-hold fall time should match across refresh rates after same wall-clock elapsed
const elapsed = 1.0; // 1 second after hold expires (hold is 800ms, level at floor)
const peak30 = simulatePeakDecay(30, elapsed);
const peak144 = simulatePeakDecay(144, elapsed);
const diff = Math.abs(peak30 - peak144);
if (diff > 0.5) {
  console.error('FAIL: peak decay mismatch 30fps vs 144fps:', peak30, peak144, 'diff', diff);
  process.exit(1);
}

console.log('All channelMetersUtils tests passed.');
`;

fs.writeFileSync('components/__debug__/temp.channelMeters.test.ts', testScript);
const result = spawnSync('npx', ['tsx', 'components/__debug__/temp.channelMeters.test.ts'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: 'pipe',
});
fs.unlinkSync('components/__debug__/temp.channelMeters.test.ts');

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  console.error('channelMetersUtils tests FAILED');
  process.exit(result.status ?? 1);
}

console.log('channelMetersUtils tests OK');
