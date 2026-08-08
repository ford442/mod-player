import { useCallback } from 'react';
import { useRegisterPlayerCommands } from '../hooks/useRegisterPlayerCommands';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { AVAILABLE_SHADERS } from '../appConfig';
import type { PatternMatrix } from '../types';

export interface UseAppKeyboardActionsParams {
  isPlaying: boolean;
  stopMusic: (ended?: boolean) => void;
  playGuarded: () => void;
  seekToStep: (step: number) => void;
  playbackRowFraction: number;
  sequencerMatrix: PatternMatrix | null;
  setVolume: React.Dispatch<React.SetStateAction<number>>;
  setPan: React.Dispatch<React.SetStateAction<number>>;
  isMuted: boolean;
  setIsMuted: React.Dispatch<React.SetStateAction<boolean>>;
  volume: number;
  preMuteVolumeRef: React.MutableRefObject<number>;
  setIsLooping: React.Dispatch<React.SetStateAction<boolean>>;
  setDebugPanelOpen: (open: boolean) => void;
  debugPanelOpen: boolean;
  setCheatsheetOpen: (open: boolean) => void;
  cheatsheetOpen: boolean;
  setShaderFile: (shader: string) => void;
}

export function useAppKeyboardActions(params: UseAppKeyboardActionsParams) {
  const {
    isPlaying,
    stopMusic,
    playGuarded,
    seekToStep,
    playbackRowFraction,
    sequencerMatrix,
    setVolume,
    setPan,
    isMuted,
    setIsMuted,
    volume,
    preMuteVolumeRef,
    setIsLooping,
    setDebugPanelOpen,
    debugPanelOpen,
    setCheatsheetOpen,
    cheatsheetOpen,
    setShaderFile,
  } = params;

  const seekByOrderDelta = useCallback((delta: number) => {
    const rowsPerPattern = sequencerMatrix?.numRows ?? 64;
    const currentOrder = sequencerMatrix?.order ?? 0;
    const targetStep = (currentOrder + delta) * rowsPerPattern;
    seekToStep(Math.max(0, targetStep));
  }, [seekToStep, sequencerMatrix]);

  const jumpToOrder = useCallback((orderIndex: number) => {
    const rowsPerPattern = sequencerMatrix?.numRows ?? 64;
    const targetStep = orderIndex * rowsPerPattern;
    seekToStep(Math.max(0, targetStep));
  }, [seekToStep, sequencerMatrix?.numRows]);

  const onKbdPlayPause = useCallback(() => {
    if (isPlaying) { stopMusic(false); } else { playGuarded(); }
  }, [isPlaying, stopMusic, playGuarded]);

  const onKbdPlay = useCallback(() => { playGuarded(); }, [playGuarded]);
  const onKbdPause = useCallback(() => { stopMusic(false); }, [stopMusic]);

  const onKbdSeekForward = useCallback(() => seekToStep(Math.floor(playbackRowFraction) + 1),
    [seekToStep, playbackRowFraction]);
  const onKbdSeekBackward = useCallback(() => seekToStep(Math.max(0, Math.floor(playbackRowFraction) - 1)),
    [seekToStep, playbackRowFraction]);

  const onKbdVolumeUp = useCallback(() => setVolume(v => Math.min(1, v + 0.05)), [setVolume]);
  const onKbdVolumeDown = useCallback(() => setVolume(v => Math.max(0, v - 0.05)), [setVolume]);

  const onKbdToggleMute = useCallback(() => {
    if (isMuted) {
      setVolume(preMuteVolumeRef.current > 0 ? preMuteVolumeRef.current : 0.5);
      setIsMuted(false);
    } else {
      preMuteVolumeRef.current = volume;
      setVolume(0);
      setIsMuted(true);
    }
  }, [isMuted, volume, preMuteVolumeRef, setVolume, setIsMuted]);

  const onKbdToggleLoop = useCallback(() => setIsLooping(l => !l), [setIsLooping]);

  const onKbdToggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }, []);

  const onKbdSeekNextOrder = useCallback(() => seekByOrderDelta(1), [seekByOrderDelta]);
  const onKbdSeekPrevOrder = useCallback(() => seekByOrderDelta(-1), [seekByOrderDelta]);
  const onKbdToggleDebugPanel = useCallback(() => setDebugPanelOpen(!debugPanelOpen), [setDebugPanelOpen, debugPanelOpen]);
  const onKbdToggleCheatsheet = useCallback(() => setCheatsheetOpen(!cheatsheetOpen), [setCheatsheetOpen, cheatsheetOpen]);
  const onKbdCloseCheatsheet = useCallback(() => setCheatsheetOpen(false), [setCheatsheetOpen]);

  const onKbdVolumeSet = useCallback((value: number) => setVolume(Math.max(0, Math.min(1, value))), [setVolume]);
  const onKbdPanSet = useCallback((value: number) => setPan(Math.max(-1, Math.min(1, value))), [setPan]);
  const onKbdShaderSelectByIndex = useCallback((index: number) => {
    const pick = AVAILABLE_SHADERS[index % AVAILABLE_SHADERS.length];
    if (pick) setShaderFile(pick.id);
  }, [setShaderFile]);

  useRegisterPlayerCommands({
    onPlayPause: onKbdPlayPause,
    onPlay: onKbdPlay,
    onPause: onKbdPause,
    onSeekForward: onKbdSeekForward,
    onSeekBackward: onKbdSeekBackward,
    onSeekNextOrder: onKbdSeekNextOrder,
    onSeekPrevOrder: onKbdSeekPrevOrder,
    onJumpToOrder: jumpToOrder,
    onVolumeUp: onKbdVolumeUp,
    onVolumeDown: onKbdVolumeDown,
    onVolumeSet: onKbdVolumeSet,
    onPanSet: onKbdPanSet,
    onToggleMute: onKbdToggleMute,
    onToggleLoop: onKbdToggleLoop,
    onToggleFullscreen: onKbdToggleFullscreen,
    onToggleDebugPanel: onKbdToggleDebugPanel,
    onToggleCheatsheet: onKbdToggleCheatsheet,
    onCloseCheatsheet: onKbdCloseCheatsheet,
    onShaderSelectByIndex: onKbdShaderSelectByIndex,
  });

  useKeyboardShortcuts({ cheatsheetOpen });
}
