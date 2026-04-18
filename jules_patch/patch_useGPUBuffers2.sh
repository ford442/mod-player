<<<<<<< SEARCH
  // DEBUG: Log packing statistics
  console.log(`[packPatternMatrixHighPrecision] Packed ${notesPacked} notes into ${totalCells} cells (${numRows} rows x ${numChannels} channels)`);
  
  return { packedData, noteCount: notesPacked };
};
=======
  // DEBUG: Log packing statistics
  console.log(`[packPatternMatrixHighPrecision] Packed ${notesPacked} notes into ${totalCells} cells (${numRows} rows x ${numChannels} channels)`);
  
  // DEV INVARIANT: packed buffer must exactly match declared dimensions
  if (import.meta.env?.DEV) {
    const allocatedCells = packedData.length / 2;
    const expectedCells = numRows * numChannels;
    if (allocatedCells !== expectedCells) {
      console.error(
        `[gpuPacking INVARIANT] packPatternMatrixHighPrecision: buffer size mismatch. ` +
        `allocatedCells=${allocatedCells}, expectedCells=${expectedCells} ` +
        `(${numRows} rows × ${numChannels} channels = ${totalCells}). packedData.length=${packedData.length}`
      );
    }
  }

  return { packedData, noteCount: notesPacked };
};
>>>>>>> REPLACE
