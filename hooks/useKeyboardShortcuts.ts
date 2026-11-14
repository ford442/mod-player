import { useEffect, useLayoutEffect } from 'react';
import { KEYMAP_PRIORITY, playerCommands, trackInputFocusForCommands } from '../utils/playerCommands';
import { usePlayerUiStore } from '../store/playerUiStore';

/**
 * Keyboard → command bus: the bottom (`global`) layer of the bus's keymap stack. Layers above it
 * (the pattern editor while a cell is selected) consume their keys first. (The OS media keys and `mediaSession.playbackState` follow the engine
 * directly since #492 — audio/engine/mediaSession.ts.)
 */
export function useKeyboardShortcuts() {
  const cheatsheetOpen = usePlayerUiStore((s) => s.cheatsheetOpen);

  useLayoutEffect(() => {
    playerCommands.setState({ cheatsheetOpen });
  }, [cheatsheetOpen]);

  useEffect(() => trackInputFocusForCommands(), []);

  useEffect(() => {
    const route = (
      e: KeyboardEvent,
      dispatch: (id: Parameters<typeof playerCommands.dispatch>[0], payload?: never) => void,
    ): void => {
      if (e.code === 'Space') {
        dispatch('transport.playPause');
        return;
      }

      // Song map (#537): [ / ] step through the order list; Shift+[ / Shift+] mark the loop region's
      // in / out at the current order; \ clears it.
      if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && !e.altKey) {
        if (e.shiftKey) dispatch(e.code === 'BracketLeft' ? 'loop.markStart' : 'loop.markEnd');
        else dispatch(e.code === 'BracketLeft' ? 'seek.prevOrder' : 'seek.nextOrder');
        return;
      }
      if (e.code === 'Backslash' && !e.shiftKey && !e.altKey) {
        dispatch('loop.clearRegion');
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
        case 's':
        case 'S':
          dispatch('stage.toggle');
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
          } else {
            dispatch('stage.exit');
          }
          break;
        default:
          break;
      }
    };


    const handleKeyDown = (e: KeyboardEvent): boolean => {
      if (e.defaultPrevented) return false;
      if (e.isComposing || e.keyCode === 229) return false;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      if ((e.key === ' ' || e.key === 'Enter') && tag === 'BUTTON') return false;
      if ((e.ctrlKey || e.metaKey) && e.key !== 'Escape') return false;

      if (cheatsheetOpen && e.key !== 'Escape') {
        e.preventDefault();
        return true;
      }

      const dispatch = (id: Parameters<typeof playerCommands.dispatch>[0], payload?: never) => {
        const result = playerCommands.dispatch(id, 'keyboard', payload);
        if (result.handled || result.blocked) {
          e.preventDefault();
        }
      };
      route(e, dispatch);
      return e.defaultPrevented;
    };

    return playerCommands.pushKeymapLayer({
      id: 'global',
      priority: KEYMAP_PRIORITY.global,
      onKeyDown: handleKeyDown,
    });
  }, [cheatsheetOpen]);
}
