import { useEffect } from 'react';
import { useRegisterPlayerCommands } from '../hooks/useRegisterPlayerCommands';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { usePlayerEngineInstance } from '../hooks/usePlayerEngine';
import { AVAILABLE_SHADERS, FX_RACK_ENABLED } from '../appConfig';
import { registerEngineCommands } from '../audio/engine/engineCommands';
import { bindMediaSession } from '../audio/engine/mediaSession';
import { useFxStore } from '../store/fxStore';
import { playerCommands, type CommandPayloadMap } from '../utils/playerCommands';
import { preserveWindowScroll } from '../utils/scrollContainer';
import { usePlayerUiStore } from '../store/playerUiStore';
import { useShaderPrefsStore } from '../store/shaderPrefsStore';

const onToggleFullscreen = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
};
const onToggleDebugPanel = () => {
  const ui = usePlayerUiStore.getState();
  ui.setDebugPanelOpen(!ui.debugPanelOpen);
};
const onToggleCheatsheet = () => {
  const ui = usePlayerUiStore.getState();
  ui.setCheatsheetOpen(!ui.cheatsheetOpen);
};
const onCloseCheatsheet = () => usePlayerUiStore.getState().setCheatsheetOpen(false);
const onToggleStageMode = () => usePlayerUiStore.getState().toggleStageMode();
const onExitStageMode = () => {
  const ui = usePlayerUiStore.getState();
  if (ui.stageMode) ui.setStageMode(false);
};
const onShaderSelectByIndex = (index: number) => {
  const pick = AVAILABLE_SHADERS[index % AVAILABLE_SHADERS.length];
  if (pick) useShaderPrefsStore.getState().selectShader(pick.id);
};

// FX rack (#453): commands edit the store; the rack (lazy) follows it.
const onFxToggle = (p: CommandPayloadMap['fx.toggle']) => {
  useFxStore.getState().setModuleEnabled(p.module, p.enabled);
};
const onFxSetParam = (p: CommandPayloadMap['fx.setParam']) => {
  useFxStore.getState().setParam(p.module, p.param, p.value, p.normalized ? { normalized: true } : undefined);
};
const onFxPreset = (p: CommandPayloadMap['fx.preset']) => {
  const fx = useFxStore.getState();
  if (p.presetId !== undefined) fx.applyPreset(p.presetId);
  else if (p.step !== undefined) fx.stepPreset(p.step);
  else if (p.index !== undefined) fx.selectPresetByIndex(p.index);
};

/**
 * Keyboard / MIDI / gamepad / media-key commands. The transport, seek, volume, pan, loop and mute
 * commands go straight to the PlayerEngine (#492); the rest are UI commands that edit the UI stores.
 */
export function useAppKeyboardActions(): void {
  const engine = usePlayerEngineInstance();

  useEffect(
    () => registerEngineCommands(playerCommands, engine, { aroundTransport: preserveWindowScroll }),
    [engine],
  );
  useEffect(() => bindMediaSession(engine, playerCommands), [engine]);

  useRegisterPlayerCommands({
    ...(FX_RACK_ENABLED ? { onFxToggle, onFxSetParam, onFxPreset } : {}),
    onToggleFullscreen,
    onToggleDebugPanel,
    onToggleCheatsheet,
    onCloseCheatsheet,
    onToggleStageMode,
    onExitStageMode,
    onShaderSelectByIndex,
  });

  useKeyboardShortcuts();
}
