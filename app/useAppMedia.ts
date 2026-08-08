import { useState, useEffect, useCallback, useRef } from 'react';
import type { MediaItem } from '../types';
import { readLocalStorage, writeLocalStorage } from '../utils/localStorageIO';

export interface UseAppMediaResult {
  mediaVisible: boolean;
  setMediaVisible: React.Dispatch<React.SetStateAction<boolean>>;
  mediaItem: MediaItem | null;
  setMediaItem: React.Dispatch<React.SetStateAction<MediaItem | null>>;
  mediaFades: { in: number; out: number };
  setMediaFades: React.Dispatch<React.SetStateAction<{ in: number; out: number }>>;
  handleMediaAdd: (file: File) => void;
  handleRemoteMediaSelect: (item: MediaItem) => void;
  handleMediaRemove: (id: string) => void;
}

export function useAppMedia(): UseAppMediaResult {
  const [mediaVisible, setMediaVisible] = useState<boolean>(false);
  const [mediaItem, setMediaItem] = useState<MediaItem | null>(null);
  const mediaObjectUrlRef = useRef<string | null>(null);
  const [mediaFades, setMediaFades] = useState<{ in: number; out: number }>(
    () => readLocalStorage('xasm1_media_fades', { in: 500, out: 500 }),
  );

  useEffect(() => {
    writeLocalStorage('xasm1_media_fades', mediaFades);
  }, [mediaFades]);

  // Revoke any lingering media object URL on unmount
  useEffect(() => {
    return () => {
      if (mediaObjectUrlRef.current) {
        URL.revokeObjectURL(mediaObjectUrlRef.current);
      }
    };
  }, []);

  const handleMediaAdd = (file: File) => {
    const kind = file.type.startsWith('video') ? 'video' : 'image';
    // Revoke the previous object URL to avoid memory leaks
    if (mediaObjectUrlRef.current) {
      URL.revokeObjectURL(mediaObjectUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    mediaObjectUrlRef.current = url;
    setMediaItem({
      id: crypto.randomUUID(),
      kind,
      url,
      fileName: file.name,
      mimeType: file.type,
      loop: kind === 'video',
    });
    setMediaVisible(true);
  };

  const handleRemoteMediaSelect = (item: MediaItem) => {
    setMediaItem(item);
    setMediaVisible(true);
  };

  const handleMediaRemove = useCallback((id: string) => {
    if (mediaItem?.id !== id) return;
    if (mediaItem.isObjectUrl && mediaObjectUrlRef.current === mediaItem.url) {
      URL.revokeObjectURL(mediaItem.url);
      mediaObjectUrlRef.current = null;
    }
    setMediaVisible(false);
    setMediaItem(null);
  }, [mediaItem]);

  return {
    mediaVisible,
    setMediaVisible,
    mediaItem,
    setMediaItem,
    mediaFades,
    setMediaFades,
    handleMediaAdd,
    handleRemoteMediaSelect,
    handleMediaRemove,
  };
}
