import { useEffect, useLayoutEffect } from 'react';
import { playerCommands, trackInputFocusForCommands } from '../utils/playerCommands';

interface KeyboardShortcutOptions {
  cheatsheetOpen: boolean;
}

export function useKeyboardShortcuts({ cheatsheetOpen }: KeyboardShortcutOptions) {
  useLayoutEffect(() => {
    playerCommands.setState({ cheatsheetOpen });
  }, [cheatsheetOpen]);

  useEffect(() => trackInputFocusForCommands(), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      if ((e.key === ' ' || e.key === 'Enter') && tag === 'BUTTON') return;
      if ((e.ctrlKey || e.metaKey) && e.key !== 'Escape') return;

      if (cheatsheetOpen && e.key !== 'Escape') {
        e.preventDefault();
        return;
      }

      const dispatch = (id: Parameters<typeof playerCommands.dispatch>[0], payload?: never) => {
        const result = playerCommands.dispatch(id, 'keyboard', payload);
        if (result.handled || result.blocked) {
          e.preventDefault();
        }
      };

      if (e.code === 'Space') {
        dispatch('transport.playPause');
        return;
      }

      const digitMatch = e.code.match(/^Digit([1-9])$/);
      if (digitMatch) {
        dispatch('seek.jumpToOrder', { order: Number(digitMatch[1]) - 1 } as never);
        return;
      }

      switch (e.key) {
        case 'ArrowRight':
          if (e.shiftKey) dispatch('seek.nextOrder');
          else dispatch('seek.forwardRow');
          break;
        case 'ArrowLeft':
          if (e.shiftKey) dispatch('seek.prevOrder');
          else dispatch('seek.backwardRow');
          break;
        case 'ArrowUp':
          if (e.shiftKey) dispatch('volume.up');
          else dispatch('seek.prevOrder');
          break;
        case 'ArrowDown':
          if (e.shiftKey) dispatch('volume.down');
          else dispatch('seek.nextOrder');
          break;
        case 'l':
        case 'L':
          dispatch('loop.toggle');
          break;
        case 'm':
        case 'M':
          dispatch('mute.toggle');
          break;
        case 'f':
        case 'F':
          dispatch('fullscreen.toggle');
          break;
        case 'd':
        case 'D':
          dispatch('debug.toggle');
          break;
        case '?':
          dispatch('cheatsheet.toggle');
          break;
        case '/':
          if (e.shiftKey && e.code === 'Slash') {
            dispatch('cheatsheet.toggle');
          }
          break;
        case 'Escape':
          if (cheatsheetOpen) {
            dispatch('cheatsheet.close');
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        playerCommands.dispatch('transport.play', 'mediaSession');
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        playerCommands.dispatch('transport.pause', 'mediaSession');
      });
      navigator.mediaSession.setActionHandler('seekforward', () => {
        playerCommands.dispatch('seek.forwardRow', 'mediaSession');
      });
      navigator.mediaSession.setActionHandler('seekbackward', () => {
        playerCommands.dispatch('seek.backwardRow', 'mediaSession');
      });
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
  }, [cheatsheetOpen]);
}
