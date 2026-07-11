import React, { useEffect } from 'react';
import { PatternSequencer } from '../../../components/PatternSequencer';
import type { PatternMatrix } from '../../../types';
import { setCurrentPatternRenderer } from '../global';
import type { CurrentPatternRenderer } from '../types';

interface PatternHTMLFallbackProps {
  matrix: PatternMatrix | null;
  playheadRow: number;
  totalRows?: number;
  bpm?: number;
  onSeek?: (row: number) => void;
  editMode?: boolean;
  onSequencerCellEdit?: (row: number, channel: number) => void;
}

/**
 * Lightweight DOM pattern grid — ultimate fallback when GPU backends are unavailable
 * or when `?renderer=html` is set.
 */
export const PatternHTMLFallback: React.FC<PatternHTMLFallbackProps> = ({
  matrix,
  playheadRow,
  totalRows = 0,
  bpm = 120,
  onSeek,
  editMode = false,
  onSequencerCellEdit,
}) => {
  useEffect(() => {
    const handle: CurrentPatternRenderer = {
      backend: 'html',
      readPixels: () => null,
      getCanvas: () => null,
      setDebugMode: () => {},
      getDebugMode: () => 'normal',
      setScrollSpeed: () => {},
      getScrollSpeed: () => 1,
      resize: () => {},
    };
    setCurrentPatternRenderer(handle);
    return () => setCurrentPatternRenderer(null);
  }, []);

  return (
    <div className="pattern-html-fallback w-full h-full overflow-auto [overflow-anchor:none] bg-[#0a0a0c] p-2">
      <PatternSequencer
        matrix={matrix}
        currentRow={Math.floor(playheadRow)}
        globalRow={Math.floor(playheadRow)}
        totalRows={totalRows}
        bpm={bpm}
        editMode={editMode}
        {...(onSequencerCellEdit ? { onCellEdit: onSequencerCellEdit } : {})}
        {...(onSeek ? { onSeek } : {})}
      />
    </div>
  );
};
