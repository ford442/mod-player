import { useEffect, useCallback } from 'react';

interface KeyboardShortcutActions {
  onPlayPause: () => void;
  onStop: () => void;
  onSeekForward: () => void;
  onSeekBackward: () => void;
  onVolumeUp: () => void;
  onVolumeDown: () => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
  onToggleLoop: () => void;
  onToggleFullscreen: () => void;
}

export function useKeyboardShortcuts(actions: KeyboardShortcutActions) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't capture when typing in inputs
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        actions.onPlayPause();
        break;
      case 'Escape':
        actions.onStop();
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) {
          actions.onNextTrack();
        } else {
          actions.onSeekForward();
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) {
          actions.onPrevTrack();
        } else {
          actions.onSeekBackward();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        actions.onVolumeUp();
        break;
      case 'ArrowDown':
        e.preventDefault();
        actions.onVolumeDown();
        break;
      case 'l':
      case 'L':
        actions.onToggleLoop();
        break;
      case 'f':
      case 'F':
        actions.onToggleFullscreen();
        break;
    }
  }, [actions]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
