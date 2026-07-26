import { create } from 'zustand';
import type { AppTheme } from '../appConfig';
import { DEVICE_CAPABILITIES } from '../utils/deviceCapabilities';
import { readLocalStorage, writeLocalStorage } from '../utils/localStorageIO';

export interface PlayerUiState {
  theme: AppTheme;
  liteMode: boolean;
  reactiveMode: boolean;
  debugPanelOpen: boolean;
  chassisDark: boolean;
  cheatsheetOpen: boolean;
  showChannelMeters: boolean;
  showMetadata: boolean;
  showInstruments: boolean;
  showPlaylist: boolean;
  showLibraryBrowser: boolean;
  showLocalLibrary: boolean;
  /**
   * Pattern editor chrome (session-only; not persisted).
   * Default off so play-only UX is unchanged.
   */
  editMode: boolean;
  /** 1-based instrument index, or null when nothing selected. */
  selectedInstrumentIndex: number | null;
  /** 1-based sample index, or null when nothing selected. */
  selectedSampleIndex: number | null;
  setTheme: (theme: AppTheme) => void;
  setLiteMode: (lite: boolean) => void;
  setReactiveMode: (reactive: boolean) => void;
  setDebugPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setChassisDark: (dark: boolean) => void;
  setCheatsheetOpen: (open: boolean) => void;
  setShowChannelMeters: (show: boolean) => void;
  setShowMetadata: (show: boolean) => void;
  setShowInstruments: (show: boolean) => void;
  setShowPlaylist: (show: boolean) => void;
  setShowLibraryBrowser: (show: boolean) => void;
  setShowLocalLibrary: (show: boolean) => void;
  setEditMode: (editMode: boolean) => void;
  toggleEditMode: () => void;
  setSelectedInstrumentIndex: (index: number | null) => void;
  setSelectedSampleIndex: (index: number | null) => void;
  clearInstrumentSelection: () => void;
}

export const usePlayerUiStore = create<PlayerUiState>((set) => ({
  theme: readLocalStorage<AppTheme>('xasm1_theme', 'dark'),
  liteMode: DEVICE_CAPABILITIES.isLite,
  reactiveMode: readLocalStorage<boolean>('xasm1_reactive_mode', true),
  debugPanelOpen: readLocalStorage<boolean>('xasm1.debugPanel.open', false),
  chassisDark: readLocalStorage<boolean>('xasm1_chassisDark', false),
  cheatsheetOpen: false,
  showChannelMeters: true,
  showMetadata: true,
  showInstruments: false,
  showPlaylist: true,
  showLibraryBrowser: false,
  showLocalLibrary: false,
  editMode: false,
  selectedInstrumentIndex: null,
  selectedSampleIndex: null,
  setTheme: (theme) => {
    writeLocalStorage('xasm1_theme', theme);
    set({ theme });
  },
  setLiteMode: (liteMode) => set({ liteMode }),
  setReactiveMode: (reactiveMode) => {
    writeLocalStorage('xasm1_reactive_mode', reactiveMode);
    set({ reactiveMode });
  },
  setDebugPanelOpen: (open) => {
    set((state) => {
      const next = typeof open === 'function' ? open(state.debugPanelOpen) : open;
      writeLocalStorage('xasm1.debugPanel.open', next);
      return { debugPanelOpen: next };
    });
  },
  setChassisDark: (chassisDark) => {
    writeLocalStorage('xasm1_chassisDark', chassisDark);
    set({ chassisDark });
  },
  setCheatsheetOpen: (cheatsheetOpen) => set({ cheatsheetOpen }),
  setShowChannelMeters: (showChannelMeters) => set({ showChannelMeters }),
  setShowMetadata: (showMetadata) => set({ showMetadata }),
  setShowInstruments: (showInstruments) => set({ showInstruments }),
  setShowPlaylist: (showPlaylist) => set({ showPlaylist }),
  setShowLibraryBrowser: (showLibraryBrowser) => set({ showLibraryBrowser }),
  setShowLocalLibrary: (showLocalLibrary) => set({ showLocalLibrary }),
  setEditMode: (editMode) => set({ editMode }),
  toggleEditMode: () => set((state) => ({ editMode: !state.editMode })),
  setSelectedInstrumentIndex: (selectedInstrumentIndex) => set({ selectedInstrumentIndex }),
  setSelectedSampleIndex: (selectedSampleIndex) => set({ selectedSampleIndex }),
  clearInstrumentSelection: () => set({ selectedInstrumentIndex: null, selectedSampleIndex: null }),
}));
