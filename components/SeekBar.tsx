import { useCallback, useRef, useState } from 'react';

interface SeekBarProps {
  currentSeconds: number;
  durationSeconds: number;
  currentRow: number;
  totalRows: number;
  isPlaying: boolean;
  onSeekRow: (row: number) => void;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export const SeekBar: React.FC<SeekBarProps> = ({
  currentSeconds,
  durationSeconds,
  currentRow,
  totalRows,
  isPlaying,
  onSeekRow,
}) => {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverPct, setHoverPct] = useState<number | null>(null);

  const pct = durationSeconds > 0 ? (currentSeconds / durationSeconds) * 100 : 0;
  const rowPct = totalRows > 0 ? (currentRow / totalRows) * 100 : 0;

  const getPositionFromEvent = useCallback((clientX: number) => {
    if (!barRef.current || totalRows <= 0) return 0;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * totalRows);
  }, [totalRows]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    const row = getPositionFromEvent(e.clientX);
    onSeekRow(row);
  }, [getPositionFromEvent, onSeekRow]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPct(ratio * 100);
    if (dragging) {
      const row = getPositionFromEvent(e.clientX);
      onSeekRow(row);
    }
  }, [dragging, getPositionFromEvent, onSeekRow]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  return (
    <div className="flex items-center gap-3 text-xs font-mono select-none">
      {/* Current time */}
      <span className="text-gray-400 w-12 text-right shrink-0">{formatTime(currentSeconds)}</span>

      {/* Bar */}
      <div
        ref={barRef}
        className="relative flex-1 h-3 bg-gray-800 rounded-full cursor-pointer group"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setDragging(false); setHoverPct(null); }}
      >
        {/* Progress fill (time-based) */}
        <div
          className="absolute top-0 left-0 h-full rounded-full bg-gray-700/50"
          style={{ width: `${pct}%` }}
        />
        {/* Row-based fill */}
        <div
          className="absolute top-0 left-0 h-full rounded-full bg-cyan-600/80 transition-[width] duration-75"
          style={{ width: `${rowPct}%` }}
        />
        {/* Playhead dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-cyan-400 rounded-full shadow-lg shadow-cyan-500/30 transition-[left] duration-75"
          style={{ left: `calc(${rowPct}% - 6px)` }}
        />
        {/* Hover indicator */}
        {hoverPct !== null && (
          <div
            className="absolute top-0 h-full w-px bg-white/20"
            style={{ left: `${hoverPct}%` }}
          />
        )}
      </div>

      {/* Duration */}
      <span className="text-gray-400 w-12 shrink-0">{formatTime(durationSeconds)}</span>

      {/* Status indicator */}
      <span className={`text-[10px] ${isPlaying ? 'text-green-400' : 'text-gray-500'}`}>
        {isPlaying ? '▶' : '■'}
      </span>
    </div>
  );
};
