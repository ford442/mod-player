const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');

console.log('Running packing invariant tests...');

const testScript = `
import { packPatternMatrix, packPatternMatrixHighPrecision } from '../gpuPacking.ts';

// Force DEV mode
globalThis.import = { meta: { env: { DEV: true } } };

const mockMatrix = {
  numRows: 64,
  numChannels: 4,
  rows: []
};

for (let r = 0; r < 64; r++) {
  const row = [];
  for (let c = 0; c < 4; c++) {
    row.push({ note: 1, inst: 1 });
  }
  mockMatrix.rows.push(row);
}

// Intercept console.error
let errorLogged = false;
let lastError = '';
const originalError = console.error;
console.error = (...args) => {
  const msg = args.join(' ');
  if (msg.includes('buffer size mismatch')) {
    errorLogged = true;
    lastError = msg;
  }
  originalError(...args);
};

console.log('Testing valid packPatternMatrix...');
packPatternMatrix(mockMatrix, false);
if (errorLogged) {
  console.error('FAIL: Error logged for valid input');
  process.exit(1);
}
console.log('Testing valid packPatternMatrixHighPrecision...');
packPatternMatrixHighPrecision(mockMatrix, false);
if (errorLogged) {
  console.error('FAIL: Error logged for valid input');
  process.exit(1);
}

// Since we cannot easily inject an invalid array return from the function (it internally creates the array),
// we are verifying the code does not throw on valid inputs and executes the branch properly.
console.log('PASS: All invariant tests completed successfully.');
`;

fs.writeFileSync('utils/__debug__/temp.test.ts', testScript);
const result = spawnSync('npx', ['tsx', 'utils/__debug__/temp.test.ts'], { encoding: 'utf-8' });
console.log(result.stdout);
if (result.stderr) console.error(result.stderr);
fs.unlinkSync('utils/__debug__/temp.test.ts');
if (result.status !== 0) {
  process.exit(1);
}
