import React, { useState } from 'react';
import type { MediaItem } from '../types';

interface MediaPanelProps {
  media: MediaItem[];
  activeMediaId?: string;
  onSelect: (id?: string) => void;
  onRemove: (id: string) => void;
}

export const MediaPanel: React.FC<MediaPanelProps> = ({ media, activeMediaId, onSelect, onRemove }) => {
  const [focusedId, setFocusedId] = useState<string | null>(activeMediaId || null);

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
                const item = media.find(m => m.id === focusedId);
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

