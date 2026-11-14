/**
 * Keymap layer stack (utils/playerCommands.ts): a focused pattern editor's layer consumes its keys
 * before the global shortcuts see them, so a note key typed into a cell no longer also toggles
 * stage mode / the debug panel / mute. Plus the undo / redo chord (Shift+Z arrives as 'Z').
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYMAP_PRIORITY, playerCommands } from '../../utils/playerCommands';
import { isEditorPassThroughKey, patternUndoRedoAction } from '../../utils/patternEdit';

function keyEvent(key: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    code: extra.code ?? `Key${key.toUpperCase()}`,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: null,
    defaultPrevented: false,
    ...extra,
  } as KeyboardEvent;
}

describe('keymap layers', () => {
  beforeEach(() => {
    playerCommands.clear();
  });
  afterEach(() => {
    playerCommands.clear();
    vi.unstubAllGlobals();
  });

  it('offers a key to the editor layer before the global layer', () => {
    const seen: string[] = [];
    playerCommands.pushKeymapLayer({
      id: 'global', priority: KEYMAP_PRIORITY.global, onKeyDown: () => { seen.push('global'); return true; },
    });
    playerCommands.pushKeymapLayer({
      id: 'pattern-editor', priority: KEYMAP_PRIORITY.editor, onKeyDown: () => { seen.push('editor'); return true; },
    });
    expect(playerCommands.routeKeyDown(keyEvent('s'))).toBe(true);
    expect(seen).toEqual(['editor']);
  });

  it('keeps priority order even when the global layer is re-pushed later', () => {
    const popEditor = playerCommands.pushKeymapLayer({
      id: 'pattern-editor', priority: KEYMAP_PRIORITY.editor, onKeyDown: () => true,
    });
    // useKeyboardShortcuts re-pushes its layer whenever the cheatsheet opens / closes.
    playerCommands.pushKeymapLayer({ id: 'global', priority: KEYMAP_PRIORITY.global, onKeyDown: () => true });
    expect(playerCommands.keymapLayerIds()).toEqual(['pattern-editor', 'global']);
    popEditor();
    expect(playerCommands.keymapLayerIds()).toEqual(['global']);
  });

  it('falls through to the layer below when a layer does not consume', () => {
    let globalSaw = '';
    playerCommands.pushKeymapLayer({
      id: 'global', priority: KEYMAP_PRIORITY.global, onKeyDown: (e) => { globalSaw = e.key; return true; },
    });
    playerCommands.pushKeymapLayer({
      id: 'pattern-editor', priority: KEYMAP_PRIORITY.editor, onKeyDown: (e) => !isEditorPassThroughKey(e),
    });
    playerCommands.routeKeyDown(keyEvent('d'));
    expect(globalSaw).toBe('');
    playerCommands.routeKeyDown(keyEvent(' ', { code: 'Space' }));
    expect(globalSaw).toBe(' ');
  });

  it('listens on window only while a layer exists', () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    const remove = vi.spyOn(target, 'removeEventListener');
    vi.stubGlobal('window', target);
    const popA = playerCommands.pushKeymapLayer({ id: 'a', priority: 0, onKeyDown: () => false });
    const popB = playerCommands.pushKeymapLayer({ id: 'b', priority: 1, onKeyDown: () => false });
    expect(add).toHaveBeenCalledTimes(1);
    popA();
    expect(remove).not.toHaveBeenCalled();
    popB();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('routes a real window keydown through the stack', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const keys: string[] = [];
    playerCommands.pushKeymapLayer({ id: 'g', priority: 0, onKeyDown: (e) => { keys.push(e.key); return true; } });
    const event = Object.assign(new Event('keydown'), { key: 'm', code: 'KeyM' });
    target.dispatchEvent(event);
    expect(keys).toEqual(['m']);
  });
});

describe('editor pass-through keys', () => {
  it('lets Space, Escape and ? through', () => {
    expect(isEditorPassThroughKey(keyEvent(' ', { code: 'Space' }))).toBe(true);
    expect(isEditorPassThroughKey(keyEvent('Escape', { code: 'Escape' }))).toBe(true);
    expect(isEditorPassThroughKey(keyEvent('?', { code: 'Slash' }))).toBe(true);
    for (const key of ['s', 'd', 'm', 'f', '1', 'ArrowUp']) {
      expect(isEditorPassThroughKey(keyEvent(key))).toBe(false);
    }
  });
});

describe('patternUndoRedoAction', () => {
  it('undoes on Ctrl/⌘+Z', () => {
    expect(patternUndoRedoAction(keyEvent('z', { ctrlKey: true }))).toBe('undo');
    expect(patternUndoRedoAction(keyEvent('z', { metaKey: true }))).toBe('undo');
  });

  it('redoes on Ctrl+Shift+Z, where the key arrives upper-case', () => {
    expect(patternUndoRedoAction(keyEvent('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(patternUndoRedoAction(keyEvent('Z', { metaKey: true, shiftKey: true }))).toBe('redo');
  });

  it('redoes on Ctrl+Y', () => {
    expect(patternUndoRedoAction(keyEvent('y', { ctrlKey: true }))).toBe('redo');
  });

  it('ignores unmodified keys and text fields', () => {
    expect(patternUndoRedoAction(keyEvent('z'))).toBeNull();
    const input = { tagName: 'INPUT' } as unknown as EventTarget;
    expect(patternUndoRedoAction(keyEvent('z', { ctrlKey: true, target: input }))).toBeNull();
    const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;
    expect(patternUndoRedoAction(keyEvent('z', { ctrlKey: true, target: editable }))).toBeNull();
  });
});
