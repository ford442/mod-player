import { useCallback, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { LibraryEntry, LibraryFilter, LibraryFormatFilter, LibraryImportProgress, LibraryRoot, LibrarySortBy } from '../types/localLibrary';
import { useLocalLibraryIndex } from '../store/libraryStore';
import { LibraryRow } from './LibraryRow';
import { cn } from '../utils/cn';

const ROW_HEIGHT = 56;
const FORMAT_OPTIONS: { value: LibraryFormatFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mod', label: 'MOD' },
  { value: 'xm', label: 'XM' },
  { value: 'it', label: 'IT' },
  { value: 's3m', label: 'S3M' },
];

interface LibraryPanelProps {
  roots: LibraryRoot[];
  isLoading: boolean;
  isImporting: boolean;
  importProgress: LibraryImportProgress | null;
  importError: string | null;
  fsAccessSupported: boolean;
  isDarkMode: boolean;
  activeEntryId?: string | null;
  onImportFolder: () => void;
  onImportWebkitFiles: (files: FileList) => void;
  onRescanRoot: (rootId: string) => void;
  onRemoveRoot: (rootId: string) => void;
  onCancelImport: () => void;
  onPlayEntry: (entry: LibraryEntry) => Promise<void>;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return '';
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `~${sec}s left`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `~${m}:${s.toString().padStart(2, '0')} left`;
}

function ImportProgressModal({
  progress,
  onCancel,
  isDarkMode,
}: {
  progress: LibraryImportProgress;
  onCancel: () => void;
  isDarkMode: boolean;
}) {
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const phaseLabel = progress.phase === 'collecting' ? 'Finding modules' : 'Reading metadata';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className={cn(
          'w-full max-w-md rounded-xl border p-5 shadow-2xl',
          isDarkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900',
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-progress-title"
      >
        <h3 id="import-progress-title" className="text-sm font-mono font-semibold mb-3">
          Importing library…
        </h3>
        <p className="text-xs font-mono text-gray-400 mb-2">
          {phaseLabel}: {progress.done.toLocaleString()}
          {progress.total > 0 ? ` / ${progress.total.toLocaleString()}` : ''} files
          {formatDuration(progress.estimatedRemainingMs) ? ` · ${formatDuration(progress.estimatedRemainingMs)}` : ''}
        </p>
        {progress.currentFile && (
          <p className="text-xs font-mono truncate opacity-60 mb-3" title={progress.currentFile}>
            {progress.currentFile}
          </p>
        )}
        <div className={cn('h-2 rounded-full overflow-hidden mb-4', isDarkMode ? 'bg-gray-800' : 'bg-gray-200')}>
          <div className="h-full bg-cyan-500 transition-all duration-150" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            'text-xs font-mono px-3 py-1.5 rounded border',
            isDarkMode
              ? 'border-gray-600 text-gray-300 hover:bg-gray-800'
              : 'border-gray-300 text-gray-600 hover:bg-gray-100',
          )}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function LibraryPanel({
  roots,
  isLoading,
  isImporting,
  importProgress,
  importError,
  fsAccessSupported,
  isDarkMode,
  activeEntryId,
  onImportFolder,
  onImportWebkitFiles,
  onRescanRoot,
  onRemoveRoot,
  onCancelImport,
  onPlayEntry,
}: LibraryPanelProps) {
  const {
    entries,
    filteredEntries,
    searchQuery,
    filter,
    formatFilter,
    sortBy,
    setSearchQuery,
    setFilter,
    setFormatFilter,
    setSortBy,
    toggleFavorite,
  } = useLocalLibraryIndex();

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [rootsExpanded, setRootsExpanded] = useState(false);
  const webkitInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  });

  const handlePlay = useCallback(
    async (entry: LibraryEntry) => {
      setPlayError(null);
      setLoadingId(entry.id);
      try {
        await onPlayEntry(entry);
      } catch (err) {
        setPlayError(err instanceof Error ? err.message : 'Failed to load track');
      } finally {
        setLoadingId(null);
      }
    },
    [onPlayEntry],
  );

  const inputClass = isDarkMode
    ? 'bg-gray-800/80 border-gray-700 text-white placeholder-gray-500'
    : 'bg-gray-100 border-gray-300 text-gray-900 placeholder-gray-400';

  const chipClass = (active: boolean) =>
    cn(
      'text-[11px] font-mono px-2 py-0.5 rounded-full border transition-colors',
      active
        ? 'bg-cyan-900/40 text-cyan-300 border-cyan-800'
        : isDarkMode
          ? 'border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
          : 'border-gray-300 text-gray-500 hover:text-gray-700 hover:border-gray-400',
    );

  return (
    <>
      {isImporting && importProgress && (
        <ImportProgressModal progress={importProgress} onCancel={onCancelImport} isDarkMode={isDarkMode} />
      )}

      <div className={cn('flex flex-col', isDarkMode ? 'text-white' : 'text-gray-900')}>
        {/* Toolbar */}
        <div
          className={cn(
            'flex flex-col gap-3 px-4 py-3 border-b',
            isDarkMode ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-gray-50/80',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-mono font-semibold tracking-tight">
              Library
              {!isLoading && (
                <span className={cn('ml-2 text-xs font-normal', isDarkMode ? 'text-gray-500' : 'text-gray-400')}>
                  {filteredEntries.length.toLocaleString()}
                  {filteredEntries.length !== entries.length && ` / ${entries.length.toLocaleString()}`}
                </span>
              )}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {fsAccessSupported ? (
                <button
                  type="button"
                  onClick={onImportFolder}
                  disabled={isImporting}
                  className={cn(
                    'text-xs px-2.5 py-1 rounded-lg border font-mono transition-colors',
                    isImporting
                      ? 'opacity-50 cursor-wait'
                      : isDarkMode
                        ? 'border-cyan-800 text-cyan-400 hover:bg-cyan-950/40'
                        : 'border-cyan-300 text-cyan-700 hover:bg-cyan-50',
                  )}
                >
                  Import folder
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => webkitInputRef.current?.click()}
                  disabled={isImporting}
                  className={cn(
                    'text-xs px-2.5 py-1 rounded-lg border font-mono transition-colors',
                    isImporting
                      ? 'opacity-50 cursor-wait'
                      : isDarkMode
                        ? 'border-cyan-800 text-cyan-400 hover:bg-cyan-950/40'
                        : 'border-cyan-300 text-cyan-700 hover:bg-cyan-50',
                  )}
                >
                  Import folder
                </button>
              )}
              <input
                ref={webkitInputRef}
                type="file"
                className="hidden"
                multiple
                {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
                onChange={(e) => {
                  if (e.target.files?.length) {
                    onImportWebkitFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder="Search title, artist, filename…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn('flex-1 min-w-[12rem] text-xs font-mono px-3 py-1.5 rounded-lg border outline-none focus:ring-1 focus:ring-cyan-700', inputClass)}
              aria-label="Search library"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as LibraryFilter)}
              className={cn('text-xs font-mono px-2 py-1.5 rounded-lg border outline-none', inputClass)}
              aria-label="Collection filter"
            >
              <option value="all">All tracks</option>
              <option value="favorites">Favorites</option>
              <option value="recent">Recently played</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as LibrarySortBy)}
              className={cn('text-xs font-mono px-2 py-1.5 rounded-lg border outline-none', inputClass)}
              aria-label="Sort order"
            >
              <option value="title">Sort: Title</option>
              <option value="lastPlayed">Sort: Last played</option>
              <option value="importedAt">Sort: Imported</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Format filter">
            {FORMAT_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setFormatFilter(value)}
                className={chipClass(formatFilter === value)}
              >
                {label}
              </button>
            ))}
          </div>

          {roots.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setRootsExpanded((v) => !v)}
                className={cn(
                  'text-[11px] font-mono',
                  isDarkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600',
                )}
              >
                {rootsExpanded ? '▾' : '▸'} {roots.length} imported folder{roots.length === 1 ? '' : 's'}
              </button>
              {rootsExpanded && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {roots.map((root) => (
                    <span
                      key={root.id}
                      className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-mono',
                        isDarkMode ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500',
                      )}
                    >
                      {root.label} ({root.entryCount})
                      {root.source === 'fs-access' && (
                        <button
                          type="button"
                          className="opacity-70 hover:opacity-100"
                          title="Re-scan folder"
                          onClick={() => onRescanRoot(root.id)}
                          disabled={isImporting}
                        >
                          ⟳
                        </button>
                      )}
                      <button
                        type="button"
                        className="opacity-70 hover:text-red-400"
                        title="Remove folder"
                        onClick={() => void onRemoveRoot(root.id)}
                        disabled={isImporting}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <div className={cn('py-16 text-center text-sm font-mono', isDarkMode ? 'text-gray-500' : 'text-gray-400')}>
            <div className="inline-block animate-pulse">Loading library…</div>
          </div>
        ) : entries.length === 0 ? (
          <div className={cn('py-16 px-6 text-center', isDarkMode ? 'text-gray-500' : 'text-gray-400')}>
            <p className="text-3xl mb-3 opacity-40">📁</p>
            <p className="text-sm font-mono font-medium mb-1">Your library is empty</p>
            <p className="text-xs font-mono opacity-80 max-w-sm mx-auto mb-4">
              Import a folder of tracker modules to browse by real titles — .mod, .xm, .it, .s3m and more.
            </p>
            <button
              type="button"
              onClick={fsAccessSupported ? onImportFolder : () => webkitInputRef.current?.click()}
              disabled={isImporting}
              className={cn(
                'text-xs px-4 py-2 rounded-lg border font-mono',
                isDarkMode
                  ? 'border-cyan-800 text-cyan-400 hover:bg-cyan-950/40'
                  : 'border-cyan-400 text-cyan-700 hover:bg-cyan-50',
              )}
            >
              Import folder
            </button>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className={cn('py-12 text-center text-sm font-mono', isDarkMode ? 'text-gray-500' : 'text-gray-400')}>
            No tracks match your filters.
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="overflow-y-auto overscroll-contain"
            style={{ height: 'min(70vh, 28rem)' }}
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const entry = filteredEntries[virtualRow.index];
                if (!entry) return null;
                return (
                  <div
                    key={entry.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <LibraryRow
                      entry={entry}
                      isActive={activeEntryId === entry.id}
                      isLoading={loadingId === entry.id}
                      isDarkMode={isDarkMode}
                      onPlay={handlePlay}
                      onToggleFavorite={toggleFavorite}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {importError && (
          <div className="px-4 py-2 text-xs font-mono text-amber-400 border-t border-amber-900/30">{importError}</div>
        )}
        {playError && (
          <div className="px-4 py-2 text-xs font-mono text-red-400 border-t border-red-900/30">{playError}</div>
        )}
      </div>
    </>
  );
}
