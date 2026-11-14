import { useState, useEffect, useCallback, useRef } from 'react';
import type { MediaItem } from '../types';
import { readLocalStorage, writeLocalStorage } from '../utils/localStorageIO';
import { DEFAULT_MEDIA_FADES, MEDIA_FADES_STORAGE_KEY, type MediaFades } from '../utils/mediaFades';

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
  const [mediaFades, setMediaFades] = useState<MediaFades>(
    () => readLocalStorage(MEDIA_FADES_STORAGE_KEY, { ...DEFAULT_MEDIA_FADES }),
  );

  useEffect(() => {
    writeLocalStorage(MEDIA_FADES_STORAGE_KEY, mediaFades);
  }, [mediaFades]);

  // Revoke any lingering media object URL on unmount
  useEffect(() => {
    return () => {
      if (mediaObjectUrlRef.current) {
        URL.revokeObjectURL(mediaObjectUrlRef.current);
      }
    };
  }, []);

  /** Revokes the local file's object URL, if one is live. */
  const releaseObjectUrl = useCallback(() => {
    if (mediaObjectUrlRef.current) {
      URL.revokeObjectURL(mediaObjectUrlRef.current);
      mediaObjectUrlRef.current = null;
    }
  }, []);

  const handleMediaAdd = useCallback((file: File) => {
    releaseObjectUrl();
    setMediaItem(createLocalMediaItem(file, (blob) => {
      const url = URL.createObjectURL(blob);
      mediaObjectUrlRef.current = url;
      return url;
    }));
    setMediaVisible(true);
  }, [releaseObjectUrl]);

  const handleRemoteMediaSelect = useCallback((item: MediaItem) => {
    releaseObjectUrl();
    setMediaItem(item);
    setMediaVisible(true);
  }, [releaseObjectUrl]);

  const handleMediaRemove = useCallback((id: string) => {
    if (mediaItem?.id !== id) return;
    if (mediaItem.isObjectUrl && mediaObjectUrlRef.current === mediaItem.url) releaseObjectUrl();
    setMediaVisible(false);
    setMediaItem(null);
  }, [mediaItem, releaseObjectUrl]);

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

/**
 * A media item for a local file. Its URL is an object URL that only this tab can open, so it is
 * flagged `isObjectUrl`: share links leave it out (`shareableMediaUrl`) and removing the item
 * revokes it.
 */
export function createLocalMediaItem(file: File, createObjectUrl: (file: File) => string): MediaItem {
  const kind = file.type.startsWith('video') ? 'video' : 'image';
  return {
    id: crypto.randomUUID(),
    kind,
    url: createObjectUrl(file),
    fileName: file.name,
    mimeType: file.type,
    loop: kind === 'video',
    isObjectUrl: true,
  };
}
