import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { STAGE_MODE_STORAGE_KEY } from '../utils/stageModeSelection';

function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  const memory = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: memory,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'localStorage', {
    value: memory,
    configurable: true,
    writable: true,
  });
  if (typeof window.dispatchEvent !== 'function') {
    Object.defineProperty(window, 'dispatchEvent', {
      value: () => true,
      configurable: true,
    });
  }
  if (typeof globalThis.StorageEvent !== 'function') {
    (globalThis as unknown as { StorageEvent: new (type: string, init?: { key?: string | null }) => unknown }).StorageEvent =
      class {
        type: string;
        key: string | null;
        constructor(type: string, init?: { key?: string | null }) {
          this.type = type;
          this.key = init?.key ?? null;
        }
      };
  }
}

describe('playerUiStore stageMode overlay', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    window.location.search = '';
  });

  afterEach(() => {
    window.location.search = '';
    localStorage.removeItem(STAGE_MODE_STORAGE_KEY);
  });

  it('does not mutate panel prefs across a stage-mode round trip', async () => {
    const { usePlayerUiStore } = await import('../store/playerUiStore');
    const snapshot = { ...usePlayerUiStore.getState() };

    usePlayerUiStore.setState({
      editMode: true,
      showPlaylist: false,
      showMetadata: false,
      showChannelMeters: false,
      showInstruments: true,
      showLibraryBrowser: true,
      showLocalLibrary: true,
      chassisDark: true,
      liteMode: true,
      stageMode: false,
    });

    usePlayerUiStore.getState().setStageMode(true);
    expect(usePlayerUiStore.getState().stageMode).toBe(true);
    expect(usePlayerUiStore.getState().editMode).toBe(true);
    expect(usePlayerUiStore.getState().showPlaylist).toBe(false);
    expect(usePlayerUiStore.getState().showMetadata).toBe(false);
    expect(usePlayerUiStore.getState().showChannelMeters).toBe(false);
    expect(usePlayerUiStore.getState().showInstruments).toBe(true);
    expect(usePlayerUiStore.getState().showLibraryBrowser).toBe(true);
    expect(usePlayerUiStore.getState().showLocalLibrary).toBe(true);
    expect(usePlayerUiStore.getState().chassisDark).toBe(true);
    expect(usePlayerUiStore.getState().liteMode).toBe(true);

    usePlayerUiStore.getState().toggleStageMode();
    expect(usePlayerUiStore.getState().stageMode).toBe(false);
    expect(usePlayerUiStore.getState().editMode).toBe(true);
    expect(usePlayerUiStore.getState().showPlaylist).toBe(false);
    expect(usePlayerUiStore.getState().showMetadata).toBe(false);
    expect(usePlayerUiStore.getState().showChannelMeters).toBe(false);
    expect(usePlayerUiStore.getState().showInstruments).toBe(true);

    usePlayerUiStore.setState({
      theme: snapshot.theme,
      liteMode: snapshot.liteMode,
      reactiveMode: snapshot.reactiveMode,
      debugPanelOpen: snapshot.debugPanelOpen,
      chassisDark: snapshot.chassisDark,
      cheatsheetOpen: snapshot.cheatsheetOpen,
      showChannelMeters: snapshot.showChannelMeters,
      showMetadata: snapshot.showMetadata,
      showInstruments: snapshot.showInstruments,
      showPlaylist: snapshot.showPlaylist,
      showLibraryBrowser: snapshot.showLibraryBrowser,
      showLocalLibrary: snapshot.showLocalLibrary,
      editMode: snapshot.editMode,
      stageMode: snapshot.stageMode,
      selectedInstrumentIndex: snapshot.selectedInstrumentIndex,
      selectedSampleIndex: snapshot.selectedSampleIndex,
    });
  });
});
