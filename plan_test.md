# Plan

I need to refactor the logic in `hooks/useLibOpenMPT.ts` so that `patternMatricesRef.current` is not eagerly populated with all matrices when the module is loaded.
Instead, it should be populated on-demand (lazy-loaded).
Since `patternMatricesRef` is used to get total rows, global row index, etc., I need to be careful.

Wait, `getPatternMatrix` calls multiple C methods per row, per channel to get the cell details. For a module with many patterns and rows, this can block the UI for a long time.
Currently:
```ts
    const matrices: PatternMatrix[] = [];
    let totalRows = 0;
    for (let i = 0; i < numOrders; i++) {
      const patIdx = lib._openmpt_module_get_order_pattern(modPtr, i);
      const matrix = getPatternMatrix(lib, modPtr, patIdx, i);
      matrices.push(matrix);
      totalRows += matrix.numRows;
    }
```

By removing the eager load, I should still calculate `totalRows` by querying just the row counts without building the whole `PatternMatrix`:
```ts
    let totalRows = 0;
    for (let i = 0; i < numOrders; i++) {
      const patIdx = lib._openmpt_module_get_order_pattern(modPtr, i);
      const rows = lib._openmpt_module_get_pattern_num_rows(modPtr, patIdx);
      totalRows += rows;
    }
    setTotalPatternRows(totalRows);
```

Then in `updateUI` or whenever the `order` changes, we check if `patternMatricesRef.current[order]` is loaded. If not, we load it.

Wait, the prompt says: "Lazy-loading matrices when orders change avoids blocking the UI thread, but requires modifying state management."

Let's test this in `useLibOpenMPT.ts`.
