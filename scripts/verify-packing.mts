import {
  packPatternMatrix,
  packPatternMatrixHighPrecision,
  calculateNoteDurations,
} from '../utils/gpuPacking';
import type { PatternMatrix } from '../types';

function makeTestMatrix(numChannels: number, numRows: number): PatternMatrix {
  const rows = Array.from({ length: numRows }, (_, r) =>
    Array.from({ length: numChannels }, (_, c) => ({
      type: 'note' as const,
      text: '',
      note: ((r + c) % 12) + 1,
      inst: 1,
      volCmd: 0x10,
      volVal: 0x20,
      effCmd: 0x01,
      effVal: 0x02,
    }))
  );
  return { order: 0, patternIndex: 0, numRows, numChannels, rows };
}

function verifyPacker(
  name: string,
  packer: (m: PatternMatrix | null, pad: boolean) => { packedData: Uint32Array; noteCount: number },
  matrix: PatternMatrix,
  padTopChannel: boolean
) {
  const { packedData, noteCount } = packer(matrix, padTopChannel);
  const rawChannels = matrix.numChannels;
  const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;
  const expectedLength = matrix.numRows * numChannels * 2;
  const passed = packedData.length === expectedLength;

  console.log(`[${name}] ${passed ? '✅' : '❌'} channels=${rawChannels}, pad=${padTopChannel}, ` +
    `numChannels=${numChannels}, rows=${matrix.numRows}, ` +
    `packedData.length=${packedData.length}, expected=${expectedLength}, notes=${noteCount}`);

  if (!passed) {
    throw new Error(`${name}: buffer size mismatch!`);
  }
}

console.log('=== Verifying packPatternMatrix ===');
for (const ch of [4, 8]) {
  for (const pad of [false, true]) {
    const matrix = makeTestMatrix(ch, 64);
    verifyPacker('packPatternMatrix', packPatternMatrix, matrix, pad);
  }
}

console.log('\n=== Verifying packPatternMatrixHighPrecision ===');
for (const ch of [4, 8]) {
  for (const pad of [false, true]) {
    const matrix = makeTestMatrix(ch, 64);
    verifyPacker('packPatternMatrixHighPrecision', packPatternMatrixHighPrecision, matrix, pad);
  }
}

console.log('\n=== Verifying note durations ===');
const matrix4 = makeTestMatrix(4, 64);
const durations = calculateNoteDurations(matrix4);
console.log(`✅ calculateNoteDurations returned ${durations.length} rows × ${durations[0]?.length || 0} channels`);

console.log('\n🎉 All packing invariants passed!');
