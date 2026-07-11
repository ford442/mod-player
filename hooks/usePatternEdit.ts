import { useCallback, useEffect, useRef, useState } from 'react';
import type { PatternMatrix } from '../types';
import {
  applyCellPatch,
  clonePatternMatrix,
  MAX_UNDO_STEPS,
  matricesEqual,
  type PatternCellPatch,
} from '../utils/patternEdit';

export interface UsePatternEditOptions {
  matrix: PatternMatrix | null;
  onMatrixChange: (matrix: PatternMatrix) => void;
  onReset?: () => void;
}

export function usePatternEdit({ matrix, onMatrixChange, onReset }: UsePatternEditOptions) {
  const [editMode, setEditMode] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const pastRef = useRef<PatternMatrix[]>([]);
  const futureRef = useRef<PatternMatrix[]>([]);
  const baselineRef = useRef<PatternMatrix | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  const resetHistory = useCallback((nextBaseline: PatternMatrix | null) => {
    pastRef.current = [];
    futureRef.current = [];
    baselineRef.current = nextBaseline ? clonePatternMatrix(nextBaseline) : null;
    setIsDirty(false);
    syncHistoryFlags();
    onReset?.();
  }, [onReset, syncHistoryFlags]);

  useEffect(() => {
    if (!matrix) {
      resetHistory(null);
      return;
    }
    if (!baselineRef.current || !matricesEqual(baselineRef.current, matrix)) {
      // Fresh module load — treat as clean baseline
      if (!isDirty) {
        resetHistory(matrix);
      }
    }
  }, [matrix, isDirty, resetHistory]);

  const pushUndoSnapshot = useCallback((snapshot: PatternMatrix) => {
    pastRef.current = [...pastRef.current, clonePatternMatrix(snapshot)].slice(-MAX_UNDO_STEPS);
    futureRef.current = [];
    syncHistoryFlags();
  }, [syncHistoryFlags]);

  const editCell = useCallback((row: number, channel: number, patch: PatternCellPatch) => {
    if (!matrix || !editMode) return;
    pushUndoSnapshot(matrix);
    const next = applyCellPatch(matrix, row, channel, patch);
    onMatrixChange(next);
    setIsDirty(true);
  }, [matrix, editMode, onMatrixChange, pushUndoSnapshot]);

  const updateCell = useCallback((row: number, channel: number, patch: PatternCellPatch) => {
    editCell(row, channel, patch);
  }, [editCell]);

  const clearCell = useCallback((row: number, channel: number) => {
    updateCell(row, channel, { clear: true });
  }, [updateCell]);

  const undo = useCallback(() => {
    if (!matrix || pastRef.current.length === 0) return;
    const previous = pastRef.current[pastRef.current.length - 1];
    if (!previous) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [clonePatternMatrix(matrix), ...futureRef.current].slice(0, MAX_UNDO_STEPS);
    onMatrixChange(clonePatternMatrix(previous));
    setIsDirty(!matricesEqual(previous, baselineRef.current));
    syncHistoryFlags();
  }, [matrix, onMatrixChange, syncHistoryFlags]);

  const redo = useCallback(() => {
    if (!matrix || futureRef.current.length === 0) return;
    const next = futureRef.current[0];
    if (!next) return;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, clonePatternMatrix(matrix)].slice(-MAX_UNDO_STEPS);
    onMatrixChange(clonePatternMatrix(next));
    setIsDirty(!matricesEqual(next, baselineRef.current));
    syncHistoryFlags();
  }, [matrix, onMatrixChange, syncHistoryFlags]);

  const toggleEditMode = useCallback(() => {
    setEditMode((prev) => !prev);
  }, []);

  return {
    editMode,
    setEditMode,
    toggleEditMode,
    isDirty,
    canUndo,
    canRedo,
    editCell,
    updateCell,
    clearCell,
    undo,
    redo,
    resetHistory,
  };
}
