/**
 * Central command bus for keyboard, MIDI, gamepad, and future WebHID inputs.
 * Handlers register once; sources dispatch through shared gating rules.
 */

export type CommandSource = 'keyboard' | 'midi' | 'gamepad' | 'mediaSession' | 'ui';

export type PlayerCommandId =
  | 'transport.playPause'
  | 'transport.play'
  | 'transport.pause'
  | 'transport.stop'
  | 'seek.forwardRow'
  | 'seek.backwardRow'
  | 'seek.nextOrder'
  | 'seek.prevOrder'
  | 'seek.jumpToOrder'
  | 'volume.up'
  | 'volume.down'
  | 'volume.set'
  | 'pan.set'
  | 'loop.toggle'
  | 'mute.toggle'
  | 'fullscreen.toggle'
  | 'debug.toggle'
  | 'cheatsheet.toggle'
  | 'cheatsheet.close'
  | 'shader.selectByIndex';

export interface CommandPayloadMap {
  'seek.jumpToOrder': { order: number };
  'volume.set': { value: number };
  'pan.set': { value: number };
  'shader.selectByIndex': { index: number };
}

export type CommandPayload<C extends PlayerCommandId> =
  C extends keyof CommandPayloadMap ? CommandPayloadMap[C] : undefined;

export type CommandHandler<C extends PlayerCommandId = PlayerCommandId> =
  (payload: CommandPayload<C>) => void;

type AnyHandler = (payload: unknown) => void;

export interface CommandDispatchResult {
  handled: boolean;
  blocked: boolean;
  reason?: string;
}

export interface CommandBusState {
  cheatsheetOpen: boolean;
  inputFocused: boolean;
  midiEnabled: boolean;
}

const KEYBOARD_BLOCKED_COMMANDS_WHEN_CHEATSHEET = new Set<PlayerCommandId>([
  'transport.playPause',
  'transport.play',
  'transport.pause',
  'seek.forwardRow',
  'seek.backwardRow',
  'seek.nextOrder',
  'seek.prevOrder',
  'seek.jumpToOrder',
  'volume.up',
  'volume.down',
  'volume.set',
  'pan.set',
  'loop.toggle',
  'mute.toggle',
  'fullscreen.toggle',
  'debug.toggle',
  'cheatsheet.toggle',
  'shader.selectByIndex',
]);

class PlayerCommandBus {
  private handlers = new Map<PlayerCommandId, AnyHandler>();
  private state: CommandBusState = {
    cheatsheetOpen: false,
    inputFocused: false,
    midiEnabled: true,
  };

  setState(patch: Partial<CommandBusState>): void {
    this.state = { ...this.state, ...patch };
  }

  getState(): Readonly<CommandBusState> {
    return this.state;
  }

  register<C extends PlayerCommandId>(id: C, handler: CommandHandler<C>): () => void {
    this.handlers.set(id, handler as AnyHandler);
    return () => {
      if (this.handlers.get(id) === handler) {
        this.handlers.delete(id);
      }
    };
  }

  dispatch<C extends PlayerCommandId>(
    id: C,
    source: CommandSource,
    payload?: CommandPayload<C>,
  ): CommandDispatchResult {
    if (source === 'keyboard') {
      if (this.state.inputFocused) {
        return { handled: false, blocked: true, reason: 'input-focused' };
      }
      if (this.state.cheatsheetOpen && KEYBOARD_BLOCKED_COMMANDS_WHEN_CHEATSHEET.has(id)) {
        return { handled: false, blocked: true, reason: 'cheatsheet-open' };
      }
    }

    if (source === 'midi' && !this.state.midiEnabled) {
      return { handled: false, blocked: true, reason: 'midi-disabled' };
    }

    const handler = this.handlers.get(id);
    if (!handler) {
      return { handled: false, blocked: false, reason: 'no-handler' };
    }

    handler(payload);
    return { handled: true, blocked: false };
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const playerCommands = new PlayerCommandBus();

/** Human-readable labels for shortcuts help + MIDI docs */
export const COMMAND_LABELS: Record<PlayerCommandId, string> = {
  'transport.playPause': 'Play / pause',
  'transport.play': 'Play',
  'transport.pause': 'Pause / stop',
  'transport.stop': 'Stop',
  'seek.forwardRow': 'Seek +1 row',
  'seek.backwardRow': 'Seek −1 row',
  'seek.nextOrder': 'Next order',
  'seek.prevOrder': 'Previous order',
  'seek.jumpToOrder': 'Jump to order',
  'volume.up': 'Volume up',
  'volume.down': 'Volume down',
  'volume.set': 'Set volume',
  'pan.set': 'Set pan',
  'loop.toggle': 'Toggle loop',
  'mute.toggle': 'Mute / unmute',
  'fullscreen.toggle': 'Toggle fullscreen',
  'debug.toggle': 'Toggle debug panel',
  'cheatsheet.toggle': 'Toggle shortcuts help',
  'cheatsheet.close': 'Close shortcuts help',
  'shader.selectByIndex': 'Select shader by program #',
};

export function isTextInputFocused(): boolean {
  const target = document.activeElement as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(target.isContentEditable);
}

export function trackInputFocusForCommands(): () => void {
  const update = () => {
    playerCommands.setState({ inputFocused: isTextInputFocused() });
  };
  update();
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', update);
  return () => {
    document.removeEventListener('focusin', update);
    document.removeEventListener('focusout', update);
  };
}
