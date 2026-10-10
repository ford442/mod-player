/** FX rack commands + MIDI (#453): payload validation, labels, CC scaling, channel priority. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPlayerCommands, type PlayerCommandHandlers } from '../hooks/useRegisterPlayerCommands';
import { DEFAULT_MIDI_MAPPINGS, matchMidiMapping, type MidiMapping } from '../utils/midiMappings';
import { COMMAND_LABELS, isTextInputFocused, playerCommands } from '../utils/playerCommands';

const noop = () => {};
function handlers(extra: Partial<PlayerCommandHandlers>): PlayerCommandHandlers {
  return {
    onPlayPause: noop, onPlay: noop, onPause: noop, onSeekForward: noop, onSeekBackward: noop,
    onSeekNextOrder: noop, onSeekPrevOrder: noop, onJumpToOrder: noop, onVolumeUp: noop,
    onVolumeDown: noop, onToggleLoop: noop, onToggleMute: noop, onToggleFullscreen: noop,
    onToggleDebugPanel: noop, onToggleCheatsheet: noop, onCloseCheatsheet: noop,
    onToggleStageMode: noop, onExitStageMode: noop,
    ...extra,
  };
}

afterEach(() => {
  playerCommands.clear();
  playerCommands.setState({ midiEnabled: true, inputFocused: false, cheatsheetOpen: false });
});

describe('fx commands (#453)', () => {
  it('have labels', () => {
    expect(COMMAND_LABELS['fx.toggle']).toBeTruthy();
    expect(COMMAND_LABELS['fx.setParam']).toBeTruthy();
    expect(COMMAND_LABELS['fx.preset']).toBeTruthy();
  });

  it('dispatch well-formed payloads and drop malformed ones', () => {
    const onFxToggle = vi.fn();
    const onFxSetParam = vi.fn();
    const onFxPreset = vi.fn();
    const unregister = registerPlayerCommands(handlers({ onFxToggle, onFxSetParam, onFxPreset }));

    playerCommands.dispatch('fx.toggle', 'midi', { module: 'eq' });
    playerCommands.dispatch('fx.toggle', 'midi', { module: 'rack', enabled: false });
    playerCommands.dispatch('fx.toggle', 'midi', { module: 'nope' } as never);
    expect(onFxToggle.mock.calls).toEqual([[{ module: 'eq' }], [{ module: 'rack', enabled: false }]]);

    playerCommands.dispatch('fx.setParam', 'midi', { module: 'room', param: 'mix', value: 0.5, normalized: true });
    playerCommands.dispatch('fx.setParam', 'midi', { module: 'room', param: 'mix', value: Number.NaN });
    playerCommands.dispatch('fx.setParam', 'midi', { module: 'rack', param: 'mix', value: 1 } as never);
    expect(onFxSetParam).toHaveBeenCalledTimes(1);

    playerCommands.dispatch('fx.preset', 'ui', { step: -1 });
    playerCommands.dispatch('fx.preset', 'ui', { index: 2 });
    playerCommands.dispatch('fx.preset', 'ui', { step: 3 } as never);
    expect(onFxPreset.mock.calls).toEqual([[{ step: -1 }], [{ index: 2 }]]);
    unregister();
  });

  it('are blocked from MIDI when MIDI is disabled', () => {
    const onFxToggle = vi.fn();
    registerPlayerCommands(handlers({ onFxToggle }));
    playerCommands.setState({ midiEnabled: false });
    expect(playerCommands.dispatch('fx.toggle', 'midi', { module: 'eq' }).blocked).toBe(true);
    expect(onFxToggle).not.toHaveBeenCalled();
  });

  it('a focused knob counts as an input, so keyboard shortcuts stand down', () => {
    const knob = { tagName: 'DIV', isContentEditable: false, getAttribute: (n: string) => (n === 'role' ? 'slider' : null) };
    vi.stubGlobal('document', { activeElement: knob });
    expect(isTextInputFocused()).toBe(true);
    vi.stubGlobal('document', { activeElement: { ...knob, getAttribute: () => null } });
    expect(isTextInputFocused()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('fx MIDI mappings (#453)', () => {
  const CC = 0xb0;
  it('default CCs drive room mix, EQ brightness and character drive, normalized', () => {
    expect(matchMidiMapping(DEFAULT_MIDI_MAPPINGS, CC, 91, 127)?.payload).toEqual({
      module: 'room', param: 'mix', value: 1, normalized: true,
    });
    expect(matchMidiMapping(DEFAULT_MIDI_MAPPINGS, CC, 74, 0)?.payload).toEqual({
      module: 'eq', param: 'highGain', value: 0, normalized: true,
    });
    const drive = matchMidiMapping(DEFAULT_MIDI_MAPPINGS, CC, 71, 64)?.payload as { value: number };
    expect(drive.value).toBeCloseTo(64 / 127, 9);
  });

  it('notes toggle modules / step presets; program change selects a preset', () => {
    const mappings: MidiMapping[] = [
      { id: 'n-room', kind: 'noteOn', note: 50, command: 'fx.toggle', fxTarget: { module: 'room' }, noteOnOnly: true },
      { id: 'n-prev', kind: 'noteOn', note: 51, command: 'fx.preset', fxTarget: { module: 'rack', step: -1 }, noteOnOnly: true },
      { id: 'cc-eq', kind: 'cc', controller: 20, command: 'fx.toggle', fxTarget: { module: 'eq' } },
      ...DEFAULT_MIDI_MAPPINGS,
      { id: 'pc-fx', kind: 'programChange', channel: 2, command: 'fx.preset' },
    ];
    expect(matchMidiMapping(mappings, 0x90, 50, 100)?.payload).toEqual({ module: 'room' });
    expect(matchMidiMapping(mappings, 0x90, 51, 100)?.payload).toEqual({ step: -1 });
    expect(matchMidiMapping(mappings, CC, 20, 100)?.payload).toEqual({ module: 'eq', enabled: true });
    expect(matchMidiMapping(mappings, CC, 20, 10)?.payload).toEqual({ module: 'eq', enabled: false });
    // Channel 2 (status 0xC1): the channel-specific FX mapping wins over the any-channel shader one.
    expect(matchMidiMapping(mappings, 0xc1, 3, 0)?.mapping.command).toBe('fx.preset');
    expect(matchMidiMapping(mappings, 0xc0, 3, 0)?.mapping.command).toBe('shader.selectByIndex');
  });
});
