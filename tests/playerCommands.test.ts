import { describe, expect, it, beforeEach } from 'vitest';
import { playerCommands } from '../utils/playerCommands';
import { matchMidiMapping, DEFAULT_MIDI_MAPPINGS } from '../utils/midiMappings';

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
});
