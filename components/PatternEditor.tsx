import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PatternCell, PatternMatrix } from '../types';
import { scrollContainerToCenter } from '../utils/scrollContainer';
import {
  NOTE_NAMES,
  noteFromKeyboard,
  type PatternCellPatch,
  type PatternEditField,
} from '../utils/patternEdit';

interface PatternEditorProps {
  matrix: PatternMatrix | null;
  currentRow: number;
  numChannels: number;
  isPlaying: boolean;
  editMode: boolean;
  onCellEdit: (row: number, channel: number, field: PatternEditField) => void;
  onCellPatch: (row: number, channel: number, patch: PatternCellPatch) => void;
  onCellClear: (row: number, channel: number) => void;
  onSeek?: (row: number) => void;
}

const VISIBLE_ROWS = 32;
const MAX_INLINE_CHANNELS = 16;

function formatNote(cell: PatternCell): string {
  const n = cell.note;
  if (n === undefined || n === 0) return '...';
  const noteIndex = (n - 1) % 12;
  const octave = Math.floor((n - 1) / 12);
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

function formatInstrument(cell: PatternCell): string {
  const i = cell.inst;
  if (i === undefined || i === 0) return '..';
  return i.toString(16).toUpperCase().padStart(2, '0');
}

function formatVolume(cell: PatternCell): string {
  if (cell.volCmd === undefined || (cell.volCmd === 0 && (cell.volVal === undefined || cell.volVal === 0))) {
    return '..';
  }
  const val = cell.volVal ?? 0;
  return val.toString(16).toUpperCase().padStart(2, '0');
}

function formatEffect(cell: PatternCell): string {
  if (cell.effCmd === undefined || (cell.effCmd === 0 && (cell.effVal === undefined || cell.effVal === 0))) {
    return '...';
  }
  const cmd = cell.effCmd.toString(16).toUpperCase();
  const val = (cell.effVal ?? 0).toString(16).toUpperCase().padStart(2, '0');
  return `${cmd}${val}`;
}

function formatRowNumber(row: number): string {
  return row.toString(16).toUpperCase().padStart(2, '0');
}

const EMPTY_CELL: PatternCell = { type: 'empty', text: '' };

interface EditableCellProps {
  cell: PatternCell;
  field: PatternEditField;
  editMode: boolean;
  selected: boolean;
  onEdit: () => void;
}

function EditableCell({ cell, field, editMode, selected, onEdit }: EditableCellProps) {
  const text = field === 'note'
    ? formatNote(cell)
    : field === 'inst'
      ? formatInstrument(cell)
      : field === 'vol'
        ? formatVolume(cell)
        : formatEffect(cell);

  const colorClass = field === 'note'
    ? (text === '...' ? 'text-gray-600' : 'text-cyan-300')
    : field === 'inst'
      ? (text === '..' ? 'text-gray-600' : 'text-yellow-400')
      : field === 'vol'
        ? (text === '..' ? 'text-gray-600' : 'text-green-400')
        : (text === '...' ? 'text-gray-600' : 'text-purple-400');

  if (!editMode) {
    return <span className={colorClass}>{text}</span>;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
      className={`${colorClass} rounded px-0.5 hover:bg-white/10 focus:outline-none focus:ring-1 focus:ring-cyan-500 ${
        selected ? 'bg-cyan-900/50 ring-1 ring-cyan-400' : ''
      }`}
      title={`Click to edit ${field}`}
    >
      {text}
    </button>
  );
}

export const PatternEditor: React.FC<PatternEditorProps> = ({
  matrix,
  currentRow,
  numChannels,
  isPlaying,
  editMode,
  onCellEdit,
  onCellPatch,
  onCellClear,
  onSeek,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentRowRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ row: number; channel: number } | null>(null);

  const displayChannels = Math.min(numChannels, MAX_INLINE_CHANNELS);

  useEffect(() => {
    if (!isPlaying) return;
    const container = containerRef.current;
    const row = currentRowRef.current;
    if (!container || !row) return;
    scrollContainerToCenter(container, row);
  }, [currentRow, isPlaying]);

  useEffect(() => {
    if (!editMode) setSelection(null);
  }, [editMode]);

  const rowRange = useMemo(() => {
    if (!matrix) return { start: 0, end: 0 };
    const totalRows = matrix.numRows;
    const half = Math.floor(VISIBLE_ROWS / 2);
    let start = currentRow - half;
    let end = start + VISIBLE_ROWS;
    if (start < 0) { start = 0; end = Math.min(VISIBLE_ROWS, totalRows); }
    if (end > totalRows) { end = totalRows; start = Math.max(0, end - VISIBLE_ROWS); }
    return { start, end };
  }, [matrix, currentRow]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!editMode || !matrix || !selection) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    const { row, channel } = selection;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onCellClear(row, channel);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelection({ row: Math.max(0, row - 1), channel });
      onSeek?.(Math.max(0, row - 1));
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextRow = Math.min(matrix.numRows - 1, row + 1);
      setSelection({ row: nextRow, channel });
      onSeek?.(nextRow);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setSelection({ row, channel: Math.max(0, channel - 1) });
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setSelection({ row, channel: Math.min(displayChannels - 1, channel + 1) });
      return;
    }

    const note = noteFromKeyboard(event.key);
    if (note !== null) {
      event.preventDefault();
      onCellPatch(row, channel, { note });
      return;
    }
  }, [editMode, matrix, selection, displayChannels, onCellClear, onSeek, onCellPatch]);

  useEffect(() => {
    if (!editMode) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editMode, handleKeyDown]);

  if (!matrix) {
    return (
      <section className="bg-gray-900 p-4 rounded-xl text-sm text-gray-500 font-mono border border-white/5">
        No pattern data loaded.
      </section>
    );
  }

  return (
    <section className="bg-gray-900 rounded-xl border border-white/5 shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-white/5">
        <span className="text-xs text-gray-400 font-mono">
          Pattern {matrix.patternIndex.toString(16).toUpperCase().padStart(2, '0')} · Order {matrix.order}
          {editMode && <span className="ml-2 text-amber-400">EDIT</span>}
        </span>
        <span className="text-xs text-gray-500 font-mono">
          Row {formatRowNumber(currentRow)}/{formatRowNumber(matrix.numRows - 1)} · {numChannels}ch
        </span>
      </div>

      {editMode && (
        <div className="px-4 py-1.5 bg-amber-950/30 border-b border-amber-800/40 text-[10px] text-amber-200 font-mono">
          Click columns to cycle values · Arrow keys move · Delete clears · Z-M/Q-U keys place notes
        </div>
      )}

      <div className="flex items-center px-2 py-1 bg-gray-800/60 border-b border-white/5 font-mono text-[10px] text-gray-500 select-none">
        <span className="w-8 text-center shrink-0">Row</span>
        <span className="border-l border-white/5 h-4" />
        <div className="flex overflow-x-auto">
          {Array.from({ length: displayChannels }, (_, ch) => (
            <span key={ch} className="text-center shrink-0 px-1" style={{ minWidth: '10.5ch' }}>
              CH{(ch + 1).toString().padStart(2, '0')}
            </span>
          ))}
        </div>
      </div>

      <div
        ref={containerRef}
        className="overflow-y-auto overflow-x-auto font-mono text-xs leading-5 [overflow-anchor:none]"
        style={{ maxHeight: `${VISIBLE_ROWS * 1.25 + 1}rem` }}
      >
        {Array.from({ length: rowRange.end - rowRange.start }, (_, i) => {
          const rowIndex = rowRange.start + i;
          const isCurrent = rowIndex === currentRow;
          const cells = matrix.rows[rowIndex] ?? [];
          return (
            <div
              key={rowIndex}
              ref={isCurrent ? currentRowRef : undefined}
              className={
                'flex items-center px-2 transition-colors duration-75 ' +
                (isCurrent
                  ? 'bg-cyan-900/40 text-green-300'
                  : rowIndex % 4 === 0
                    ? 'bg-gray-800/30 text-gray-300'
                    : 'text-gray-400')
              }
              onClick={() => {
                if (editMode) {
                  setSelection({ row: rowIndex, channel: selection?.channel ?? 0 });
                  onSeek?.(rowIndex);
                }
              }}
            >
              <span className={`w-8 text-center shrink-0 ${isCurrent ? 'text-cyan-200 font-bold' : 'text-gray-500'}`}>
                {formatRowNumber(rowIndex)}
              </span>
              <span className="border-l border-white/5 h-5 mx-0.5" />
              <div className="flex">
                {Array.from({ length: displayChannels }, (_, ch) => {
                  const cell = cells[ch] ?? EMPTY_CELL;
                  const isSelected = selection?.row === rowIndex && selection.channel === ch;
                  return (
                    <span
                      key={ch}
                      className={`shrink-0 px-1 border-r border-white/5 last:border-r-0 inline-flex gap-1.5 ${
                        isSelected ? 'bg-cyan-900/30' : ''
                      }`}
                      style={{ minWidth: '10.5ch' }}
                      onClick={(e) => {
                        if (!editMode) return;
                        e.stopPropagation();
                        setSelection({ row: rowIndex, channel: ch });
                        onSeek?.(rowIndex);
                      }}
                    >
                      {(['note', 'inst', 'vol', 'eff'] as const).map((field) => (
                        <EditableCell
                          key={field}
                          cell={cell}
                          field={field}
                          editMode={editMode}
                          selected={isSelected}
                          onEdit={() => onCellEdit(rowIndex, ch, field)}
                        />
                      ))}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
