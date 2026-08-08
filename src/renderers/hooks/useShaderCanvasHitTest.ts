import { useCallback, useRef, useState } from 'react';
import { getHitTestProfile } from '../../../utils/shaderVersion';
import { dispatchShaderCanvasHitTest, type ShaderCanvasHitTestActions } from './shaderCanvasHitTest';

export interface UseShaderCanvasHitTestParams {
  shaderFile: string;
  playheadRow: number;
  totalRows?: number;
  onPlay?: () => void;
  onStop?: () => void;
  onLoopToggle?: () => void;
  onSeek?: (row: number) => void;
  onVolumeChange?: (volume: number) => void;
  onPanChange?: (pan: number) => void;
  onFileSelected?: (file: File) => void;
}

export function useShaderCanvasHitTest(params: UseShaderCanvasHitTestParams) {
  const {
    shaderFile,
    playheadRow,
    totalRows,
    onPlay,
    onStop,
    onLoopToggle,
    onSeek,
    onVolumeChange,
    onPanChange,
    onFileSelected,
  } = params;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const clickTimeoutRef = useRef<number | null>(null);
  const [clickedButton, setClickedButton] = useState<number>(0);

  const flashButton = useCallback((buttonId: number) => {
    if (clickTimeoutRef.current !== null) window.clearTimeout(clickTimeoutRef.current);
    setClickedButton(buttonId);
    clickTimeoutRef.current = window.setTimeout(() => {
      setClickedButton(0);
      clickTimeoutRef.current = null;
    }, 200) as number;
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const hitProfile = getHitTestProfile(shaderFile);
    if (hitProfile === 'none') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pX = (x / rect.width) - 0.5;
    const pY = 0.5 - (y / rect.height);

    const actions: ShaderCanvasHitTestActions = {
      onOpenFilePicker: () => fileInputRef.current?.click(),
    };
    if (onPlay) actions.onPlay = onPlay;
    if (onStop) actions.onStop = onStop;
    if (onLoopToggle) actions.onLoopToggle = onLoopToggle;
    if (onSeek) actions.onSeek = onSeek;
    if (onVolumeChange) actions.onVolumeChange = onVolumeChange;
    if (onPanChange) actions.onPanChange = onPanChange;

    const buttonId = dispatchShaderCanvasHitTest(
      pX,
      pY,
      {
        hitProfile,
        playheadRow,
        ...(totalRows !== undefined ? { totalRows } : {}),
      },
      actions,
    );
    if (buttonId !== null && buttonId > 0) {
      flashButton(buttonId);
    }
  }, [
    shaderFile, playheadRow, totalRows, onPlay, onStop, onLoopToggle,
    onSeek, onVolumeChange, onPanChange, flashButton,
  ]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) onFileSelected?.(selectedFile);
  }, [onFileSelected]);

  return {
    fileInputRef,
    clickedButton,
    handleCanvasClick,
    handleFileChange,
  };
}
