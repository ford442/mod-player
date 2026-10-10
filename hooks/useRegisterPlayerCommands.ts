import { useEffect, useLayoutEffect, useRef } from 'react';
import { FX_MODULE_IDS } from '../audio/fx/types';
import {
  playerCommands,
  type CommandHandler,
  type CommandPayloadMap,
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
  onToggleStageMode: () => void;
  onExitStageMode: () => void;
  onShaderSelectByIndex?: (index: number) => void;
  onFxToggle?: (payload: CommandPayloadMap['fx.toggle']) => void;
  onFxSetParam?: (payload: CommandPayloadMap['fx.setParam']) => void;
  onFxPreset?: (payload: CommandPayloadMap['fx.preset']) => void;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isFxTarget = (v: unknown): boolean => v === 'rack' || (FX_MODULE_IDS as readonly unknown[]).includes(v);

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
  bind('stage.toggle', () => { handlers.onToggleStageMode(); });
  bind('stage.exit', () => { handlers.onExitStageMode(); });
  if (handlers.onShaderSelectByIndex) {
    bind('shader.selectByIndex', (payload) => {
      if (payload && typeof payload === 'object' && 'index' in payload) {
        handlers.onShaderSelectByIndex!((payload as { index: number }).index);
      }
    });
  }
  // FX rack (#453). Payloads come from MIDI / gamepad too: validate the shape.
  if (handlers.onFxToggle) {
    bind('fx.toggle', (payload) => {
      const raw: unknown = payload;
      if (!isObject(raw) || !isFxTarget(raw.module)) return;
      if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return;
      handlers.onFxToggle!(raw as unknown as CommandPayloadMap['fx.toggle']);
    });
  }
  if (handlers.onFxSetParam) {
    bind('fx.setParam', (payload) => {
      const raw: unknown = payload;
      if (!isObject(raw) || !isFxTarget(raw.module) || raw.module === 'rack') return;
      if (typeof raw.param !== 'string' || typeof raw.value !== 'number' || !Number.isFinite(raw.value)) return;
      handlers.onFxSetParam!(raw as unknown as CommandPayloadMap['fx.setParam']);
    });
  }
  if (handlers.onFxPreset) {
    bind('fx.preset', (payload) => {
      const raw: unknown = payload;
      if (!isObject(raw)) return;
      const ok =
        typeof raw.presetId === 'string' ||
        raw.step === 1 ||
        raw.step === -1 ||
        (typeof raw.index === 'number' && Number.isInteger(raw.index));
      if (ok) handlers.onFxPreset!(raw as unknown as CommandPayloadMap['fx.preset']);
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
      onToggleStageMode: () => handlersRef.current.onToggleStageMode(),
      onExitStageMode: () => handlersRef.current.onExitStageMode(),
      onShaderSelectByIndex: (index) => handlersRef.current.onShaderSelectByIndex?.(index),
      onFxToggle: (payload) => handlersRef.current.onFxToggle?.(payload),
      onFxSetParam: (payload) => handlersRef.current.onFxSetParam?.(payload),
      onFxPreset: (payload) => handlersRef.current.onFxPreset?.(payload),
    });
  }, []);
}
