<<<<<<< SEARCH
  // DEV INVARIANT: packed buffer must exactly match declared dimensions
  if (import.meta.env?.DEV) {
    const allocatedCells = packedData.length / 2;
    const expectedCells = numRows * numChannels;
    if (allocatedCells !== expectedCells) {
      console.error(
        `[gpuPacking INVARIANT] packPatternMatrix: buffer size mismatch. ` +
        `allocatedCells=${allocatedCells}, expectedCells=${expectedCells} ` +
        `(${numRows} rows × ${numChannels} channels). packedData.length=${packedData.length}`
      );
    }
  }

  return { packedData, noteCount };
};
=======
  // DEV INVARIANT: packed buffer must exactly match declared dimensions
  if (import.meta.env?.DEV) {
    const allocatedCells = packedData.length / 2;
    const expectedCells = numRows * numChannels;
    if (allocatedCells !== expectedCells) {
      console.error(
        `[gpuPacking INVARIANT] packPatternMatrix: buffer size mismatch. ` +
        `allocatedCells=${allocatedCells}, expectedCells=${expectedCells} ` +
        `(${numRows} rows × ${numChannels} channels). packedData.length=${packedData.length}`
      );
    }
  }

  return { packedData, noteCount };
};
>>>>>>> REPLACE
