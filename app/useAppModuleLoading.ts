import { useState, useCallback, useMemo } from 'react';
import type { MutableRefObject } from 'react';
import type { SongSaveRequest } from '../utils/storageApi';
import { usePlayerEngine, usePlayerEngineInstance } from '../hooks/usePlayerEngine';

export interface UseAppModuleLoadingParams {
  patternEditDirtyRef: MutableRefObject<boolean>;
  playlistItems: Array<{ fileName: string }>;
  playlistCurrentIndex: number;
}

export interface UseAppModuleLoadingResult {
  currentModuleFileName: string;
  moduleSourceUrl: string | null;
  setModuleSourceUrl: React.Dispatch<React.SetStateAction<string | null>>;
  loadFileWithHash: (fileData: Uint8Array, fileName: string) => void;
  handleFileSelected: (file: File) => Promise<void>;
  activeModuleForSave: SongSaveRequest | null;
}

export function useAppModuleLoading(params: UseAppModuleLoadingParams): UseAppModuleLoadingResult {
  const { patternEditDirtyRef, playlistItems, playlistCurrentIndex } = params;
  const engine = usePlayerEngineInstance();
  const isModuleLoaded = usePlayerEngine((s) => s.isModuleLoaded);
  const moduleTitle = usePlayerEngine((s) => s.moduleInfo.title);
  const numChannels = usePlayerEngine((s) => s.sequencerMatrix?.numChannels ?? 0);

  const [currentModuleFileName, setCurrentModuleFileName] = useState<string>('');
  const [moduleSourceUrl, setModuleSourceUrl] = useState<string | null>(null);

  const loadFileWithHash = useCallback((fileData: Uint8Array, fileName: string) => {
    if (patternEditDirtyRef.current) {
      const ok = window.confirm(
        'You have unsaved pattern edits. Discard them and load a new module?',
      );
      if (!ok) return;
    }
    setCurrentModuleFileName(fileName);
    void engine.loadFile(fileData, fileName);
  }, [engine, patternEditDirtyRef]);

  const handleFileSelected = useCallback(async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    setModuleSourceUrl(null);
    loadFileWithHash(data, file.name);
  }, [loadFileWithHash]);

  const activeModuleForSave = useMemo((): SongSaveRequest | null => {
    if (!isModuleLoaded) return null;
    // The module's title (it used to be parsed from the status line, which says "Playing..." mid-song).
    const title = moduleTitle || 'Unknown';
    const currentItem = playlistItems[playlistCurrentIndex];
    const fileName = currentItem?.fileName;
    const req: SongSaveRequest = { title };
    if (fileName) req.fileName = fileName;
    const extension = fileName?.split('.').pop()?.trim().toLowerCase();
    if (extension) req.format = extension;
    if (numChannels > 0) req.channelCount = numChannels;
    return req;
  }, [isModuleLoaded, moduleTitle, playlistItems, playlistCurrentIndex, numChannels]);

  return {
    currentModuleFileName,
    moduleSourceUrl,
    setModuleSourceUrl,
    loadFileWithHash,
    handleFileSelected,
    activeModuleForSave,
  };
}
