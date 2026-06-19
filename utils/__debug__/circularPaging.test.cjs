/**
 * Unit test: circular overlay paging row fetch (v0.46 parity with webGLShaders.ts).
 * Run: node utils/__debug__/circularPaging.test.cjs
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const UTILS_DIR = path.resolve(__dirname, '..');
const tmpFile = path.join(os.tmpdir(), `circular-paging-test-${Date.now()}.ts`);
fs.writeFileSync(tmpFile, `
import { circularPageStart, overlayActualRow } from '${UTILS_DIR}/playheadPrediction.ts';

const errors: string[] = [];

if (circularPageStart(0, 64) !== 0) errors.push('pageStart at 0');
if (circularPageStart(63.9, 64) !== 0) errors.push('pageStart at 63.9');
if (circularPageStart(64, 64) !== 64) errors.push('pageStart at 64');
if (circularPageStart(96.5, 64) !== 64) errors.push('pageStart at 96.5');

// Page 2: step 0 should map to matrix row 64 — clamped to 63 for 64-row buffer
if (overlayActualRow(0, 64, 64) !== 63) errors.push('overlay row at playhead 64 step 0');
if (overlayActualRow(0, 0, 64) !== 0) errors.push('overlay row at playhead 0 step 0');
if (overlayActualRow(16, 64, 64) !== 63) errors.push('overlay row at playhead 64 step 16 (clamped)');

// Page 1 mid-playhead: step 32 -> row 32
if (overlayActualRow(32, 32.5, 64) !== 32) errors.push('overlay row playhead 32.5 step 32');

if (errors.length) {
  console.error('circularPaging FAILURES:');
  errors.forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log('circularPaging: OK');
`, 'utf8');

const result = spawnSync('npx', ['--yes', 'tsx', tmpFile], { cwd: UTILS_DIR, encoding: 'utf8', timeout: 30000 });
try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
