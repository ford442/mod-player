import { useEffect, useRef } from 'react';

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
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const a = actionsRef.current;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          a.onPlayPause();
          break;
        case 'Escape':
          a.onStop();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) {
            a.onNextTrack();
          } else {
            a.onSeekForward();
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) {
            a.onPrevTrack();
          } else {
            a.onSeekBackward();
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          a.onVolumeUp();
          break;
        case 'ArrowDown':
          e.preventDefault();
          a.onVolumeDown();
          break;
        case 'l':
        case 'L':
          a.onToggleLoop();
          break;
        case 'f':
        case 'F':
          a.onToggleFullscreen();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
