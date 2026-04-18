<<<<<<< SEARCH
      cellsBufferRef.current = createBufferWithData(
        device,
        packedData,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      );
=======
      cellsBufferRef.current = createBufferWithData(
        device,
        packedData,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      );

      // DEV INVARIANT: GPU buffer size must match packed data size
      if (import.meta.env?.DEV && cellsBufferRef.current) {
        if (cellsBufferRef.current.size !== packedData.byteLength) {
          const numRows = matrix?.numRows ?? DEFAULT_ROWS;
          const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
          const numChannels = padTopChannel ? rawChannels + 1 : rawChannels;
          console.error(
            `[useGPUBuffers INVARIANT] cells buffer size mismatch. ` +
            `bufferSize=${cellsBufferRef.current.size}, packedDataByteLength=${packedData.byteLength}, ` +
            `actualCells=${packedData.length / 2}, expectedCells=${numRows * numChannels}`
          );
        }
      }
>>>>>>> REPLACE
