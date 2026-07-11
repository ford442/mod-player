import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  playerCommands,
  type CommandHandler,
  type PlayerCommandId,
} from '../utils/playerCommands';

export interface PlayerCommandHandlers {
  onPlayPause: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop?: () => void;
  onSeekForward: () => void;
  onSeekBackward: () => void;
  onSeekNextOrder: () => void;
  onSeekPrevOrder: () => void;
  onJumpToOrder: (order: number) => void;
  onVolumeUp: () => void;
  onVolumeDown: () => void;
  onVolumeSet?: (value: number) => void;
  onPanSet?: (value: number) => void;
  onToggleLoop: () => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onToggleDebugPanel: () => void;
  onToggleCheatsheet: () => void;
  onCloseCheatsheet: () => void;
  onShaderSelectByIndex?: (index: number) => void;
}

/** Register all player command handlers on the shared command bus. */
export function registerPlayerCommands(handlers: PlayerCommandHandlers): () => void {
  const unsubs: Array<() => void> = [];

  const bind = <C extends PlayerCommandId>(
    id: C,
    handler: CommandHandler<C>,
  ) => {
    unsubs.push(playerCommands.register(id, handler));
  };

  bind('transport.playPause', () => { handlers.onPlayPause(); });
  bind('transport.play', () => { handlers.onPlay(); });
  bind('transport.pause', () => { handlers.onPause(); });
  bind('transport.stop', () => {
    if (handlers.onStop) handlers.onStop();
    else handlers.onPause();
  });
  bind('seek.forwardRow', () => { handlers.onSeekForward(); });
  bind('seek.backwardRow', () => { handlers.onSeekBackward(); });
  bind('seek.nextOrder', () => { handlers.onSeekNextOrder(); });
  bind('seek.prevOrder', () => { handlers.onSeekPrevOrder(); });
  bind('seek.jumpToOrder', (payload) => {
    if (payload && typeof payload === 'object' && 'order' in payload) {
      handlers.onJumpToOrder((payload as { order: number }).order);
    }
  });
  bind('volume.up', () => { handlers.onVolumeUp(); });
  bind('volume.down', () => { handlers.onVolumeDown(); });
  if (handlers.onVolumeSet) {
    bind('volume.set', (payload) => {
      if (payload && typeof payload === 'object' && 'value' in payload) {
        handlers.onVolumeSet!((payload as { value: number }).value);
      }
    });
  }
  if (handlers.onPanSet) {
    bind('pan.set', (payload) => {
      if (payload && typeof payload === 'object' && 'value' in payload) {
        handlers.onPanSet!((payload as { value: number }).value);
      }
    });
  }
  bind('loop.toggle', () => { handlers.onToggleLoop(); });
  bind('mute.toggle', () => { handlers.onToggleMute(); });
  bind('fullscreen.toggle', () => { handlers.onToggleFullscreen(); });
  bind('debug.toggle', () => { handlers.onToggleDebugPanel(); });
  bind('cheatsheet.toggle', () => { handlers.onToggleCheatsheet(); });
  bind('cheatsheet.close', () => { handlers.onCloseCheatsheet(); });
  if (handlers.onShaderSelectByIndex) {
    bind('shader.selectByIndex', (payload) => {
      if (payload && typeof payload === 'object' && 'index' in payload) {
        handlers.onShaderSelectByIndex!((payload as { index: number }).index);
      }
    });
  }

  return () => {
    for (const unsub of unsubs) unsub();
  };
}

export function useRegisterPlayerCommands(handlers: PlayerCommandHandlers): void {
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    return registerPlayerCommands({
      onPlayPause: () => handlersRef.current.onPlayPause(),
      onPlay: () => handlersRef.current.onPlay(),
      onPause: () => handlersRef.current.onPause(),
      onStop: () => handlersRef.current.onStop?.(),
      onSeekForward: () => handlersRef.current.onSeekForward(),
      onSeekBackward: () => handlersRef.current.onSeekBackward(),
      onSeekNextOrder: () => handlersRef.current.onSeekNextOrder(),
      onSeekPrevOrder: () => handlersRef.current.onSeekPrevOrder(),
      onJumpToOrder: (order) => handlersRef.current.onJumpToOrder(order),
      onVolumeUp: () => handlersRef.current.onVolumeUp(),
      onVolumeDown: () => handlersRef.current.onVolumeDown(),
      onVolumeSet: (value) => handlersRef.current.onVolumeSet?.(value),
      onPanSet: (value) => handlersRef.current.onPanSet?.(value),
      onToggleLoop: () => handlersRef.current.onToggleLoop(),
      onToggleMute: () => handlersRef.current.onToggleMute(),
      onToggleFullscreen: () => handlersRef.current.onToggleFullscreen(),
      onToggleDebugPanel: () => handlersRef.current.onToggleDebugPanel(),
      onToggleCheatsheet: () => handlersRef.current.onToggleCheatsheet(),
      onCloseCheatsheet: () => handlersRef.current.onCloseCheatsheet(),
      onShaderSelectByIndex: (index) => handlersRef.current.onShaderSelectByIndex?.(index),
    });
  }, []);
}
