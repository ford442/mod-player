/**
 * The command bus → PlayerEngine (#492). Transport, seek, volume, pan, loop and mute commands — from
 * the keyboard, MIDI, a gamepad, the OS media keys — are engine commands now: they are registered once
 * against the engine and dispatched as `EngineCommand`s, instead of each input surface reaching into
 * React hooks. The UI-only commands (fullscreen, help, stage mode, shader, FX rack) stay with the UI
 * (hooks/useRegisterPlayerCommands.ts).
 *
 * Payloads arrive from MIDI and gamepads, so they are validated here; a malformed one is dropped.
 */
import type { CommandHandler, PlayerCommandId } from '../../utils/playerCommands';
import type { EngineCommand, PlayerEngine } from './PlayerEngine';

/** Volume step for volume.up / volume.down (keyboard Shift+↑/↓). */
export const VOLUME_STEP = 0.05;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const finiteField = (payload: unknown, key: string): number | null => {
  if (!isRecord(payload)) return null;
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** Every command the engine handles, and how its payload becomes an EngineCommand (null: drop it). */
export const ENGINE_COMMANDS = {
  'transport.playPause': () => ({ type: 'togglePlayPause' }),
  'transport.play': () => ({ type: 'play' }),
  'transport.pause': () => ({ type: 'pause' }),
  'transport.stop': () => ({ type: 'stop' }),
  'seek.forwardRow': () => ({ type: 'seekRows', delta: 1 }),
  'seek.backwardRow': () => ({ type: 'seekRows', delta: -1 }),
  'seek.nextOrder': () => ({ type: 'seekOrders', delta: 1 }),
  'seek.prevOrder': () => ({ type: 'seekOrders', delta: -1 }),
  'seek.jumpToOrder': (payload) => {
    const order = finiteField(payload, 'order');
    return order === null ? null : { type: 'jumpToOrder', order };
  },
  'volume.up': () => ({ type: 'nudgeVolume', delta: VOLUME_STEP }),
  'volume.down': () => ({ type: 'nudgeVolume', delta: -VOLUME_STEP }),
  'volume.set': (payload) => {
    const value = finiteField(payload, 'value');
    return value === null ? null : { type: 'setVolume', value };
  },
  'pan.set': (payload) => {
    const value = finiteField(payload, 'value');
    return value === null ? null : { type: 'setPan', value };
  },
  'loop.toggle': () => ({ type: 'toggleLoop' }),
  'mute.toggle': () => ({ type: 'toggleMute' }),
} satisfies Partial<Record<PlayerCommandId, (payload: unknown) => EngineCommand | null>>;

export type EngineCommandId = keyof typeof ENGINE_COMMANDS;

export const ENGINE_COMMAND_IDS = Object.keys(ENGINE_COMMANDS) as EngineCommandId[];

export function toEngineCommand(id: EngineCommandId, payload?: unknown): EngineCommand | null {
  return (ENGINE_COMMANDS[id] as (payload: unknown) => EngineCommand | null)(payload);
}

export interface CommandBusLike {
  register<C extends PlayerCommandId>(id: C, handler: CommandHandler<C>): () => void;
}

export interface RegisterEngineCommandsOptions {
  /**
   * Wraps the transport commands' dispatch — the UI passes `preserveWindowScroll`, which undoes a
   * window scroll that starting playback can cause. The engine itself knows nothing about scrolling.
   */
  aroundTransport?: (run: () => void) => void;
}

/** Register the engine commands on the bus; returns the unregister function. */
export function registerEngineCommands(
  bus: CommandBusLike,
  engine: Pick<PlayerEngine, 'dispatch'>,
  options: RegisterEngineCommandsOptions = {},
): () => void {
  const around = options.aroundTransport ?? ((run: () => void) => run());
  const unregister = ENGINE_COMMAND_IDS.map((id) =>
    bus.register(id, (payload: unknown) => {
      const command = toEngineCommand(id, payload);
      if (!command) return;
      if (id.startsWith('transport.')) around(() => engine.dispatch(command));
      else engine.dispatch(command);
    }),
  );
  return () => {
    for (const off of unregister) off();
  };
}
