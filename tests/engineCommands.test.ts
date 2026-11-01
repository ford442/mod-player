/**
 * #492: the command bus → PlayerEngine. Transport / seek / volume / pan / loop / mute commands from any
 * input surface become EngineCommands (payloads from MIDI and gamepads validated), and the OS media
 * session follows the engine's transport.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENGINE_COMMAND_IDS,
  VOLUME_STEP,
  registerEngineCommands,
} from '../audio/engine/engineCommands';
import { bindMediaSession } from '../audio/engine/mediaSession';
import type { EngineCommand, PlayerSnapshot } from '../audio/engine/PlayerEngine';
import { playerCommands } from '../utils/playerCommands';

function fakeEngine() {
  const commands: EngineCommand[] = [];
  return { commands, dispatch: (command: EngineCommand) => { commands.push(command); } };
}

describe('registerEngineCommands', () => {
  beforeEach(() => {
    playerCommands.clear();
    playerCommands.setState({ cheatsheetOpen: false, inputFocused: false, midiEnabled: true });
  });

  it('maps every engine command id to its EngineCommand', () => {
    const engine = fakeEngine();
    const off = registerEngineCommands(playerCommands, engine);
    playerCommands.dispatch('transport.playPause', 'keyboard');
    playerCommands.dispatch('transport.play', 'midi');
    playerCommands.dispatch('transport.pause', 'midi');
    playerCommands.dispatch('transport.stop', 'midi');
    playerCommands.dispatch('seek.forwardRow', 'keyboard');
    playerCommands.dispatch('seek.backwardRow', 'keyboard');
    playerCommands.dispatch('seek.nextOrder', 'keyboard');
    playerCommands.dispatch('seek.prevOrder', 'keyboard');
    playerCommands.dispatch('seek.jumpToOrder', 'midi', { order: 3 });
    playerCommands.dispatch('volume.up', 'keyboard');
    playerCommands.dispatch('volume.down', 'keyboard');
    playerCommands.dispatch('volume.set', 'midi', { value: 0.5 });
    playerCommands.dispatch('pan.set', 'midi', { value: -0.5 });
    playerCommands.dispatch('loop.toggle', 'keyboard');
    playerCommands.dispatch('mute.toggle', 'keyboard');
    expect(engine.commands).toEqual([
      { type: 'togglePlayPause' },
      { type: 'play' },
      { type: 'pause' },
      // MMC Stop is a real stop since #461 — not an alias of pause.
      { type: 'stop' },
      { type: 'seekRows', delta: 1 },
      { type: 'seekRows', delta: -1 },
      { type: 'seekOrders', delta: 1 },
      { type: 'seekOrders', delta: -1 },
      { type: 'jumpToOrder', order: 3 },
      { type: 'nudgeVolume', delta: VOLUME_STEP },
      { type: 'nudgeVolume', delta: -VOLUME_STEP },
      { type: 'setVolume', value: 0.5 },
      { type: 'setPan', value: -0.5 },
      { type: 'toggleLoop' },
      { type: 'toggleMute' },
    ]);
    expect(engine.commands).toHaveLength(ENGINE_COMMAND_IDS.length);
    off();
  });

  it('drops malformed payloads (MIDI / gamepad input is untrusted)', () => {
    const engine = fakeEngine();
    registerEngineCommands(playerCommands, engine);
    playerCommands.dispatch('seek.jumpToOrder', 'midi', {} as never);
    playerCommands.dispatch('seek.jumpToOrder', 'midi', { order: '2' } as never);
    playerCommands.dispatch('volume.set', 'midi', { value: Number.NaN });
    playerCommands.dispatch('pan.set', 'midi', undefined as never);
    expect(engine.commands).toEqual([]);
  });

  it('wraps only the transport commands in aroundTransport (the UI scroll guard)', () => {
    const engine = fakeEngine();
    const around = vi.fn((run: () => void) => run());
    registerEngineCommands(playerCommands, engine, { aroundTransport: around });
    playerCommands.dispatch('transport.play', 'keyboard');
    playerCommands.dispatch('volume.up', 'keyboard');
    expect(around).toHaveBeenCalledTimes(1);
    expect(engine.commands).toHaveLength(2);
  });

  it('keeps the bus gating: keyboard is blocked while typing, MIDI is not', () => {
    const engine = fakeEngine();
    registerEngineCommands(playerCommands, engine);
    playerCommands.setState({ inputFocused: true });
    expect(playerCommands.dispatch('transport.playPause', 'keyboard').blocked).toBe(true);
    expect(playerCommands.dispatch('transport.playPause', 'midi').handled).toBe(true);
    expect(engine.commands).toEqual([{ type: 'togglePlayPause' }]);
  });

  it('unregisters everything it registered', () => {
    const engine = fakeEngine();
    const off = registerEngineCommands(playerCommands, engine);
    off();
    for (const id of ENGINE_COMMAND_IDS) {
      expect(playerCommands.dispatch(id, 'midi', { order: 0, value: 0 } as never).reason).toBe('no-handler');
    }
  });
});

describe('bindMediaSession', () => {
  let session: { playbackState: string; setActionHandler: ReturnType<typeof vi.fn> };
  const handlers = new Map<string, (() => void) | null>();

  beforeEach(() => {
    handlers.clear();
    session = {
      playbackState: 'none',
      setActionHandler: vi.fn((action: string, handler: (() => void) | null) => { handlers.set(action, handler); }),
    };
    vi.stubGlobal('navigator', { mediaSession: session });
  });
  afterEach(() => vi.unstubAllGlobals());

  function engineWith(transportState: PlayerSnapshot['transportState']) {
    let snapshot = { transportState } as PlayerSnapshot;
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => snapshot,
      subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
      set(state: PlayerSnapshot['transportState']) {
        snapshot = { transportState: state } as PlayerSnapshot;
        for (const l of listeners) l();
      },
      listenerCount: () => listeners.size,
    };
  }

  it('mirrors the transport to playbackState — paused stays "paused", not "none"', () => {
    const engine = engineWith('stopped');
    const unbind = bindMediaSession(engine, { dispatch: vi.fn() });
    expect(session.playbackState).toBe('none');
    engine.set('playing');
    expect(session.playbackState).toBe('playing');
    engine.set('paused');
    expect(session.playbackState).toBe('paused');
    unbind();
    expect(engine.listenerCount()).toBe(0);
  });

  it('routes the media keys through the bus as source "mediaSession", and unbinds them', () => {
    const dispatch = vi.fn();
    const unbind = bindMediaSession(engineWith('stopped'), { dispatch });
    handlers.get('play')?.();
    handlers.get('pause')?.();
    handlers.get('seekforward')?.();
    handlers.get('seekbackward')?.();
    expect(dispatch.mock.calls).toEqual([
      ['transport.play', 'mediaSession'],
      ['transport.pause', 'mediaSession'],
      ['seek.forwardRow', 'mediaSession'],
      ['seek.backwardRow', 'mediaSession'],
    ]);
    unbind();
    expect([...handlers.values()].every((h) => h === null)).toBe(true);
  });
});
