import React, { useRef, useEffect, useState } from 'react';
import type { MediaItem } from '../types';

interface MediaOverlayProps {
  item?: MediaItem | null;
  visible: boolean;
  opacity?: number; // 0..1
  fit?: 'contain' | 'cover';
  onClose: () => void;
  onUpdate?: (partial: Partial<MediaItem>) => void;
}

export const MediaOverlay: React.FC<MediaOverlayProps> = ({ item, visible, opacity = 0.9, fit = 'contain', onClose, onUpdate }) => {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setPos({ x: 0, y: 0 });
  }, [item?.id]);

  if (!item || !visible) return null;

  const handleMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    dragStart.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !dragStart.current) return;
    setPos({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  };
  const handleMouseUp = () => {
    setDragging(false);
    dragStart.current = null;
  };

  const isVideo = item.kind === 'video';

  return (
    <div className="absolute inset-0 pointer-events-none z-40">
      <div
        ref={overlayRef}
        className="pointer-events-auto rounded-lg overflow-hidden border border-white/10 shadow-2xl"
        style={{
          position: 'absolute',
          left: pos.x,
          top: pos.y,
          opacity: opacity,
          maxWidth: '90%',
          maxHeight: '80%',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div className="bg-black p-1 flex justify-end gap-2">
          <button onClick={() => onUpdate?.({ fit: fit === 'contain' ? 'cover' : 'contain' })} className="text-xs text-gray-300 px-2">Fit</button>
          <button onClick={() => onUpdate?.({ muted: !item.muted })} className="text-xs text-gray-300 px-2">Mute</button>
          <button onClick={onClose} className="text-xs text-red-400 px-2">Close</button>
        </div>
        <div className="flex items-center justify-center bg-black">
          {isVideo ? (
            <video src={item.url} controls autoPlay muted={!!item.muted} loop={!!item.loop} style={{ width: '100%', height: '100%', objectFit: fit }} />
          ) : (
            <img src={item.url} alt={item.fileName || 'media'} style={{ width: '100%', height: '100%', objectFit: fit }} />
          )}
        </div>
      </div>
    </div>
  );
};

