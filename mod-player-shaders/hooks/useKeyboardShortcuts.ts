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
  // Channel mute/solo
  onMuteChannel?: (channel: number) => void;
  onSoloChannel?: (channel: number) => void;
  // Pattern navigation
  onPreviousPattern?: () => void;
  onNextPattern?: () => void;
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
      
      // Number keys 1-9 for channel mute/solo
      const numMatch = e.key.match(/^[1-9]$/);
      if (numMatch) {
        const channel = parseInt(numMatch[0], 10) - 1; // Convert to 0-indexed
        if (e.shiftKey) {
          // Shift+number = solo channel
          e.preventDefault();
          a.onSoloChannel?.(channel);
        } else {
          // Number = toggle mute
          e.preventDefault();
          a.onMuteChannel?.(channel);
        }
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          a.onPlayPause();
          break;
        case 'Escape':
          a.onStop();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            // Ctrl/Cmd+Left = seek backward within pattern
            a.onSeekBackward();
          } else {
            // Left = previous pattern
            a.onPreviousPattern?.();
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            // Ctrl/Cmd+Right = seek forward within pattern
            a.onSeekForward();
          } else {
            // Right = next pattern
            a.onNextPattern?.();
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
        case 'm':
        case 'M':
          // Mute all channels (emergency mute)
          if (e.shiftKey) {
            e.preventDefault();
            for (let i = 0; i < 9; i++) {
              a.onMuteChannel?.(i);
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

export default useKeyboardShortcuts;
