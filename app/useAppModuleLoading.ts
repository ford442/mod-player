import { useState, useCallback, useMemo } from 'react';
import type { MutableRefObject } from 'react';
import { computeModuleHash } from '../appConfig';
import type { SongSaveRequest } from '../utils/storageApi';
import type { PatternMatrix } from '../types';

export interface UseAppModuleLoadingParams {
  loadFile: (fileData: Uint8Array, fileName: string) => void | Promise<void>;
  setModuleHash: (hash: string) => void;
  patternEditDirtyRef: MutableRefObject<boolean>;
  isModuleLoaded: boolean;
  status: string;
  sequencerMatrix: PatternMatrix | null;
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
  const {
    loadFile,
    setModuleHash,
    patternEditDirtyRef,
    isModuleLoaded,
    status,
    sequencerMatrix,
    playlistItems,
    playlistCurrentIndex,
  } = params;

  const [currentModuleFileName, setCurrentModuleFileName] = useState<string>('');
  const [moduleSourceUrl, setModuleSourceUrl] = useState<string | null>(null);

  const loadFileWithHash = useCallback((fileData: Uint8Array, fileName: string) => {
    if (patternEditDirtyRef.current) {
      const ok = window.confirm(
        'You have unsaved pattern edits. Discard them and load a new module?',
      );
      if (!ok) return;
    }
    setModuleHash(computeModuleHash(fileData));
    setCurrentModuleFileName(fileName);
    loadFile(fileData, fileName);
  }, [loadFile, setModuleHash, patternEditDirtyRef]);

  const handleFileSelected = useCallback(async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    setModuleSourceUrl(null);
    loadFileWithHash(data, file.name);
  }, [loadFileWithHash]);

  const activeModuleForSave = useMemo((): SongSaveRequest | null => {
    if (!isModuleLoaded) return null;
    const title = status.replace(/^Loaded "/, '').replace(/"$/, '') || 'Unknown';
    const currentItem = playlistItems[playlistCurrentIndex];
    const fileName = currentItem?.fileName;
    const req: SongSaveRequest = { title };
    if (fileName) req.fileName = fileName;
    const extension = fileName?.split('.').pop()?.trim().toLowerCase();
    if (extension) req.format = extension;
    const numChannels = sequencerMatrix?.numChannels;
    if (numChannels && numChannels > 0) req.channelCount = numChannels;
    return req;
  }, [isModuleLoaded, status, playlistItems, playlistCurrentIndex, sequencerMatrix]);

  return {
    currentModuleFileName,
    moduleSourceUrl,
    setModuleSourceUrl,
    loadFileWithHash,
    handleFileSelected,
    activeModuleForSave,
  };
}
