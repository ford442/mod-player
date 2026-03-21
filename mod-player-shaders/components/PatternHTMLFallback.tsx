// components/PatternHTMLFallback.tsx
// HTML fallback pattern renderer for non-WebGPU browsers

import React, { useEffect, useRef, useCallback } from 'react';
import { PatternMatrix, ChannelShadowState } from '../types';

interface PatternHTMLFallbackProps {
  matrix: PatternMatrix | null;
  playheadRow: number;
  cellWidth?: number;
  cellHeight?: number;
  channels?: ChannelShadowState[];
  isPlaying?: boolean;
}

const DEFAULT_ROWS = 64;
const DEFAULT_CHANNELS = 4;

/**
 * Parse a tracker note value to display string
 */
const parseNote = (noteVal: number | undefined): string => {
  if (!noteVal || noteVal === 0) return '...';
  
  const notes = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
  const octave = Math.floor((noteVal - 1) / 12);
  const note = (noteVal - 1) % 12;
  return `${notes[note]}${octave}`;
};

/**
 * Parse effect command to display string
 */
const parseEffect = (effCmd: number | undefined, effVal: number | undefined): string => {
  if (!effCmd || effCmd === 0) return '';
  const cmd = String.fromCharCode(effCmd);
  const val = (effVal ?? 0).toString(16).padStart(2, '0').toUpperCase();
  return `${cmd}${val}`;
};

export const PatternHTMLFallback: React.FC<PatternHTMLFallbackProps> = ({
  matrix,
  playheadRow,
  cellWidth = 120,
  cellHeight = 24,
  channels = [],
  isPlaying = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const numRows = matrix?.numRows ?? DEFAULT_ROWS;
  const numChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
  const rows = matrix?.rows ?? [];

  // Scroll to keep playhead visible
  useEffect(() => {
    if (!containerRef.current || !isPlaying) return;
    
    const rowElement = containerRef.current.querySelector(`[data-row="${Math.floor(playheadRow)}"]`);
    if (rowElement) {
      rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [playheadRow, isPlaying]);

  const handleCellClick = useCallback((row: number, channel: number) => {
    console.log(`Clicked cell: row ${row}, channel ${channel}`);
  }, []);

  return (
    <div
      ref={containerRef}
      className="pattern-html-fallback"
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        backgroundColor: '#0a0a0c',
        fontFamily: 'monospace',
        fontSize: '12px',
        lineHeight: `${cellHeight}px`,
      }}
    >
      <div
        className="pattern-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: `40px repeat(${numChannels}, ${cellWidth}px)`,
          gap: '1px',
          backgroundColor: '#1a1a1c',
          padding: '4px',
        }}
      >
        {/* Header */}
        <div className="header-cell" style={{ color: '#888', textAlign: 'center' }}>#</div>
        {Array.from({ length: numChannels }, (_, i) => (
          <div
            key={`ch-${i}`}
            className="header-cell"
            style={{
              color: '#888',
              textAlign: 'center',
              backgroundColor: '#151517',
              borderBottom: '2px solid #333'
            }}
          >
            CH{i + 1}
          </div>
        ))}

        {/* Rows */}
        {Array.from({ length: numRows }, (__, rowIdx) => {
          const isPlayheadRow = Math.floor(playheadRow) === rowIdx;
          const rowCells = rows[rowIdx] || [];
          
          return (
            <React.Fragment key={rowIdx}>
              {/* Row number */}
              <div
                data-row={rowIdx}
                className={`row-number ${isPlayheadRow ? 'playhead' : ''}`}
                style={{
                  color: isPlayheadRow ? '#0f0' : rowIdx % 4 === 0 ? '#aaa' : '#666',
                  textAlign: 'right',
                  paddingRight: '8px',
                  backgroundColor: isPlayheadRow ? '#1a3a1a' : 'transparent',
                }}
              >
                {rowIdx.toString(16).padStart(2, '0').toUpperCase()}
              </div>

              {/* Channel cells */}
              {Array.from({ length: numChannels }, (_, chIdx) => {
                const cell = rowCells[chIdx];
                const channel = channels[chIdx];
                const hasNote = cell?.note && cell.note > 0;
                const isMuted = channel?.isMuted;

                return (
                  <div
                    key={`${rowIdx}-${chIdx}`}
                    className="pattern-cell"
                    onClick={() => handleCellClick(rowIdx, chIdx)}
                    style={{
                      width: cellWidth,
                      height: cellHeight,
                      backgroundColor: isPlayheadRow ? '#1a2a2a' : '#111113',
                      color: hasNote ? (isMuted ? '#633' : '#4f4') : '#444',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0 4px',
                      cursor: 'pointer',
                      opacity: isMuted ? 0.5 : 1,
                    }}
                  >
                    <span className="note">{parseNote(cell?.note)}</span>
                    <span className="inst" style={{ color: '#88a' }}>
                      {cell?.inst ? cell.inst.toString(16).padStart(2, '0').toUpperCase() : '..'}
                    </span>
                    <span className="effect" style={{ color: '#a8a' }}>
                      {parseEffect(cell?.effCmd, cell?.effVal)}
                    </span>
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default PatternHTMLFallback;
