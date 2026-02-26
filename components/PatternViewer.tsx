import React, { useEffect, useRef, useMemo, memo, forwardRef } from 'react';
import type { PatternMatrix, PatternCell } from '../types';

interface PatternViewerProps {
  matrix: PatternMatrix | null;
  currentRow: number;
  numChannels: number;
  isPlaying: boolean;
}

const VISIBLE_ROWS = 32;
const MAX_INLINE_CHANNELS = 8;

const NOTE_NAMES = [
  'C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-',
] as const;

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
const EMPTY_ROW: PatternCell[] = [];

const PatternCellComponent = memo(({ cell }: { cell: PatternCell }) => {
  const note = formatNote(cell);
  const inst = formatInstrument(cell);
  const vol = formatVolume(cell);
  const eff = formatEffect(cell);
  return (
    <span className="inline-flex gap-1.5">
      <span className={note === '...' ? 'text-gray-600' : 'text-cyan-300'}>{note}</span>
      <span className={inst === '..' ? 'text-gray-600' : 'text-yellow-400'}>{inst}</span>
      <span className={vol === '..' ? 'text-gray-600' : 'text-green-400'}>{vol}</span>
      <span className={eff === '...' ? 'text-gray-600' : 'text-purple-400'}>{eff}</span>
    </span>
  );
});

interface PatternRowProps {
  rowIndex: number;
  cells: PatternCell[];
  isCurrent: boolean;
  displayChannels: number;
}

const PatternRow = memo(forwardRef<HTMLDivElement, PatternRowProps>(
  ({ rowIndex, cells, isCurrent, displayChannels }, ref) => {
    return (
      <div
        ref={ref}
        className={
          'flex items-center px-2 transition-colors duration-75 ' +
          (isCurrent
            ? 'bg-cyan-900/40 text-green-300'
            : rowIndex % 4 === 0
              ? 'bg-gray-800/30 text-gray-300'
              : 'text-gray-400')
        }
      >
        {/* Row number */}
        <span
          className={
            'w-8 text-center shrink-0 ' +
            (isCurrent ? 'text-cyan-200 font-bold' : 'text-gray-500')
          }
        >
          {formatRowNumber(rowIndex)}
        </span>
        <span className="border-l border-white/5 h-5 mx-0.5" />

        {/* Channel cells */}
        <div className="flex">
          {Array.from({ length: displayChannels }, (_, ch) => (
            <span
              key={ch}
              className="shrink-0 px-1 border-r border-white/5 last:border-r-0"
              style={{ minWidth: '10.5ch' }}
            >
              <PatternCellComponent cell={cells[ch] ?? EMPTY_CELL} />
            </span>
          ))}
        </div>
      </div>
    );
  }
));

export const PatternViewer: React.FC<PatternViewerProps> = ({
  matrix,
  currentRow,
  numChannels,
  isPlaying,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentRowRef = useRef<HTMLDivElement>(null);

  const displayChannels = Math.min(numChannels, MAX_INLINE_CHANNELS);

  // Auto-scroll to keep current row centered
  useEffect(() => {
    if (!isPlaying || !currentRowRef.current || !containerRef.current) return;
    currentRowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentRow, isPlaying]);

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

  if (!matrix) {
    return (
      <section className="bg-gray-900 p-4 rounded-xl text-sm text-gray-500 font-mono border border-white/5">
        No pattern data loaded.
      </section>
    );
  }

  return (
    <section className="bg-gray-900 rounded-xl border border-white/5 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-white/5">
        <span className="text-xs text-gray-400 font-mono">
          Pattern {matrix.patternIndex.toString(16).toUpperCase().padStart(2, '0')} &middot; Order {matrix.order}
        </span>
        <span className="text-xs text-gray-500 font-mono">
          Row {formatRowNumber(currentRow)}/{formatRowNumber(matrix.numRows - 1)} &middot; {numChannels}ch
        </span>
      </div>

      {/* Column headers */}
      <div className="flex items-center px-2 py-1 bg-gray-800/60 border-b border-white/5 font-mono text-[10px] text-gray-500 select-none">
        <span className="w-8 text-center shrink-0">Row</span>
        <span className="border-l border-white/5 h-4" />
        <div className="flex overflow-x-auto">
          {Array.from({ length: displayChannels }, (_, ch) => (
            <span
              key={ch}
              className="text-center shrink-0 px-1"
              style={{ minWidth: '10.5ch' }}
            >
              CH{(ch + 1).toString().padStart(2, '0')}
            </span>
          ))}
        </div>
      </div>

      {/* Pattern rows */}
      <div
        ref={containerRef}
        className="overflow-y-auto overflow-x-auto font-mono text-xs leading-5"
        style={{ maxHeight: `${VISIBLE_ROWS * 1.25 + 1}rem` }}
      >
        {Array.from({ length: rowRange.end - rowRange.start }, (_, i) => {
          const rowIndex = rowRange.start + i;
          const isCurrent = rowIndex === currentRow;
          return (
            <PatternRow
              key={rowIndex}
              ref={isCurrent ? currentRowRef : undefined}
              rowIndex={rowIndex}
              cells={matrix.rows[rowIndex] ?? EMPTY_ROW}
              isCurrent={isCurrent}
              displayChannels={displayChannels}
            />
          );
        })}
      </div>
    </section>
  );
};
