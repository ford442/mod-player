import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { MediaItem } from '../types';

interface MediaOverlayProps {
  item?: MediaItem | null;
  visible: boolean;
  opacity?: number; // 0..1
  fit?: 'contain' | 'cover';
  fadeInMs?: number | undefined;
  fadeOutMs?: number | undefined;
  onClose: () => void;
  onCloseComplete?: () => void;
  onUpdate?: (partial: Partial<MediaItem>) => void;
}

interface OverlayBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BOUNDS_STORAGE_KEY = 'xasm1_media_bounds';
const DEFAULT_BOUNDS: OverlayBounds = { x: 40, y: 40, w: 480, h: 320 };

function loadBounds(): OverlayBounds {
  try {
    const raw = localStorage.getItem(BOUNDS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<OverlayBounds>;
      return {
        x: typeof parsed.x === 'number' ? parsed.x : DEFAULT_BOUNDS.x,
        y: typeof parsed.y === 'number' ? parsed.y : DEFAULT_BOUNDS.y,
        w: typeof parsed.w === 'number' ? parsed.w : DEFAULT_BOUNDS.w,
        h: typeof parsed.h === 'number' ? parsed.h : DEFAULT_BOUNDS.h,
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_BOUNDS };
}

export const MediaOverlay: React.FC<MediaOverlayProps> = ({
  item,
  visible,
  opacity = 0.9,
  fit = 'contain',
  fadeInMs = 500,
  fadeOutMs = 500,
  onClose,
  onCloseComplete,
  onUpdate,
}) => {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [bounds, setBounds] = useState<OverlayBounds>(loadBounds);
  const [dragging, setDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Persist bounds (position + size) to localStorage.
  useEffect(() => {
    try {
      localStorage.setItem(BOUNDS_STORAGE_KEY, JSON.stringify(bounds));
    } catch {
      /* ignore */
    }
  }, [bounds]);

  // Trigger fade-in on the next frame after mount so the transition runs.
  useEffect(() => {
    if (item && visible) {
      setIsClosing(false);
      const raf = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(raf);
    }
    setMounted(false);
    return undefined;
  }, [item?.id, visible]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const handleClose = useCallback(() => {
    // Start fade-out; actually unmount via onCloseComplete after the transition.
    setIsClosing(true);
    setMounted(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      onClose();
      onCloseComplete?.();
    }, fadeOutMs);
  }, [fadeOutMs, onClose, onCloseComplete]);

  // Pointer-based drag using setPointerCapture.
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Ignore drags that originate on interactive controls.
    if ((e.target as HTMLElement).closest('button, a, input, video[controls]')) return;
    setDragging(true);
    dragStart.current = { x: e.clientX - bounds.x, y: e.clientY - bounds.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [bounds.x, bounds.y]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !dragStart.current) return;
    setBounds(prev => ({ ...prev, x: e.clientX - dragStart.current!.x, y: e.clientY - dragStart.current!.y }));
  }, [dragging]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    setDragging(false);
    dragStart.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  // Persist size after a native resize (resize: both) ends.
  const syncSizeFromDom = useCallback(() => {
    const el = overlayRef.current;
    if (!el) return;
    setBounds(prev => ({ ...prev, w: el.offsetWidth, h: el.offsetHeight }));
  }, []);

  const pipSupported = typeof document !== 'undefined' && (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled === true;

  const handlePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      // SecurityError / NotAllowedError / unsupported — silently keep the panel.
    }
  }, []);

  if (!item || (!visible && !isClosing)) return null;

  const isVideo = item.kind === 'video';
  const effectiveOpacity = mounted && !isClosing ? opacity : 0;
  const fadeDuration = isClosing ? fadeOutMs : fadeInMs;

  return (
    <div className="absolute inset-0 pointer-events-none z-40">
      <div
        ref={overlayRef}
        className="pointer-events-auto rounded-lg overflow-auto border border-white/10 shadow-2xl"
        style={{
          position: 'fixed',
          left: bounds.x,
          top: bounds.y,
          width: bounds.w,
          height: bounds.h,
          opacity: effectiveOpacity,
          transition: `opacity ${fadeDuration}ms ease`,
          resize: 'both',
          minWidth: 160,
          minHeight: 120,
          cursor: dragging ? 'grabbing' : 'default',
        }}
        onPointerUp={syncSizeFromDom}
      >
        <div
          className="bg-black p-1 flex justify-end gap-2 select-none"
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <button onClick={() => onUpdate?.({ fit: fit === 'contain' ? 'cover' : 'contain' })} className="text-xs text-gray-300 px-2">Fit</button>
          {isVideo && <button onClick={() => onUpdate?.({ muted: !item.muted })} className="text-xs text-gray-300 px-2">Mute</button>}
          {isVideo && pipSupported && <button onClick={handlePiP} className="text-xs text-gray-300 px-2">Pop out</button>}
          <button onClick={handleClose} className="text-xs text-red-400 px-2">Close</button>
        </div>
        <div className="relative flex items-center justify-center bg-black" style={{ width: '100%', height: 'calc(100% - 28px)' }}>
          {isVideo ? (
            <video
              ref={videoRef}
              src={item.url}
              crossOrigin="anonymous"
              controls
              autoPlay
              draggable={false}
              muted={!!item.muted}
              loop={!!item.loop}
              style={{ width: '100%', height: '100%', objectFit: fit }}
            />
          ) : (
            <img
              src={item.url}
              alt={item.fileName || 'media'}
              draggable={false}
              style={{ width: '100%', height: '100%', objectFit: fit }}
            />
          )}
          {/* Transparent shield prevents ghost-dragging the asset while moving the panel. */}
          {dragging && <div className="absolute inset-0" />}
        </div>
      </div>
    </div>
  );
};
