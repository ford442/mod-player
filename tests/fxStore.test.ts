/** FX store (#453): persistence, per-song overrides, presets, edits. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function installMemoryLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const memory = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true, writable: true });
  Object.defineProperty(window, 'localStorage', { value: memory, configurable: true, writable: true });
  if (typeof window.dispatchEvent !== 'function') {
    Object.defineProperty(window, 'dispatchEvent', { value: () => true, configurable: true });
  }
  if (typeof globalThis.StorageEvent !== 'function') {
    (globalThis as unknown as { StorageEvent: unknown }).StorageEvent = class {
      constructor(
        public type: string,
        public init?: unknown,
      ) {}
    };
  }
  return store;
}

async function loadStore() {
  vi.resetModules();
  const mod = await import('../store/fxStore');
  const identity = await import('../utils/songIdentity');
  return { ...mod, identity };
}

let storage: Map<string, string>;

beforeEach(() => {
  storage = installMemoryLocalStorage();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fxStore (#453)', () => {
  it('starts bypassed with nothing saved, and edits the global state', async () => {
    const { useFxStore } = await loadStore();
    const s = useFxStore.getState();
    expect(s.scope).toBe('global');
    expect(s.exportSnapshot()).toBeNull();
    s.setModuleEnabled('eq');
    s.setParam('eq', 'lowGain', 40); // clamped
    const next = useFxStore.getState();
    expect(next.effective.modules.eq.enabled).toBe(true);
    expect(next.effective.modules.eq.params.lowGain).toBe(12);
    expect(next.globalPresetId).toBe('custom');
    expect(next.exportSnapshot()?.modules.eq.enabled).toBe(true);
  });

  it('persists (debounced) and survives a reload', async () => {
    const { useFxStore, FX_STORAGE_KEY, FX_PERSIST_DEBOUNCE_MS } = await loadStore();
    useFxStore.getState().applyPreset('tape-glue');
    useFxStore.getState().setParam('character', 'drive', 0.8);
    expect(storage.has(FX_STORAGE_KEY)).toBe(false); // not yet: debounced
    vi.advanceTimersByTime(FX_PERSIST_DEBOUNCE_MS);
    expect(storage.has(FX_STORAGE_KEY)).toBe(true);

    const reloaded = (await loadStore()).useFxStore.getState();
    expect(reloaded.effective.modules.character.enabled).toBe(true);
    expect(reloaded.effective.modules.character.params.drive).toBe(0.8);
    expect(reloaded.globalPresetId).toBe('custom');
  });

  it('ignores corrupt or foreign saved data', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.set('xasm1_fx_rack', JSON.stringify({ version: 7, nonsense: true }));
    const { useFxStore } = await loadStore();
    expect(useFxStore.getState().effective.modules.eq.enabled).toBe(false);
    expect(warn).toHaveBeenCalled();
    storage.set('xasm1_fx_rack', '{not json');
    expect((await loadStore()).useFxStore.getState().scope).toBe('global');
  });

  it('a song override takes precedence, is edited in place, and resets to global', async () => {
    const { useFxStore } = await loadStore();
    const s = useFxStore.getState();
    s.applyPreset('club');
    s.setSongFingerprint('sha256:aaa');
    expect(useFxStore.getState().scope).toBe('global'); // no override yet
    useFxStore.getState().saveForThisSong();
    expect(useFxStore.getState().scope).toBe('song');
    expect(useFxStore.getState().effectivePresetId).toBe('club');

    useFxStore.getState().setModuleEnabled('room', false); // edits the override
    expect(useFxStore.getState().effective.modules.room.enabled).toBe(false);
    expect(useFxStore.getState().globalState.modules.room.enabled).toBe(true); // global untouched

    useFxStore.getState().setSongFingerprint('sha256:bbb'); // another song: global
    expect(useFxStore.getState().effective.modules.room.enabled).toBe(true);
    useFxStore.getState().setSongFingerprint('sha256:aaa'); // back: its override
    expect(useFxStore.getState().effective.modules.room.enabled).toBe(false);

    useFxStore.getState().resetSongToGlobal();
    expect(useFxStore.getState().scope).toBe('global');
    expect(useFxStore.getState().effective.modules.room.enabled).toBe(true);
  });

  it('follows the loaded song through songIdentity', async () => {
    const { useFxStore, identity } = await loadStore();
    identity.setSongFingerprint('sha256:ccc');
    expect(useFxStore.getState().songFingerprint).toBe('sha256:ccc');
    identity.setSongFingerprint(null);
    expect(useFxStore.getState().songFingerprint).toBeNull();
  });

  it('keeps at most FX_SONG_OVERRIDE_LIMIT song overrides, dropping the least recently used', async () => {
    const { useFxStore, FX_SONG_OVERRIDE_LIMIT } = await loadStore();
    for (let i = 0; i <= FX_SONG_OVERRIDE_LIMIT; i++) {
      vi.setSystemTime(1_000_000 + i);
      useFxStore.getState().setSongFingerprint(`sha256:${i}`);
      useFxStore.getState().saveForThisSong();
    }
    const keys = Object.keys(useFxStore.getState().songOverrides);
    expect(keys).toHaveLength(FX_SONG_OVERRIDE_LIMIT);
    expect(keys).not.toContain('sha256:0');
  });

  it('presets: apply, step through factory + user presets, select by index', async () => {
    const { useFxStore, listFxPresets } = await loadStore();
    const s = useFxStore.getState();
    s.applyPreset('amiga-a500');
    expect(useFxStore.getState().effectivePresetId).toBe('amiga-a500');
    const userId = useFxStore.getState().saveUserPreset('Mine');
    expect(useFxStore.getState().effectivePresetId).toBe(userId);
    const all = listFxPresets(useFxStore.getState().userPresets);
    expect(all.at(-1)?.id).toBe(userId);
    useFxStore.getState().stepPreset(1); // wraps to the first
    expect(useFxStore.getState().effectivePresetId).toBe(all[0]!.id);
    useFxStore.getState().stepPreset(-1);
    expect(useFxStore.getState().effectivePresetId).toBe(userId);
    useFxStore.getState().selectPresetByIndex(1);
    expect(useFxStore.getState().effectivePresetId).toBe(all[1]!.id);
    useFxStore.getState().deleteUserPreset(userId);
    expect(listFxPresets(useFxStore.getState().userPresets).some((p) => p.id === userId)).toBe(false);
  });

  it('setParam: normalized MIDI values follow the spec scale; enums and bools coerce', async () => {
    const { useFxStore } = await loadStore();
    const s = useFxStore.getState();
    s.setParam('eq', 'midFreq', 0.5, { normalized: true });
    expect(useFxStore.getState().effective.modules.eq.params.midFreq).toBeCloseTo(Math.sqrt(200 * 5000), 6);
    s.setParam('character', 'ledModel', 1, { normalized: true });
    expect(useFxStore.getState().effective.modules.character.params.ledModel).toBe('a1200');
    s.setParam('character', 'tapeOn', 0.9, { normalized: true });
    expect(useFxStore.getState().effective.modules.character.params.tapeOn).toBe(true);
    const before = useFxStore.getState().effective;
    s.setParam('eq', 'noSuchParam', 1);
    s.setParam('room', 'ir', 'cathedral');
    expect(useFxStore.getState().effective).toBe(before);
  });

  it('`effective` keeps its identity unless the effective state changes', async () => {
    const { useFxStore } = await loadStore();
    const before = useFxStore.getState().effective;
    useFxStore.getState().setRackStatus('ready');
    useFxStore.getState().setModuleStatus('room', 'loading');
    useFxStore.getState().setSongFingerprint('sha256:none'); // no override → same state
    expect(useFxStore.getState().effective).toBe(before);
  });

  it('exports dry when nothing is active, and drops a room this browser cannot load', async () => {
    const { useFxStore } = await loadStore();
    useFxStore.getState().setModuleEnabled('room', true);
    expect(useFxStore.getState().exportSnapshot()?.modules.room.enabled).toBe(true);
    useFxStore.getState().setModuleStatus('room', 'unavailable', 'no Opus');
    expect(useFxStore.getState().exportSnapshot()).toBeNull(); // the room was the only module
    useFxStore.getState().setModuleEnabled('eq', true);
    expect(useFxStore.getState().exportSnapshot()?.modules.room.enabled).toBe(false);
  });
});
