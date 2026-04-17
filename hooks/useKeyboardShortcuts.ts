import { useEffect, useRef } from 'react';

interface KeyboardShortcutActions {
  onPlayPause: () => void;
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
  onToggleFullscreen: () => void;
  onToggleDebugPanel: () => void;
  onToggleCheatsheet: () => void;
  onCloseCheatsheet: () => void;
  cheatsheetOpen: boolean;
}

export function useKeyboardShortcuts(actions: KeyboardShortcutActions) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if ((e.key === ' ' || e.key === 'Enter') && tag === 'BUTTON') return;
      if (target?.isContentEditable) return;
      if (e.isComposing || e.keyCode === 229) return;
      if ((e.ctrlKey || e.metaKey) && e.key !== 'Escape') return;

      const a = actionsRef.current;
      if (a.cheatsheetOpen && e.key !== 'Escape') {
        e.preventDefault();
        return;
      }

      const digitMatch = e.code.match(/^Digit([1-9])$/);
      if (digitMatch) {
        e.preventDefault();
        a.onJumpToOrder(Number(digitMatch[1]) - 1);
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          a.onPlayPause();
          break;
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
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
