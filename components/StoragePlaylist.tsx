import { useState, useEffect, useCallback } from 'react';
import type { PlaylistItem } from './Playlist';

const STORAGE_API = 'https://storage.noahcohn.com';

export interface ModEntry {
  id: string;
  filename: string;
  title: string;
  author: string;
  duration: number;
  size: number;
  tags: string[];
  notes: string;
  url: string;
}

interface StoragePlaylistProps {
  onAddToPlaylist: (item: PlaylistItem) => void;
  onLoadAndPlay: (fileData: Uint8Array, fileName: string) => void;
  isDarkMode?: boolean;
}

function formatDuration(secs: number): string {
  if (!secs) return '--:--';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const StoragePlaylist: React.FC<StoragePlaylistProps> = ({
  onAddToPlaylist,
  onLoadAndPlay,
  isDarkMode = true,
}) => {
  const [mods, setMods] = useState<ModEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchMods = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${STORAGE_API}/api/mods`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMods(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(`Failed to load storage library: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMods();
  }, [fetchMods]);

  const loadMod = useCallback(
    async (mod: ModEntry, addToPlaylist: boolean) => {
      setLoadingId(mod.id);
      try {
        const res = await fetch(`${STORAGE_API}/api/mods/${mod.id}/download`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const data = new Uint8Array(buf);
        const fileName = mod.filename;
        if (addToPlaylist) {
          onAddToPlaylist({
            id: `storage-${mod.id}-${Date.now()}`,
            fileName,
            fileData: data,
          });
        } else {
          onLoadAndPlay(data, fileName);
        }
      } catch (e) {
        console.error('Failed to load MOD:', e);
      } finally {
        setLoadingId(null);
      }
    },
    [onAddToPlaylist, onLoadAndPlay]
  );

  const filtered = search.trim()
    ? mods.filter(
        m =>
          m.title.toLowerCase().includes(search.toLowerCase()) ||
          m.author.toLowerCase().includes(search.toLowerCase()) ||
          m.filename.toLowerCase().includes(search.toLowerCase())
      )
    : mods;

  const bg = isDarkMode ? 'bg-gray-900 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-900';
  const rowHover = isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50';
  const inputCls = isDarkMode
    ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500'
    : 'bg-gray-100 border-gray-300 text-gray-900 placeholder-gray-400';

  return (
    <div className={`mt-4 rounded-xl border ${bg} overflow-hidden`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
        <span className="text-sm font-mono font-semibold">
          📦 Storage Library
          {!loading && (
            <span className={`ml-2 text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              ({filtered.length}/{mods.length})
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`text-xs font-mono px-2 py-1 rounded border outline-none w-36 ${inputCls}`}
          />
          <button
            onClick={fetchMods}
            className={`text-xs px-2 py-1 rounded border font-mono ${isDarkMode ? 'border-gray-700 text-gray-400 hover:text-white' : 'border-gray-300 text-gray-500 hover:text-gray-900'}`}
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {loading ? (
        <div className={`py-8 text-center text-sm font-mono ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          Loading...
        </div>
      ) : error ? (
        <div className="py-6 px-4 text-center text-sm font-mono text-red-400">{error}</div>
      ) : filtered.length === 0 ? (
        <div className={`py-8 text-center text-sm font-mono ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          {mods.length === 0 ? 'No MOD files in storage.' : 'No results.'}
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          {filtered.map(mod => (
            <div
              key={mod.id}
              className={`flex items-center justify-between px-4 py-2 border-b last:border-0 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'} ${rowHover} transition-colors`}
            >
              <div className="flex-1 min-w-0 mr-3">
                <div className="text-sm font-mono truncate">{mod.title || mod.filename}</div>
                {mod.author && (
                  <div className={`text-xs font-mono truncate ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {mod.author}
                  </div>
                )}
              </div>
              <div className={`text-xs font-mono mr-3 shrink-0 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                {formatDuration(mod.duration)}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => loadMod(mod, false)}
                  disabled={loadingId === mod.id}
                  title="Play now"
                  className={`text-xs px-2 py-1 rounded font-mono transition-colors ${
                    loadingId === mod.id
                      ? 'opacity-50 cursor-wait'
                      : isDarkMode
                        ? 'bg-cyan-900/40 text-cyan-400 hover:bg-cyan-800/60 border border-cyan-900'
                        : 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100 border border-cyan-200'
                  }`}
                >
                  {loadingId === mod.id ? '⏳' : '▶'}
                </button>
                <button
                  onClick={() => loadMod(mod, true)}
                  disabled={loadingId === mod.id}
                  title="Add to playlist"
                  className={`text-xs px-2 py-1 rounded font-mono transition-colors ${
                    loadingId === mod.id
                      ? 'opacity-50 cursor-wait'
                      : isDarkMode
                        ? 'bg-purple-900/40 text-purple-400 hover:bg-purple-800/60 border border-purple-900'
                        : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'
                  }`}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
