import { useEffect, useCallback, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { usePatternEdit } from '../hooks/usePatternEdit';
import { patchFromFieldCycle, type PatternEditField } from '../utils/patternEdit';
import { downloadPatternDump } from '../utils/patternDump';
import type { PatternMatrix } from '../types';

export interface UseAppPatternEditParams {
  sequencerMatrix: PatternMatrix | null;
  replacePatternMatrix: (matrix: PatternMatrix) => void;
  patternModuleKey: string | null;
  isExporting: boolean;
  moduleFileName: string;
  currentModuleFileName: string;
  editMode: boolean;
  patternEditDirtyRef: MutableRefObject<boolean>;
}

export function useAppPatternEdit(params: UseAppPatternEditParams) {
  const {
    sequencerMatrix,
    replacePatternMatrix,
    patternModuleKey,
    isExporting,
    moduleFileName,
    currentModuleFileName,
    editMode,
    patternEditDirtyRef,
  } = params;

  const patternEdit = usePatternEdit({
    matrix: sequencerMatrix,
    onMatrixChange: replacePatternMatrix,
    moduleKey: patternModuleKey,
  });

  useEffect(() => {
    patternEditDirtyRef.current = patternEdit.isDirty;
  }, [patternEdit.isDirty, patternEditDirtyRef]);

  const handlePatternCellEdit = useCallback((row: number, channel: number, field: PatternEditField) => {
    if (!sequencerMatrix || isExporting) return;
    const cell = sequencerMatrix.rows[row]?.[channel] ?? { type: 'empty', text: '' };
    patternEdit.editCell(row, channel, patchFromFieldCycle(field, cell));
  }, [sequencerMatrix, patternEdit, isExporting]);

  const handlePatternCellPatch = useCallback((row: number, channel: number, patch: Parameters<typeof patternEdit.editCell>[2]) => {
    if (isExporting) return;
    patternEdit.editCell(row, channel, patch);
  }, [patternEdit, isExporting]);

  const handlePatternCellClear = useCallback((row: number, channel: number) => {
    if (isExporting) return;
    patternEdit.clearCell(row, channel);
  }, [patternEdit, isExporting]);

  const handleSequencerCellEdit = useCallback((row: number, channel: number) => {
    handlePatternCellEdit(row, channel, 'note');
  }, [handlePatternCellEdit]);

  const handlePatternRevert = useCallback(() => {
    if (!patternEdit.isDirty) return;
    const ok = window.confirm('Discard all pattern edits and restore the loaded pattern?');
    if (!ok) return;
    patternEdit.revertToBaseline();
  }, [patternEdit]);

  const handleExportPatternDump = useCallback(() => {
    if (!sequencerMatrix) return;
    const name = moduleFileName || currentModuleFileName;
    if (name) {
      downloadPatternDump(sequencerMatrix, { moduleFileName: name });
    } else {
      downloadPatternDump(sequencerMatrix);
    }
  }, [sequencerMatrix, moduleFileName, currentModuleFileName]);

  // Warn before refresh/close when pattern edits are unsaved
  useEffect(() => {
    if (!patternEdit.isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [patternEdit.isDirty]);

  // Edit-mode undo/redo shortcuts
  useEffect(() => {
    if (!editMode || isExporting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        patternEdit.undo();
      } else if ((event.key === 'z' && event.shiftKey) || event.key === 'y') {
        event.preventDefault();
        patternEdit.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editMode, isExporting, patternEdit.undo, patternEdit.redo]);

  return {
    patternEdit,
    handlePatternCellEdit,
    handlePatternCellPatch,
    handlePatternCellClear,
    handleSequencerCellEdit,
    handlePatternRevert,
    handleExportPatternDump,
  };
}

/** Ref kept in sync with usePatternEdit so module loads can confirm before discarding. */
export function usePatternEditDirtyRef(): MutableRefObject<boolean> {
  return useRef(false);
}
