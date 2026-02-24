import { useState, useCallback, useRef, useEffect } from 'react';

export interface PlaylistItem {
  id: string;
  fileName: string;
  fileData: Uint8Array;
}

interface PlaylistProps {
  items: PlaylistItem[];
  currentIndex: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: 'none' | 'all' | 'one';
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  onPrev: () => void;
  onNext: () => void;
  onShuffleToggle: () => void;
  onRepeatCycle: () => void;
  onFilesAdded: (files: FileList) => void;
}

export const Playlist: React.FC<PlaylistProps> = ({
  items,
  currentIndex,
  isPlaying,
  shuffle,
  repeat,
  onSelect,
  onRemove,
  onClear,
  onPrev,
  onNext,
  onShuffleToggle,
  onRepeatCycle,
  onFilesAdded,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to current item
  useEffect(() => {
    if (listRef.current && currentIndex >= 0) {
      const el = listRef.current.children[currentIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentIndex]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length) {
      onFilesAdded(e.dataTransfer.files);
    }
  }, [onFilesAdded]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const repeatLabel = repeat === 'one' ? '🔂' : repeat === 'all' ? '🔁' : '➡️';
  const repeatTitle = repeat === 'one' ? 'Repeat One' : repeat === 'all' ? 'Repeat All' : 'No Repeat';

  return (
    <section
      className={`bg-gray-900 rounded-xl border shadow-lg overflow-hidden text-xs font-mono transition-colors ${isDragOver ? 'border-cyan-500 bg-cyan-950/20' : 'border-white/5'}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragOver(false)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-black/40 border-b border-white/5">
        <span className="text-gray-400 text-[10px] uppercase tracking-wider">
          Playlist ({items.length})
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            disabled={items.length === 0}
            className="px-1.5 py-0.5 rounded text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30"
            title="Previous"
            aria-label="Previous track"
          >⏮</button>
          <button
            onClick={onNext}
            disabled={items.length === 0}
            className="px-1.5 py-0.5 rounded text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30"
            title="Next"
            aria-label="Next track"
          >⏭</button>
          <button
            onClick={onShuffleToggle}
            className={`px-1.5 py-0.5 rounded ${shuffle ? 'text-cyan-400 bg-cyan-900/30' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
            title={shuffle ? 'Shuffle On' : 'Shuffle Off'}
            aria-label={shuffle ? 'Shuffle On' : 'Shuffle Off'}
          >🔀</button>
          <button
            onClick={onRepeatCycle}
            className={`px-1.5 py-0.5 rounded ${repeat !== 'none' ? 'text-cyan-400 bg-cyan-900/30' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
            title={repeatTitle}
            aria-label={repeatTitle}
          >{repeatLabel}</button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-1.5 py-0.5 rounded text-gray-400 hover:text-white hover:bg-white/10"
            title="Add files"
            aria-label="Add files to playlist"
          >➕</button>
          {items.length > 0 && (
            <button
              onClick={onClear}
              className="px-1.5 py-0.5 rounded text-gray-400 hover:text-red-400 hover:bg-red-900/20"
              title="Clear playlist"
              aria-label="Clear playlist"
            >🗑</button>
          )}
        </div>
      </div>

      {/* File input (hidden) */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".mod,.xm,.s3m,.it,.mptm,.stm,.669,.amf,.ams,.dbm,.dmf,.dsm,.far,.mdl,.med,.mtm,.okt,.psm,.ptm,.ult,.umx,.mt2,.gdm,.mo3,.j2b"
        className="hidden"
        onChange={(e) => { if (e.target.files) onFilesAdded(e.target.files); e.target.value = ''; }}
      />

      {/* List */}
      <div ref={listRef} className="max-h-48 overflow-y-auto pattern-scrollbar">
        {items.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-500">
            {isDragOver ? 'Drop files here...' : 'Drag & drop module files here'}
          </div>
        ) : (
          items.map((item, i) => {
            const isCurrent = i === currentIndex;
            return (
              <div
                key={item.id}
                className={`flex items-center gap-2 px-3 py-1 cursor-pointer transition-colors ${
                  isCurrent
                    ? 'bg-cyan-900/30 text-cyan-300'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                }`}
                onClick={() => onSelect(i)}
              >
                <span className="w-5 text-right text-gray-600 shrink-0">
                  {isCurrent && isPlaying ? '▶' : `${i + 1}.`}
                </span>
                <span className="truncate flex-1">{item.fileName}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(i); }}
                  className="text-gray-600 hover:text-red-400 shrink-0"
                  title="Remove"
                >✕</button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
