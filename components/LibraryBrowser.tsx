import { useMemo, useState } from 'react';
import type { RemoteSong } from '../utils/storageApi';

interface LibraryBrowserProps {
  songs: RemoteSong[];
  loading: boolean;
  error: string | null;
  isDarkMode: boolean;
  onRefresh: () => void;
  onLoadSong: (song: RemoteSong) => Promise<void>;
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function LibraryBrowser({
  songs,
  loading,
  error,
  isDarkMode,
  onRefresh,
  onLoadSong,
}: LibraryBrowserProps) {
  const [search, setSearch] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const filteredSongs = useMemo(() => {
    const trimmed = search.trim().toLowerCase();
    if (!trimmed) return songs;
    return songs.filter(song => (
      song.title.toLowerCase().includes(trimmed) ||
      song.artist.toLowerCase().includes(trimmed) ||
      song.fileName.toLowerCase().includes(trimmed)
    ));
  }, [search, songs]);

  const panel = isDarkMode ? 'bg-gray-900 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-900';
  const input = isDarkMode
    ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500'
    : 'bg-gray-100 border-gray-300 text-gray-900 placeholder-gray-400';
  const rowHover = isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50';

  return (
    <div className={`rounded-xl border ${panel} overflow-hidden`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
        <span className="text-sm font-mono font-semibold">
          ☁️ Cloud Library
          {!loading && (
            <span className={`ml-2 text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              ({filteredSongs.length}/{songs.length})
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search songs..."
            value={search}
            onChange={event => setSearch(event.target.value)}
            className={`text-xs font-mono px-2 py-1 rounded border outline-none w-40 ${input}`}
          />
          <button
            onClick={onRefresh}
            className={`text-xs px-2 py-1 rounded border font-mono ${isDarkMode ? 'border-gray-700 text-gray-400 hover:text-white' : 'border-gray-300 text-gray-500 hover:text-gray-900'}`}
            title="Refresh library"
          >
            ↻
          </button>
        </div>
      </div>

      {loading ? (
        <div className={`py-8 text-center text-sm font-mono ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Loading cloud library…</div>
      ) : error ? (
        <div className="py-6 px-4 text-center text-sm font-mono text-red-400">{error}</div>
      ) : filteredSongs.length === 0 ? (
        <div className={`py-8 text-center text-sm font-mono ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          {songs.length === 0 ? 'No remote songs found.' : 'No matching songs.'}
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          {filteredSongs.map(song => (
            <div
              key={song.id}
              className={`flex items-center justify-between px-4 py-2 border-b last:border-0 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'} ${rowHover} transition-colors`}
            >
              <div className="flex-1 min-w-0 mr-3">
                <div className="text-sm font-mono truncate">{song.title}</div>
                <div className={`text-xs font-mono truncate ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  {song.artist || song.fileName}
                </div>
              </div>
              <div className={`text-xs font-mono mr-3 shrink-0 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                {formatDuration(song.durationSeconds)}
              </div>
              <button
                onClick={async () => {
                  setLoadError(null);
                  setLoadingId(song.id);
                  try {
                    await onLoadSong(song);
                  } catch (songLoadErr) {
                    setLoadError(songLoadErr instanceof Error ? songLoadErr.message : 'Failed to load remote song');
                  } finally {
                    setLoadingId(null);
                  }
                }}
                disabled={loadingId === song.id}
                className={`text-xs px-2 py-1 rounded font-mono transition-colors ${
                  loadingId === song.id
                    ? 'opacity-50 cursor-wait'
                    : isDarkMode
                      ? 'bg-cyan-900/40 text-cyan-400 hover:bg-cyan-800/60 border border-cyan-900'
                      : 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100 border border-cyan-200'
                }`}
                title="Load and play"
              >
                {loadingId === song.id ? '⏳' : '▶ Load'}
              </button>
            </div>
          ))}
        </div>
      )}

      {loadError && (
        <div className="px-4 py-2 text-xs font-mono text-red-400 border-t border-red-900/30">
          {loadError}
        </div>
      )}
    </div>
  );
}
