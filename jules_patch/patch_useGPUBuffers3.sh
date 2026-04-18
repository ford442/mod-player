<<<<<<< SEARCH
      // Always write packed data for this cell position
      packedData[offset] = ((note & 0xFF) << 24) | ((inst & 0xFF) << 16) | ((volCmd & 0xFF) << 8) | (volVal & 0xFF);
      packedData[offset + 1] = wordB;
    }
  }
  return { packedData, noteCount };
};
=======
      // Always write packed data for this cell position
      packedData[offset] = ((note & 0xFF) << 24) | ((inst & 0xFF) << 16) | ((volCmd & 0xFF) << 8) | (volVal & 0xFF);
      packedData[offset + 1] = wordB;
    }
  }

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
