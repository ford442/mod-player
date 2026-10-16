import { describe, expect, it, beforeEach } from 'vitest';
import { playerCommands } from '../utils/playerCommands';
import { matchMidiMapping, DEFAULT_MIDI_MAPPINGS } from '../utils/midiMappings';
import {
  registerPlayerCommands,
  stopOrPause,
  type PlayerCommandHandlers,
} from '../hooks/useRegisterPlayerCommands';

describe('playerCommands', () => {
  beforeEach(() => {
    playerCommands.clear();
    playerCommands.setState({ cheatsheetOpen: false, inputFocused: false, midiEnabled: true });
  });

  it('dispatches registered handlers', () => {
    let called = false;
    playerCommands.register('transport.play', () => { called = true; });
    const result = playerCommands.dispatch('transport.play', 'midi');
    expect(result.handled).toBe(true);
    expect(called).toBe(true);
  });

  it('blocks keyboard when cheatsheet is open', () => {
    let called = false;
    playerCommands.register('transport.playPause', () => { called = true; });
    playerCommands.setState({ cheatsheetOpen: true });
    const result = playerCommands.dispatch('transport.playPause', 'keyboard');
    expect(result.blocked).toBe(true);
    expect(called).toBe(false);
  });

  it('allows MIDI when cheatsheet is open', () => {
    let called = false;
    playerCommands.register('transport.play', () => { called = true; });
    playerCommands.setState({ cheatsheetOpen: true });
    const result = playerCommands.dispatch('transport.play', 'midi');
    expect(result.handled).toBe(true);
    expect(called).toBe(true);
  });

  it('blocks stage.toggle keyboard when cheatsheet is open but allows stage.exit', () => {
    let toggled = false;
    let exited = false;
    playerCommands.register('stage.toggle', () => { toggled = true; });
    playerCommands.register('stage.exit', () => { exited = true; });
    playerCommands.setState({ cheatsheetOpen: true });
    expect(playerCommands.dispatch('stage.toggle', 'keyboard').blocked).toBe(true);
    expect(toggled).toBe(false);
    expect(playerCommands.dispatch('stage.exit', 'keyboard').handled).toBe(true);
    expect(exited).toBe(true);
  });
});

describe('midiMappings', () => {
  it('matches MMC play note', () => {
    const status = 0x99; // note on ch 10
    const matched = matchMidiMapping(DEFAULT_MIDI_MAPPINGS, status, 94, 127);
    expect(matched?.mapping.command).toBe('transport.play');
  });

  it('matches CC volume with scaled payload', () => {
    const status = 0xb0; // cc ch 1
    const matched = matchMidiMapping(DEFAULT_MIDI_MAPPINGS, status, 7, 64);
    expect(matched?.mapping.command).toBe('volume.set');
    expect(matched?.payload).toEqual({ value: 64 / 127 });
  });

  it('matches order pad notes', () => {
    const status = 0x90;
    const matched = matchMidiMapping(DEFAULT_MIDI_MAPPINGS, status, 38, 100);
    expect(matched?.mapping.command).toBe('seek.jumpToOrder');
    expect(matched?.payload).toEqual({ order: 2 });
  });

  describe('default transport mappings', () => {
    const command = (note: number) => matchMidiMapping(DEFAULT_MIDI_MAPPINGS, 0x90, note, 100)?.mapping.command;

    it('MMC Stop (note 93) stops — it no longer pauses', () => {
      expect(command(93)).toBe('transport.stop');
    });

    it('MMC Play (94) plays/resumes and Middle C (60) toggles play/pause', () => {
      expect(command(94)).toBe('transport.play');
      expect(command(60)).toBe('transport.playPause');
    });
  });
});

describe('transport commands (pause / stop)', () => {
  beforeEach(() => {
    playerCommands.clear();
    playerCommands.setState({ cheatsheetOpen: false, inputFocused: false, midiEnabled: true });
  });

  /** A handler set whose every member records its own name when called. */
  function recordingHandlers() {
    const calls: string[] = [];
    const handlers = new Proxy({} as PlayerCommandHandlers, {
      get: (_target, prop: string) => () => { calls.push(prop); },
    });
    return { handlers, calls };
  }

  it('transport.stop reaches onStop and transport.pause reaches only onPause', () => {
    const { handlers, calls } = recordingHandlers();
    const unregister = registerPlayerCommands(handlers);
    playerCommands.dispatch('transport.stop', 'midi');
    playerCommands.dispatch('transport.pause', 'midi');
    expect(calls).toEqual(['onStop', 'onPause']);
    unregister();
  });

  it('stopOrPause calls onStop when the surface has one', () => {
    const seen: string[] = [];
    stopOrPause({ onStop: () => seen.push('onStop'), onPause: () => seen.push('onPause') });
    expect(seen).toEqual(['onStop']);
  });

  it('stopOrPause falls back to onPause for a surface with no onStop', () => {
    // The hook always hands registerPlayerCommands an onStop wrapper, so without this fallback inside
    // the wrapper transport.stop was silently dropped for such a surface.
    const seen: string[] = [];
    stopOrPause({ onPause: () => seen.push('onPause') });
    expect(seen).toEqual(['onPause']);
  });

  it('keyboard transport commands are a no-op while a text input has focus (existing guard)', () => {
    let toggled = 0;
    playerCommands.register('transport.playPause', () => { toggled += 1; });
    playerCommands.setState({ inputFocused: true });
    expect(playerCommands.dispatch('transport.playPause', 'keyboard')).toMatchObject({
      handled: false,
      blocked: true,
      reason: 'input-focused',
    });
    expect(toggled).toBe(0);
    // MIDI and the media session are not keyboard-sourced, so they keep working while typing.
    expect(playerCommands.dispatch('transport.playPause', 'midi').handled).toBe(true);
    expect(playerCommands.dispatch('transport.playPause', 'mediaSession').handled).toBe(true);
    expect(toggled).toBe(2);
  });
});
