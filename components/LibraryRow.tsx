import { memo } from 'react';
import type { LibraryEntry } from '../types/localLibrary';
import { entryFormat } from '../store/libraryStore';
import { cn } from '../utils/cn';

export interface LibraryRowProps {
  entry: LibraryEntry;
  isActive: boolean;
  isLoading: boolean;
  isDarkMode: boolean;
  onPlay: (entry: LibraryEntry) => void;
  onToggleFavorite: (entryId: string) => void;
}

const FORMAT_COLORS: Record<string, string> = {
  mod: 'text-amber-400 border-amber-900/50 bg-amber-950/30',
  xm: 'text-cyan-400 border-cyan-900/50 bg-cyan-950/30',
  it: 'text-violet-400 border-violet-900/50 bg-violet-950/30',
  s3m: 'text-emerald-400 border-emerald-900/50 bg-emerald-950/30',
};

function formatBadgeClass(format: string, isDarkMode: boolean): string {
  const key = format.toLowerCase();
  if (FORMAT_COLORS[key]) return FORMAT_COLORS[key];
  return isDarkMode
    ? 'text-gray-400 border-gray-700 bg-gray-800/50'
    : 'text-gray-600 border-gray-300 bg-gray-100';
}

export const LibraryRow = memo(function LibraryRow({
  entry,
  isActive,
  isLoading,
  isDarkMode,
  onPlay,
  onToggleFavorite,
}: LibraryRowProps) {
  const format = entryFormat(entry);
  const subtitle = entry.artist?.trim() || entry.fileName;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPlay(entry)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPlay(entry);
        }
      }}
      className={cn(
        'group flex items-center gap-3 px-4 py-2.5 border-b cursor-pointer transition-colors outline-none',
        isDarkMode ? 'border-gray-800/80' : 'border-gray-100',
        isActive
          ? isDarkMode
            ? 'bg-cyan-950/40 border-l-2 border-l-cyan-500'
            : 'bg-cyan-50 border-l-2 border-l-cyan-500'
          : isDarkMode
            ? 'hover:bg-gray-800/60 focus-visible:bg-gray-800/60'
            : 'hover:bg-gray-50 focus-visible:bg-gray-50',
        isLoading && 'opacity-60 pointer-events-none',
      )}
      aria-busy={isLoading}
      aria-current={isActive ? 'true' : undefined}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(entry.id);
        }}
        className={cn(
          'shrink-0 w-7 h-7 flex items-center justify-center rounded text-sm transition-colors',
          entry.favorite
            ? 'text-amber-400 hover:text-amber-300'
            : isDarkMode
              ? 'text-gray-600 hover:text-amber-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
              : 'text-gray-300 hover:text-amber-500 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
          entry.favorite && 'opacity-100',
        )}
        title={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-label={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        {entry.favorite ? '★' : '☆'}
      </button>

      <div className="flex-1 min-w-0">
        <div
          className={cn(
            'text-sm font-mono font-medium truncate',
            isActive && (isDarkMode ? 'text-cyan-300' : 'text-cyan-700'),
          )}
          title={entry.title}
        >
          {entry.title}
        </div>
        <div
          className={cn(
            'text-xs font-mono truncate mt-0.5',
            isDarkMode ? 'text-gray-500' : 'text-gray-400',
          )}
          title={subtitle}
        >
          {subtitle}
        </div>
      </div>

      {format && (
        <span
          className={cn(
            'shrink-0 text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border tracking-wide',
            formatBadgeClass(format, isDarkMode),
          )}
        >
          {format}
        </span>
      )}

      <span
        className={cn(
          'shrink-0 text-xs font-mono w-5 text-center transition-opacity',
          isLoading ? 'opacity-100' : 'opacity-0 group-hover:opacity-60',
          isDarkMode ? 'text-cyan-400' : 'text-cyan-600',
        )}
        aria-hidden
      >
        {isLoading ? '⏳' : '▶'}
      </span>
    </div>
  );
});
