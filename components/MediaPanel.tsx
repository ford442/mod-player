import React, { useState, useMemo, useEffect } from 'react';
import type { MediaItem } from '../types';
import { deriveMediaCandidates, checkMediaAvailability } from '../utils/remoteMedia';

export interface MediaFades {
  in: number;
  out: number;
}

export const FADES_STORAGE_KEY = 'xasm1_media_fades';
export const DEFAULT_FADES: MediaFades = { in: 500, out: 500 };

export function loadMediaFades(): MediaFades {
  try {
    const raw = localStorage.getItem(FADES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MediaFades>;
      return {
        in: typeof parsed.in === 'number' ? parsed.in : DEFAULT_FADES.in,
        out: typeof parsed.out === 'number' ? parsed.out : DEFAULT_FADES.out,
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_FADES };
}

interface MediaPanelProps {
  media: MediaItem[];
  activeMediaId?: string;
  onSelect: (id?: string) => void;
  onRemove: (id: string) => void;
  moduleFileName?: string;
  moduleComment?: string;
  onApplyDetected?: (url: string) => void;
  fades?: MediaFades;
  onFadesChange?: (fades: MediaFades) => void;
}

export const MediaPanel: React.FC<MediaPanelProps> = ({ media, activeMediaId, onSelect, onRemove, moduleFileName, moduleComment, onApplyDetected, fades, onFadesChange }) => {
  const [focusedId, setFocusedId] = useState<string | null>(activeMediaId || null);
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const effectiveFades = fades ?? DEFAULT_FADES;

  const mediaMap = useMemo(() => new Map(media.map(item => [item.id, item])), [media]);

  // Auto-detect synced media for the current module. Strict-mode-safe: an
  // AbortController lock prevents the dev double-invocation from double-probing.
  useEffect(() => {
    setDetectedUrl(null);
    if (!moduleFileName) return undefined;
    const controller = new AbortController();
    (async () => {
      const candidates = deriveMediaCandidates(moduleFileName, moduleComment);
      for (const url of candidates) {
        if (controller.signal.aborted) return;
        // eslint-disable-next-line no-await-in-loop
        const ok = await checkMediaAvailability(url);
        if (controller.signal.aborted) return;
        if (ok) {
          setDetectedUrl(url);
          return;
        }
      }
    })();
    return () => controller.abort();
  }, [moduleFileName, moduleComment]);

  const handleOpen = (id: string) => {
    setFocusedId(id);
    onSelect(id);
  };

  const handleClose = () => {
    setFocusedId(null);
    onSelect(undefined);
  };

  return (
    <section className="bg-gray-800 p-4 rounded-lg shadow-lg mb-6">
      <h3 className="text-white font-semibold mb-3">Media</h3>

      {detectedUrl && (
        <div className="mb-3 flex items-center gap-2 text-xs bg-cyan-900/40 border border-cyan-500/30 rounded px-2 py-1">
          <span className="text-cyan-200">Auto-detected media</span>
          <button
            onClick={() => { onApplyDetected?.(detectedUrl); setDetectedUrl(null); }}
            className="bg-cyan-600 text-white px-2 py-0.5 rounded"
          >
            Apply
          </button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-4 text-xs text-gray-300">
        <label className="flex items-center gap-2">
          Fade in
          <input
            type="range" min={0} max={3000} step={100}
            value={effectiveFades.in}
            onChange={(e) => onFadesChange?.({ ...effectiveFades, in: Number(e.target.value) })}
          />
          <span className="w-10 text-right">{effectiveFades.in}ms</span>
        </label>
        <label className="flex items-center gap-2">
          Fade out
          <input
            type="range" min={0} max={3000} step={100}
            value={effectiveFades.out}
            onChange={(e) => onFadesChange?.({ ...effectiveFades, out: Number(e.target.value) })}
          />
          <span className="w-10 text-right">{effectiveFades.out}ms</span>
        </label>
      </div>

      {media.length === 0 ? (
        <div className="text-gray-400">No media added yet.</div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {media.map(item => (
            <div key={item.id} className="relative bg-gray-900 rounded overflow-hidden">
              {item.kind === 'video' ? (
                <video src={item.url} className="w-full h-24 object-cover" muted loop={!!item.loop} playsInline />
              ) : (
                <img src={item.url} alt={item.fileName || 'media'} className="w-full h-24 object-cover" />
              )}

              <div className="absolute right-1 top-1 flex gap-1">
                <button onClick={() => handleOpen(item.id)} className="bg-black/50 text-white px-2 py-1 rounded text-xs">View</button>
                <button onClick={() => onRemove(item.id)} className="bg-red-600 text-white px-2 py-1 rounded text-xs">Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {focusedId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={handleClose}>
          <div className="bg-black rounded-lg p-4 max-w-5xl max-h-[80vh] w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-2">
              <button onClick={handleClose} className="text-gray-300">Close</button>
            </div>
            <div className="flex items-center justify-center">
              {(() => {
                const item = mediaMap.get(focusedId);
                if (!item) return null;
                if (item.kind === 'video') {
                  return (
                    <video src={item.url} controls autoPlay muted={!!item.muted} loop={!!item.loop} className="max-h-[70vh] w-auto max-w-full" />
                  );
                }
                // images & gifs
                return <img src={item.url} alt={item.fileName || 'media'} className="max-h-[70vh] w-auto max-w-full" />;
              })()}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
