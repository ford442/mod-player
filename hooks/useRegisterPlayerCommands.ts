import { useEffect, useLayoutEffect, useRef } from 'react';
import { FX_MODULE_IDS } from '../audio/fx/types';
import {
  playerCommands,
  type CommandHandler,
  type CommandPayloadMap,
  type PlayerCommandId,
} from '../utils/playerCommands';

/**
 * The UI's commands. Transport, seek, volume, pan, loop and mute are engine commands, registered once
 * against the PlayerEngine (audio/engine/engineCommands.ts, #492).
 */
export interface PlayerCommandHandlers {
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

/** Register the UI command handlers on the shared command bus. */
export function registerPlayerCommands(handlers: PlayerCommandHandlers): () => void {
  const unsubs: Array<() => void> = [];

  const bind = <C extends PlayerCommandId>(
    id: C,
    handler: CommandHandler<C>,
  ) => {
    unsubs.push(playerCommands.register(id, handler));
  };

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
