import { useEffect, useLayoutEffect, useRef } from 'react';

interface KeyboardShortcutActions {
  onPlayPause: () => void;
  onPlay: () => void;
  onPause: () => void;
  onSeekForward: () => void;
  onSeekBackward: () => void;
  onSeekNextOrder: () => void;
  onSeekPrevOrder: () => void;
  onPreviousOrder: () => void;
  onNextOrder: () => void;
  onJumpToOrder: (orderIndex: number) => void;
  onVolumeUp: () => void;
  onVolumeDown: () => void;
  onToggleLoop: () => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onToggleDebugPanel: () => void;
  onToggleCheatsheet: () => void;
  onCloseCheatsheet: () => void;
  cheatsheetOpen: boolean;
}

export function useKeyboardShortcuts(callbacks: KeyboardShortcutActions) {
  const callbacksRef = useRef(callbacks);
  useLayoutEffect(() => { callbacksRef.current = callbacks; });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Focus guard
      if (e.isComposing || e.keyCode === 229) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target?.isContentEditable) return;
      if ((e.key === ' ' || e.key === 'Enter') && tag === 'BUTTON') return;
      if ((e.ctrlKey || e.metaKey) && e.key !== 'Escape') return;

      const a = callbacksRef.current;
      if (a.cheatsheetOpen && e.key !== 'Escape') {
        e.preventDefault();
        return;
      }

      // Space — use event.code for layout independence
      if (e.code === 'Space') {
        e.preventDefault();
        a.onPlayPause();
        return;
      }

      // Digit 1–9 → jump to order 0–8
      const digitMatch = e.code.match(/^Digit([1-9])$/);
      if (digitMatch) {
        e.preventDefault();
        a.onJumpToOrder(Number(digitMatch[1]) - 1);
        return;
      }

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) {
            a.onSeekNextOrder();
          } else {
            a.onSeekForward();
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) {
            a.onSeekPrevOrder();
          } else {
            a.onSeekBackward();
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (e.shiftKey) {
            a.onVolumeUp();
          } else {
            a.onPreviousOrder();
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (e.shiftKey) {
            a.onVolumeDown();
          } else {
            a.onNextOrder();
          }
          break;
        case 'l':
        case 'L':
          a.onToggleLoop();
          break;
        case 'm':
        case 'M':
          a.onToggleMute();
          break;
        case 'f':
        case 'F':
          a.onToggleFullscreen();
          break;
        case 'd':
        case 'D':
          e.preventDefault();
          a.onToggleDebugPanel();
          break;
        case '?':
          e.preventDefault();
          a.onToggleCheatsheet();
          break;
        case '/':
          if (e.shiftKey && e.code === 'Slash') {
            e.preventDefault();
            a.onToggleCheatsheet();
          }
          break;
        case 'Escape':
          if (a.cheatsheetOpen) {
            e.preventDefault();
            a.onCloseCheatsheet();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Media Session API — lets OS media keys / lock-screen controls work
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => callbacksRef.current.onPlay());
      navigator.mediaSession.setActionHandler('pause', () => callbacksRef.current.onPause());
      navigator.mediaSession.setActionHandler('seekforward', () => callbacksRef.current.onSeekForward());
      navigator.mediaSession.setActionHandler('seekbackward', () => callbacksRef.current.onSeekBackward());
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
      }
    };
  }, []);
}
