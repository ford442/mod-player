import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { App3DView } from './components/App3DView';
import { MainLayout } from './components/MainLayout';
import { ProjectMEmbedView } from './components/ProjectMEmbedView';
import type { ModuleMetadata } from './components/MetadataPanel';
import { useLibOpenMPT } from './hooks/useLibOpenMPT';
import { usePlaylist } from './hooks/usePlaylist';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useRegisterPlayerCommands } from './hooks/useRegisterPlayerCommands';
import { useMidiControls } from './hooks/useMidiControls';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useLibrary, useSaveSong, useSyncLibrary } from './hooks/useLibrary';
import { useLocalLibrary } from './hooks/useLocalLibrary';
import { useRateShader } from './hooks/useRateShader';
import { startProjectMBridge } from './utils/projectMBridge';
import { fetchRemoteModule, inferFileNameFromUrl } from './utils/remoteMedia';
import { SchemaMismatchError, type RemoteSong, type SongSaveRequest } from './utils/storageApi';
import {
  supportsStepsLength,
  isLiteRecommendedShader,
  usesCircularRowPaging,
  usesInstrumentPalette,
  usesNightModeBezel,
} from './utils/shaderVersion';
import { getLiteRecommendedShader } from './utils/shaderRegistry';
import { DEVICE_CAPABILITIES } from './utils/deviceCapabilities';
import type { MediaItem } from './types';
import type { LibraryEntry } from './types/localLibrary';
import {
  DEFAULT_BLOOM_PRESET,
  DEFAULT_COLOR_SCHEME,
  type BloomPreset,
  type ColorScheme,
  type NightPreset,
  NIGHT_PRESETS,
  DEFAULT_NIGHT_PRESET,
} from './types/bloomPresets';
import {
  DEFAULT_SHADER,
  ALL_SHADER_IDS,
  LIGHT_THEMES,
  computeModuleHash,
  AVAILABLE_SHADERS,
  IS_PROJECTM_EMBED,
  type AppTheme,
} from './appConfig';
import {
  calculateNoteDurations,
  packPatternMatrixHighPrecision,
  PACKEDB_TRIGGER_FLAG,
  isTriggerFromPackedB,
} from './utils/gpuPacking';
import { generateInstrumentPalette, generateEmptyInstrumentPalette } from './utils/instrumentPalette';
import { circularPageStart, overlayActualRow } from './utils/playheadPrediction';
import { preserveWindowScroll } from './utils/scrollContainer';
import { useToast } from './hooks/useToast';
import { usePlayerShare } from './hooks/usePlayerShare';
import { useOpenGraph } from './hooks/useOpenGraph';
import { usePatternEdit } from './hooks/usePatternEdit';
import { ToastStack } from './components/ToastStack';
import { buildShareUrl } from './utils/shareState';
import { patchFromFieldCycle, type PatternEditField } from './utils/patternEdit';

function App() {
  // Tier 1: global last-used shader — persisted across page reloads
  const [_storedShader, _setStoredShader] = useLocalStorage<string>('xasm1_last_shader', DEFAULT_SHADER);
  // Validate: fall back to default if the stored shader was removed from the selector list
  const shaderFile = ALL_SHADER_IDS.has(_storedShader) ? _storedShader : DEFAULT_SHADER;

  // Tier 2: per-module shader memory — keyed by first-16-byte hash of the loaded file
  const [moduleHash, setModuleHash] = useState<string | null>(null);
  const [shaderFavorites, setShaderFavorites] = useLocalStorage<string[]>('xasm1-shader-favorites', []);
  const [shaderRecents, setShaderRecents] = useLocalStorage<string[]>('xasm1-shader-recents', []);
  const [shaderThumbnails, setShaderThumbnails] = useLocalStorage<Record<string, string>>('xasm1-shader-thumbnails', {});

  const [volume, setVolume] = useState<number>(0.5);
  const [pan, setPan] = useState<number>(0.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const preMuteVolumeRef = useRef<number>(0.5);

  // 3D View State
  const [is3DMode, setIs3DMode] = useState<boolean>(false);
  const [theme, setTheme] = useLocalStorage<AppTheme>('xasm1_theme', 'dark');
  const isDarkMode = !LIGHT_THEMES.has(theme);
  const [viewMode, setViewMode] = useState<'device' | 'wall'>('device');

  // Lite mode — auto-detected from device capabilities, overridable via toggle
  const [liteMode, setLiteMode] = useState<boolean>(DEVICE_CAPABILITIES.isLite);

  // Apply data-theme attribute to <html> so CSS variables cascade globally
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Bloom and Color Scheme State
  const [bloomPreset, setBloomPreset] = useState<BloomPreset>(DEFAULT_BLOOM_PRESET);
  const [colorScheme, setColorScheme] = useState<ColorScheme>(DEFAULT_COLOR_SCHEME);
  // Persist colorPalette selection across page reloads
  const [colorPalette, setColorPalette] = useLocalStorage<number>('xasm1_colorPalette', 0);
  // Per-instrument palette mode — persisted alongside the colorPalette selector
  const [paletteMode, setPaletteMode] = useLocalStorage<number>('xasm1_paletteMode', 0);

  // Pattern length toggle — lifted to App.tsx so it can be shown in the toolbar
  // Uses supportsStepsLength() from shaderVersion.ts as the single source of truth
  const isStepsShader = supportsStepsLength(shaderFile);
  const [stepsLength, setStepsLength] = useLocalStorage<32 | 64>('xasm1_stepsLength', 32);
  // Reset to 32 when switching to a shader that doesn't support stepsLength
  useEffect(() => {
    if (!isStepsShader) setStepsLength(32);
  }, [isStepsShader, setStepsLength]);

  // Night Mode 2.0 — persisted, active only on patternv0.35_bloom
  const [nightModeEnabled, setNightModeEnabled] = useLocalStorage<boolean>('xasm1_nightMode_enabled', false);
  const [nightModePreset, setNightModePreset] = useLocalStorage<NightPreset>('xasm1_nightMode_preset', DEFAULT_NIGHT_PRESET);

  // CRT scanline/vignette effect — persisted across page reloads
  const [crtEnabled, setCrtEnabled] = useLocalStorage<boolean>('xasm1-crt-enabled', false);
  const {
    isReady,
    isModuleLoaded,
    isPlaying,
    isLooping,
    playbackSeconds,
    playbackRowFraction,
    setPlaybackRowFraction,
    totalPatternRows,
    sequencerMatrix,
    channelStates,
    moduleInfo,
    instrumentNames,
    moduleComments,
    beatPhase,
    grooveAmount,
    kickTrigger,
    activeChannels,
    play,
    stopMusic,
    loadFile,
    setIsLooping,
    seekToStep,
    setPanValue: setLibPan,
    replacePatternMatrix,
    activeEngine,
    isWorkletSupported,
    toggleAudioEngine,
    status,
    syncDebug,
    analyserNode,
    playbackStateRef,
    workletLoadError,
    oscBufferRef,
  } = useLibOpenMPT(volume);

  // Prevent incidental document scroll when playback starts (row-follow, layout shifts, etc.).
  const playGuarded = useCallback(() => {
    preserveWindowScroll(() => play());
  }, [play]);

  // Headless Chrome / Playwright automation hooks (dev server + CI captures)
  useEffect(() => {
    window.__TEST_HOOKS__ = {
      seekToRow: (row: number) => seekToStep(row),
      stopPlayback: () => stopMusic(false),
      isModuleLoaded: () => isModuleLoaded,
      getPatternRenderer: () => window.currentPatternRenderer,
      loadModuleFromUrl: async (url: string) => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
        const buf = new Uint8Array(await resp.arrayBuffer());
        const name = url.split('/').pop() || 'module.mod';
        await loadFile(buf, name);
      },
      getTriggerTailStats: () => {
        if (!sequencerMatrix) return null;
        const d = calculateNoteDurations(sequencerMatrix);
        let triggers = 0;
        let sustains = 0;
        for (const row of d) {
          for (const cell of row) {
            if (cell.isTrigger) triggers++;
            if (cell.isSustained) sustains++;
          }
        }
        return {
          triggers,
          sustains,
          rows: sequencerMatrix.numRows,
          channels: sequencerMatrix.numChannels,
        };
      },
      /** Per-row note + TRIG-001 state for Playwright / grok cli verification */
      getRowNotes: (row: number) => {
        if (!sequencerMatrix) return null;
        const d = calculateNoteDurations(sequencerMatrix);
        const raw = sequencerMatrix.rows[row] ?? [];
        const channels = sequencerMatrix.numChannels;
        const cells = [];
        for (let ch = 0; ch < channels; ch++) {
          const cell = raw[ch];
          const info = d[row]?.[ch];
          cells.push({
            ch,
            note: cell?.note ?? 0,
            inst: cell?.inst ?? 0,
            isTrigger: info?.isTrigger ?? false,
            isSustained: info?.isSustained ?? false,
            duration: info?.duration ?? 0,
            rowOffset: info?.rowOffset ?? 0,
            isNoteOff: info?.isNoteOff ?? false,
          });
        }
        return { row, channels, cells };
      },
      /** Packed GPU cell + trigger bit for cross-check against duration oracle */
      getPackedCell: (row: number, ch: number) => {
        if (!sequencerMatrix) return null;
        const { packedData } = packPatternMatrixHighPrecision(sequencerMatrix, false);
        const cols = sequencerMatrix.numChannels;
        const offset = (row * cols + ch) * 2;
        const packedA = packedData[offset] ?? 0;
        const packedB = packedData[offset + 1] ?? 0;
        const durationFlags = (packedB >> 8) & 0x7f;
        const rowOffset = durationFlags >> 1;
        const isNoteOff = (durationFlags & 1) !== 0;
        const note = (packedA >> 24) & 0xff;
        const hasPitch = note >= 1 && note <= 119;
        return {
          row,
          ch,
          packedA,
          packedB,
          note,
          duration: (packedA >> 8) & 0xff,
          triggerFlag: (packedB & PACKEDB_TRIGGER_FLAG) !== 0,
          rowOffset,
          isNoteOff,
          isTrigger: isTriggerFromPackedB(packedB, rowOffset, isNoteOff, hasPitch),
        };
      },
      /** Force fractional playhead for paging regression (does not move audio) */
      setPlayheadFraction: (value: number) => {
        playbackStateRef.current = {
          ...playbackStateRef.current,
          playheadRow: value,
          lastUpdateTimestamp: performance.now() / 1000,
        };
        setPlaybackRowFraction(value);
      },
      getPlaybackRow: () => Math.floor(playbackRowFraction),
      getPlaybackRowFraction: () => playbackRowFraction,
      getActiveRenderer: () => window.currentPatternRenderer?.backend ?? null,
      getAudioEngine: () => activeEngine,
      getLiteMode: () => liteMode,
      getShaderFile: () => {
        const raw = localStorage.getItem('xasm1_last_shader');
        if (!raw) return null;
        try {
          return JSON.parse(raw) as string;
        } catch {
          return raw;
        }
      },
      selectShader: (shader: string) => {
        try {
          localStorage.setItem('xasm1_last_shader', JSON.stringify(shader));
          window.dispatchEvent(new StorageEvent('storage', { key: 'xasm1_last_shader' }));
        } catch {
          /* ignore */
        }
      },
      /** Circular hybrid paging — overlay must fetch rows from current page, not 0..N-1 */
      getCircularOverlayPaging: () => {
        const matrix = sequencerMatrix;
        if (!matrix) return { ok: false, reason: 'no matrix' };
        const shader = localStorage.getItem('xasm1_last_shader') ?? '';
        if (!usesCircularRowPaging(shader)) {
          return { ok: true, skipped: true, reason: 'not circular-paging shader' };
        }
        const playhead = playbackStateRef.current.playheadRow;
        const numRows = matrix.numRows;
        const pageStart = circularPageStart(playhead, numRows);
        const overlayEl = document.querySelector('[data-overlay-canvas="true"]');
        const overlayActive =
          overlayEl != null && getComputedStyle(overlayEl).display !== 'none';
        const mismatches: Array<{
          stepIndex: number;
          expectedRow: number;
          staleRow: number;
          expectedNote: number;
          staleNote: number;
        }> = [];
        const sampleSteps = [0, 1, 16, 32, 63];
        for (const stepIndex of sampleSteps) {
          if (stepIndex >= numRows) continue;
          const expectedRow = overlayActualRow(stepIndex, playhead, numRows);
          const staleRow = stepIndex;
          if (pageStart === 0 || expectedRow === staleRow) continue;
          const expectedNote = matrix.rows[expectedRow]?.[1]?.note ?? 0;
          const staleNote = matrix.rows[staleRow]?.[1]?.note ?? 0;
          if (expectedNote !== staleNote) {
            mismatches.push({ stepIndex, expectedRow, staleRow, expectedNote, staleNote });
          }
        }
        return {
          ok: true,
          playhead,
          numRows,
          pageStart,
          overlayActive,
          mismatches,
          pagingDiffersAtPlayhead: pageStart > 0,
        };
      },
    };
    return () => { delete window.__TEST_HOOKS__; };
  }, [seekToStep, stopMusic, isModuleLoaded, sequencerMatrix, loadFile, playbackRowFraction, setPlaybackRowFraction, playbackStateRef, activeEngine, liteMode]);

  // Project-M popup integration: broadcast PCM frames via BroadcastChannel
  useEffect(() => {
    const stopBridge = startProjectMBridge(analyserNode);
    return stopBridge; // cleanup on unmount
  }, [analyserNode]);

  // Media Overlay State
  const [mediaVisible, setMediaVisible] = useState<boolean>(false);
  const [mediaItem, setMediaItem] = useState<MediaItem | null>(null);
  const [currentModuleFileName, setCurrentModuleFileName] = useState<string>('');
  const [moduleSourceUrl, setModuleSourceUrl] = useState<string | null>(null);
  const skipModuleShaderRestoreRef = useRef(false);
  // Track object URLs created from local files so we can revoke them on replacement/unmount
  const mediaObjectUrlRef = useRef<string | null>(null);
  const [mediaFades, setMediaFades] = useLocalStorage<{ in: number; out: number }>('xasm1_media_fades', { in: 500, out: 500 });

  // Panel visibility
  const [showChannelMeters, setShowChannelMeters] = useState<boolean>(true);
  const [showMetadata, setShowMetadata] = useState<boolean>(true);
  const [showPlaylist, setShowPlaylist] = useState<boolean>(true);
  const [showLibraryBrowser, setShowLibraryBrowser] = useState<boolean>(false);
  const [showLocalLibrary, setShowLocalLibrary] = useState<boolean>(false);
  const [debugPanelOpen, setDebugPanelOpen] = useLocalStorage<boolean>('xasm1.debugPanel.open', false);
  const [chassisDark, setChassisDark] = useLocalStorage<boolean>('xasm1_chassisDark', false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState<boolean>(false);
  const { songsQuery, shadersQuery } = useLibrary();
  const rateShaderMutation = useRateShader();
  const saveSongMutation = useSaveSong();
  const syncLibraryMutation = useSyncLibrary();
  const localLibrary = useLocalLibrary();
  const [activeLibraryEntryId, setActiveLibraryEntryId] = useState<string | null>(null);

  // Channel VU data (from worklet channelStates)
  const channelVU = useMemo(() => {
    if (!channelStates || channelStates.length === 0) return null;
    const vu = new Float32Array(channelStates.length);
    for (let i = 0; i < channelStates.length; i++) {
      vu[i] = channelStates[i]?.volume ?? 0;
    }
    return vu;
  }, [channelStates]);

  // Module metadata derived from existing state
  const moduleMetadata = useMemo((): ModuleMetadata | null => {
    if (!isModuleLoaded || !sequencerMatrix) return null;
    return {
      title: status.replace(/^Loaded "/, '').replace(/"$/, '') || 'Unknown',
      artist: '',
      tracker: activeEngine === 'native-worklet' ? 'Native C++/Wasm' : activeEngine === 'worklet' ? 'JS AudioWorklet' : 'ScriptProcessor',
      numChannels: sequencerMatrix?.numChannels ?? 0,
      numOrders: totalPatternRows > 0 ? Math.ceil(totalPatternRows / (sequencerMatrix?.numRows || 64)) : 0,
      numPatterns: 0,
      numInstruments: instrumentNames.length,
      durationSeconds: 0,
      currentBpm: 125,
      instruments: instrumentNames,
      comments: moduleComments,
    };
  }, [isModuleLoaded, sequencerMatrix, status, activeEngine, totalPatternRows, instrumentNames, moduleComments]);

  // Shader change handler — Tier 1 (global) + Tier 2 (per-module) write
  const setShaderFile = useCallback((shader: string) => {
    _setStoredShader(shader);
    setShaderRecents(previousRecents => [shader, ...previousRecents.filter(s => s !== shader)].slice(0, 5));
    // Per-instrument palette only makes sense for shaders that read it; switch back to pitch-hue
    // on shaders that do not use the paletteMode uniform to avoid silent no-ops in the UI.
    if (!usesInstrumentPalette(shader)) setPaletteMode(0);
    if (moduleHash) {
      try {
        localStorage.setItem(`xasm1_module_shader_${moduleHash}`, shader);
      } catch {
        // Ignore quota/security errors
      }
    }
  }, [_setStoredShader, moduleHash, setShaderRecents, setPaletteMode]);

  const toggleShaderFavorite = useCallback((shader: string) => {
    setShaderFavorites(
      previousFavorites => (
        previousFavorites.includes(shader)
          ? previousFavorites.filter(s => s !== shader)
          : [shader, ...previousFavorites]
      ),
    );
  }, [setShaderFavorites]);

  const handleRandomShader = useCallback(() => {
    const others = AVAILABLE_SHADERS.filter(shader => shader.id !== shaderFile);
    const pool = others.length > 0 ? others : AVAILABLE_SHADERS;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) {
      setShaderFile(pick.id);
    }
  }, [shaderFile, setShaderFile]);

  useEffect(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-shader-preview-source="true"]');
    if (!canvas) return;
    if (shaderThumbnails[shaderFile]) return;
    const timer = window.setTimeout(() => {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.startsWith('data:image/png')) {
          setShaderThumbnails(previous => ({ ...previous, [shaderFile]: dataUrl }));
        }
      } catch {
        // Ignore capture/security errors
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [setShaderThumbnails, shaderFile, shaderThumbnails]);

  const validShaderFavorites = useMemo(
    () => shaderFavorites.filter(shader => ALL_SHADER_IDS.has(shader)),
    [shaderFavorites],
  );
  const validShaderRecents = useMemo(
    () => shaderRecents.filter(shader => ALL_SHADER_IDS.has(shader)).slice(0, 5),
    [shaderRecents],
  );
  const libraryErrorMessage = useMemo(() => {
    const error = songsQuery.error;
    if (!error) return null;
    if (error instanceof SchemaMismatchError) {
      return error.message;
    }
    return 'Cloud library unavailable. Check storage_manager connectivity.';
  }, [songsQuery.error]);
  const shaderCatalogErrorMessage = useMemo(() => {
    const error = shadersQuery.error;
    if (!error) return null;
    if (error instanceof SchemaMismatchError) {
      return error.message;
    }
    return 'Shader catalog unavailable. Ratings are temporarily offline.';
  }, [shadersQuery.error]);
  const saveSongErrorMessage = useMemo(() => {
    const error = saveSongMutation.error;
    if (!error) return null;
    return error instanceof Error ? error.message : 'Failed to save module to library.';
  }, [saveSongMutation.error]);
  const syncLibraryErrorMessage = useMemo(() => {
    const error = syncLibraryMutation.error;
    if (!error) return null;
    return error instanceof Error ? error.message : 'Library sync failed.';
  }, [syncLibraryMutation.error]);

  // Tier 2: restore per-module shader whenever the loaded module changes
  useEffect(() => {
    if (!moduleHash) return;
    if (skipModuleShaderRestoreRef.current) {
      skipModuleShaderRestoreRef.current = false;
      return;
    }
    try {
      const saved = localStorage.getItem(`xasm1_module_shader_${moduleHash}`);
      if (saved !== null && ALL_SHADER_IDS.has(saved)) {
        _setStoredShader(saved);
      }
    } catch (e) {
      console.warn('[xasm1] Failed to read per-module shader from localStorage', e);
    }
  }, [moduleHash, _setStoredShader]);

  // Wrapper: compute per-module hash then load — used by all load call sites
  const loadFileWithHash = useCallback((fileData: Uint8Array, fileName: string) => {
    setModuleHash(computeModuleHash(fileData));
    setCurrentModuleFileName(fileName);
    loadFile(fileData, fileName);
  }, [loadFile]);

  // Playlist
  const playlist = usePlaylist();

  // Save request derived from current module — passed to LibraryBrowser
  const activeModuleForSave = useMemo((): SongSaveRequest | null => {
    if (!isModuleLoaded) return null;
    const title = status.replace(/^Loaded "/, '').replace(/"$/, '') || 'Unknown';
    const currentItem = playlist.items[playlist.currentIndex];
    const fileName = currentItem?.fileName;
    const req: SongSaveRequest = { title };
    if (fileName) req.fileName = fileName;
    const extension = fileName?.split('.').pop()?.trim().toLowerCase();
    if (extension) req.format = extension;
    const numChannels = sequencerMatrix?.numChannels;
    if (numChannels && numChannels > 0) req.channelCount = numChannels;
    return req;
  }, [isModuleLoaded, status, playlist.items, playlist.currentIndex, sequencerMatrix]);

  const handlePlaylistSelect = useCallback((index: number) => {
    const item = playlist.select(index);
    if (item) loadFileWithHash(item.fileData, item.fileName);
  }, [playlist, loadFileWithHash]);

  const handlePlaylistNext = useCallback(() => {
    const item = playlist.next();
    if (item) loadFileWithHash(item.fileData, item.fileName);
  }, [playlist, loadFileWithHash]);

  const handlePlaylistPrev = useCallback(() => {
    const item = playlist.prev();
    if (item) loadFileWithHash(item.fileData, item.fileName);
  }, [playlist, loadFileWithHash]);

  const handlePlaylistFilesAdded = useCallback((files: FileList) => {
    playlist.addFiles(files);
  }, [playlist]);

  const handleLibrarySongLoad = useCallback(async (song: RemoteSong) => {
    const fileData = await fetchRemoteModule(song.downloadUrl);
    const fileName = song.fileName || inferFileNameFromUrl(song.downloadUrl);
    setModuleSourceUrl(song.downloadUrl);
    const remotePlaylistId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `remote-${crypto.randomUUID()}`
      : `remote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    playlist.addItem({
      id: remotePlaylistId,
      fileName,
      fileData,
    });
    loadFileWithHash(fileData, fileName);
  }, [loadFileWithHash, playlist]);

  const handleLocalLibraryPlay = useCallback(async (entry: LibraryEntry) => {
    const file = await localLibrary.resolveEntryFile(entry);
    const data = new Uint8Array(await file.arrayBuffer());
    loadFileWithHash(data, entry.fileName);
    localLibrary.markPlayed(entry.id);
    setActiveLibraryEntryId(entry.id);
  }, [localLibrary.resolveEntryFile, localLibrary.markPlayed, loadFileWithHash]);

  // Sync pan with library
  useEffect(() => { setLibPan(pan); }, [pan, setLibPan]);

  const seekByOrderDelta = useCallback((delta: number) => {
    const rowsPerPattern = sequencerMatrix?.numRows ?? 64;
    const currentOrder = sequencerMatrix?.order ?? 0;
    const targetStep = (currentOrder + delta) * rowsPerPattern;
    seekToStep(Math.max(0, targetStep));
  }, [seekToStep, sequencerMatrix]);

  const jumpToOrder = useCallback((orderIndex: number) => {
    const rowsPerPattern = sequencerMatrix?.numRows ?? 64;
    const targetStep = orderIndex * rowsPerPattern;
    seekToStep(Math.max(0, targetStep));
  }, [seekToStep, sequencerMatrix?.numRows]);

  // Keyboard shortcuts — stable callbacks via useCallback
  const onKbdPlayPause = useCallback(() => {
    if (isPlaying) { stopMusic(false); } else { playGuarded(); }
  }, [isPlaying, stopMusic, playGuarded]);

  const onKbdPlay = useCallback(() => { playGuarded(); }, [playGuarded]);
  const onKbdPause = useCallback(() => { stopMusic(false); }, [stopMusic]);

  const onKbdSeekForward = useCallback(() => seekToStep(Math.floor(playbackRowFraction) + 1),
    [seekToStep, playbackRowFraction]);
  const onKbdSeekBackward = useCallback(() => seekToStep(Math.max(0, Math.floor(playbackRowFraction) - 1)),
    [seekToStep, playbackRowFraction]);

  const onKbdVolumeUp = useCallback(() => setVolume(v => Math.min(1, v + 0.05)), []);
  const onKbdVolumeDown = useCallback(() => setVolume(v => Math.max(0, v - 0.05)), []);

  const onKbdToggleMute = useCallback(() => {
    if (isMuted) {
      setVolume(preMuteVolumeRef.current > 0 ? preMuteVolumeRef.current : 0.5);
      setIsMuted(false);
    } else {
      preMuteVolumeRef.current = volume;
      setVolume(0);
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  const onKbdToggleLoop = useCallback(() => setIsLooping(l => !l), [setIsLooping]);

  const onKbdToggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }, []);

  const onKbdSeekNextOrder = useCallback(() => seekByOrderDelta(1), [seekByOrderDelta]);
  const onKbdSeekPrevOrder = useCallback(() => seekByOrderDelta(-1), [seekByOrderDelta]);
  const onKbdToggleDebugPanel = useCallback(() => setDebugPanelOpen(!debugPanelOpen), [setDebugPanelOpen, debugPanelOpen]);
  const onKbdToggleCheatsheet = useCallback(() => setCheatsheetOpen(open => !open), []);
  const onKbdCloseCheatsheet = useCallback(() => setCheatsheetOpen(false), []);

  const onKbdVolumeSet = useCallback((value: number) => setVolume(Math.max(0, Math.min(1, value))), []);
  const onKbdPanSet = useCallback((value: number) => setPan(Math.max(-1, Math.min(1, value))), []);
  const onKbdShaderSelectByIndex = useCallback((index: number) => {
    const pick = AVAILABLE_SHADERS[index % AVAILABLE_SHADERS.length];
    if (pick) setShaderFile(pick.id);
  }, [setShaderFile]);

  useRegisterPlayerCommands({
    onPlayPause: onKbdPlayPause,
    onPlay: onKbdPlay,
    onPause: onKbdPause,
    onSeekForward: onKbdSeekForward,
    onSeekBackward: onKbdSeekBackward,
    onSeekNextOrder: onKbdSeekNextOrder,
    onSeekPrevOrder: onKbdSeekPrevOrder,
    onJumpToOrder: jumpToOrder,
    onVolumeUp: onKbdVolumeUp,
    onVolumeDown: onKbdVolumeDown,
    onVolumeSet: onKbdVolumeSet,
    onPanSet: onKbdPanSet,
    onToggleMute: onKbdToggleMute,
    onToggleLoop: onKbdToggleLoop,
    onToggleFullscreen: onKbdToggleFullscreen,
    onToggleDebugPanel: onKbdToggleDebugPanel,
    onToggleCheatsheet: onKbdToggleCheatsheet,
    onCloseCheatsheet: onKbdCloseCheatsheet,
    onShaderSelectByIndex: onKbdShaderSelectByIndex,
  });

  useKeyboardShortcuts({ cheatsheetOpen });

  const midiControls = useMidiControls();

  // Register PWA service worker
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      console.log('[PWA] Service Worker not supported in this browser');
      return;
    }
    
    // Only register in production builds
    if (!import.meta.env.PROD) {
      console.log('[PWA] Skipping SW registration (development mode)');
      return;
    }
    
    // Detect actual base path from current location for subdirectory deployments
    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    const detectedBase = pathSegments.length > 0 ? `/${pathSegments[0]}/` : '/';
    const baseUrl = import.meta.env.BASE_URL !== '/' ? import.meta.env.BASE_URL : detectedBase;
    
    // Ensure consistent trailing slash for URL construction
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const swUrl = `${normalizedBase}sw.js`;
    const scope = normalizedBase;
    
    console.log('[PWA] ==================================================');
    console.log('[PWA] Registering Service Worker...');
    console.log('[PWA] Service Worker URL:', swUrl);
    console.log('[PWA] Scope:', scope);
    console.log('[PWA] BASE_URL (env):', import.meta.env.BASE_URL);
    console.log('[PWA] Detected base:', detectedBase);
    console.log('[PWA] ==================================================');
    
    navigator.serviceWorker.register(swUrl, { scope }).then((reg) => {
      console.log('[PWA] ✅ Service Worker registered successfully');
      console.log('[PWA] Scope:', reg.scope);
      console.log('[PWA] State:', reg.installing ? 'installing' : reg.waiting ? 'waiting' : 'active');
    }).catch((err) => {
      console.error('[PWA] ❌ Service Worker registration failed:', err);
      console.error('[PWA] Failed URL:', swUrl);
      console.error('[PWA] This usually means sw.js is missing from the build output');
    });
  }, []);

  // Revoke any lingering media object URL on unmount
  useEffect(() => {
    return () => {
      if (mediaObjectUrlRef.current) {
        URL.revokeObjectURL(mediaObjectUrlRef.current);
      }
    };
  }, []);

  // Handle File Selection

  const handleFileSelected = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    setModuleSourceUrl(null);
    loadFileWithHash(data, file.name);
  };

  const handleMediaAdd = (file: File) => {
    const kind = file.type.startsWith("video") ? "video" : "image";
    // Revoke the previous object URL to avoid memory leaks
    if (mediaObjectUrlRef.current) {
      URL.revokeObjectURL(mediaObjectUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    mediaObjectUrlRef.current = url;
    setMediaItem({
      id: crypto.randomUUID(),
      kind,
      url,
      fileName: file.name,
      mimeType: file.type,
      loop: kind === 'video'
    });
    setMediaVisible(true);
  };

  const handleRemoteMediaSelect = (item: MediaItem) => {
    setMediaItem(item);
    setMediaVisible(true);
  };

  const handleMediaRemove = useCallback((id: string) => {
    if (mediaItem?.id !== id) return;
    if (mediaItem.isObjectUrl && mediaObjectUrlRef.current === mediaItem.url) {
      URL.revokeObjectURL(mediaItem.url);
      mediaObjectUrlRef.current = null;
    }
    setMediaVisible(false);
    setMediaItem(null);
  }, [mediaItem]);

  const moduleMediaHintText = useMemo(() => {
    const parts = [moduleComments, ...instrumentNames]
      .map(value => value.trim())
      .filter(Boolean);
    return parts.join('\n');
  }, [moduleComments, instrumentNames]);

  // Calculate Dim Factor — Night Mode overrides when registry marks nightModeBezel
  const isNightShader = usesNightModeBezel(shaderFile);
  const nightConfig = NIGHT_PRESETS[nightModePreset];
  const effectiveDimFactor = (isNightShader && nightModeEnabled)
    ? nightConfig.dimFactor
    : (isDarkMode ? 0.3 : 1.0);
  const dimFactor = effectiveDimFactor;

  // In lite mode, substitute a cheap shader for rendering unless the user
  // has already manually selected a lite-recommended one.
  const displayShaderFile = useMemo(() => {
    if (liteMode && !isLiteRecommendedShader(shaderFile)) {
      return getLiteRecommendedShader();
    }
    return shaderFile;
  }, [liteMode, shaderFile]);

  // Derive a stable per-instrument palette from the loaded module's instrument names.
  const instrumentPalette = useMemo(() => {
    if (!instrumentNames || instrumentNames.length === 0) return generateEmptyInstrumentPalette();
    return generateInstrumentPalette(instrumentNames.length, instrumentNames);
  }, [instrumentNames]);

  const { toasts, showToast, dismissToast } = useToast();

  const patternEdit = usePatternEdit({
    matrix: sequencerMatrix,
    onMatrixChange: replacePatternMatrix,
  });

  const handlePatternCellEdit = useCallback((row: number, channel: number, field: PatternEditField) => {
    if (!sequencerMatrix) return;
    const cell = sequencerMatrix.rows[row]?.[channel] ?? { type: 'empty', text: '' };
    patternEdit.editCell(row, channel, patchFromFieldCycle(field, cell));
  }, [sequencerMatrix, patternEdit]);

  const handleSequencerCellEdit = useCallback((row: number, channel: number) => {
    handlePatternCellEdit(row, channel, 'note');
  }, [handlePatternCellEdit]);

  const { copyShareLink } = usePlayerShare({
    isReady,
    isModuleLoaded,
    sequencerMatrix,
    shaderFile,
    paletteMode,
    liteMode,
    colorPalette,
    moduleSourceUrl,
    moduleOrder: moduleInfo.order,
    moduleRow: moduleInfo.row,
    mediaItem,
    setShaderFile,
    setPaletteMode,
    setColorPalette,
    setLiteMode,
    setModuleSourceUrl,
    loadFileWithHash,
    seekToStep,
    setMediaItem,
    setMediaVisible,
    showToast,
    skipModuleShaderRestoreRef,
  });

  const sharePageUrl = useMemo(() => {
    if (!isModuleLoaded) return window.location.href;
    const shareState: Parameters<typeof buildShareUrl>[0] = {
      shader: shaderFile,
      order: moduleInfo.order,
      row: moduleInfo.row,
      palette: paletteMode === 1 ? 'instrument' : 'pitch',
      lite: liteMode ? 1 : 0,
      colorPalette,
    };
    if (moduleSourceUrl) shareState.mod = moduleSourceUrl;
    if (mediaItem && !mediaItem.isObjectUrl) shareState.media = mediaItem.url;
    return buildShareUrl(shareState);
  }, [
    isModuleLoaded,
    moduleSourceUrl,
    shaderFile,
    moduleInfo.order,
    moduleInfo.row,
    paletteMode,
    liteMode,
    colorPalette,
    mediaItem,
  ]);

  useOpenGraph({
    ...(moduleMetadata?.title
      ? { title: `${moduleMetadata.title} · MOD Player` }
      : {}),
    ...(moduleMetadata
      ? { description: `Listen to "${moduleMetadata.title}" with shader ${shaderFile}` }
      : {}),
    url: sharePageUrl,
  });

  // Edit-mode undo/redo shortcuts
  useEffect(() => {
    if (!patternEdit.editMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        patternEdit.undo();
      } else if ((event.key === 'z' && event.shiftKey) || event.key === 'y') {
        event.preventDefault();
        patternEdit.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [patternEdit.editMode, patternEdit.undo, patternEdit.redo]);

  // Project-M embed / audio-only mode: render a compact transport-only UI and
  // skip MainLayout / App3DView entirely so the heavy WebGPU pattern display
  // never mounts. The PCM bridge (startProjectMBridge / broadcastPcmBlock) stays
  // active regardless, so audio keeps flowing to the Project-M host.
  if (IS_PROJECTM_EMBED) {
    return (
      <ProjectMEmbedView
        status={status}
        isReady={isReady}
        isModuleLoaded={isModuleLoaded}
        isPlaying={isPlaying}
        isLooping={isLooping}
        playbackSeconds={playbackSeconds}
        playbackRow={Math.floor(playbackRowFraction)}
        totalRows={totalPatternRows}
        moduleTitle={moduleMetadata?.title ?? null}
        play={playGuarded}
        stopMusic={stopMusic}
        seekToStep={seekToStep}
        setIsLooping={setIsLooping}
        handleFileSelected={handleFileSelected}
      />
    );
  }

  if (is3DMode) {
    return (
      <App3DView
        isDarkMode={isDarkMode}
        viewMode={viewMode}
        setViewMode={setViewMode}
        setIs3DMode={setIs3DMode}
        setTheme={setTheme}
        dimFactor={dimFactor}
        status={status}
        isModuleLoaded={isModuleLoaded}
        syncDebug={syncDebug}
        sequencerMatrix={sequencerMatrix}
        playbackRowFraction={playbackRowFraction}
        isPlaying={isPlaying}
        playbackSeconds={playbackSeconds}
        channelStates={channelStates}
        beatPhase={beatPhase}
        grooveAmount={grooveAmount}
        kickTrigger={kickTrigger}
        activeChannels={activeChannels}
        volume={volume}
        pan={pan}
        isLooping={isLooping}
        totalPatternRows={totalPatternRows}
        play={playGuarded}
        stopMusic={stopMusic}
        seekToStep={seekToStep}
        setIsLooping={setIsLooping}
        setVolume={setVolume}
        setPan={setPan}
        handleFileSelected={handleFileSelected}
        handleMediaAdd={handleMediaAdd}
        handleRemoteMediaSelect={handleRemoteMediaSelect}
        analyserNode={analyserNode}
        debugPanelOpen={debugPanelOpen}
        setDebugPanelOpen={setDebugPanelOpen}
        playbackStateRef={playbackStateRef}
        oscBufferRef={oscBufferRef}
        bloomPreset={bloomPreset}
        setBloomPreset={setBloomPreset}
        colorScheme={colorScheme}
        setColorScheme={setColorScheme}
        mediaItem={mediaItem}
        mediaVisible={mediaVisible}
        setMediaVisible={setMediaVisible}
        setMediaItem={setMediaItem}
        mediaFades={mediaFades}
        isReady={isReady}
        cheatsheetOpen={cheatsheetOpen}
        setCheatsheetOpen={setCheatsheetOpen}
      />
    );
  }

  return (
    <>
    <MainLayout
      isDarkMode={isDarkMode}
      theme={theme}
      setTheme={setTheme}
      setIs3DMode={setIs3DMode}
      liteMode={liteMode}
      setLiteMode={setLiteMode}
      isWorkletSupported={isWorkletSupported}
      workletLoadError={workletLoadError}
      toggleAudioEngine={toggleAudioEngine}
      activeEngine={activeEngine}
      shaderFile={shaderFile}
      displayShaderFile={displayShaderFile}
      setShaderFile={setShaderFile}
      handleRandomShader={handleRandomShader}
      validShaderFavorites={validShaderFavorites}
      validShaderRecents={validShaderRecents}
      shaderThumbnails={shaderThumbnails}
      toggleShaderFavorite={toggleShaderFavorite}
      shaderCatalog={shadersQuery.data ?? []}
      shaderCatalogLoading={shadersQuery.isLoading || shadersQuery.isFetching}
      shaderCatalogError={shaderCatalogErrorMessage}
      onRateShader={async (shaderId, score) => { await rateShaderMutation.mutateAsync({ id: shaderId, score }); }}
      ratingInFlightShaderId={rateShaderMutation.isPending ? rateShaderMutation.variables?.id ?? null : null}
      colorPalette={colorPalette}
      setColorPalette={setColorPalette}
      paletteMode={paletteMode}
      setPaletteMode={setPaletteMode}
      instrumentPalette={instrumentPalette}
      isStepsShader={isStepsShader}
      stepsLength={stepsLength}
      setStepsLength={setStepsLength}
      sequencerMatrix={sequencerMatrix}
      playbackRowFraction={playbackRowFraction}
      isPlaying={isPlaying}
      playbackSeconds={playbackSeconds}
      channelStates={channelStates}
      beatPhase={beatPhase}
      grooveAmount={grooveAmount}
      kickTrigger={kickTrigger}
      activeChannels={activeChannels}
      isModuleLoaded={isModuleLoaded}
      volume={volume}
      pan={pan}
      isLooping={isLooping}
      totalPatternRows={totalPatternRows}
      play={playGuarded}
      stopMusic={stopMusic}
      seekToStep={seekToStep}
      setIsLooping={setIsLooping}
      setVolume={setVolume}
      setPan={setPan}
      handleFileSelected={handleFileSelected}
      analyserNode={analyserNode}
      debugPanelOpen={debugPanelOpen}
      setDebugPanelOpen={setDebugPanelOpen}
      playbackStateRef={playbackStateRef}
      oscBufferRef={oscBufferRef}
      bloomPreset={bloomPreset}
      setBloomPreset={setBloomPreset}
      colorScheme={colorScheme}
      setColorScheme={setColorScheme}
      isNightShader={isNightShader}
      nightModeEnabled={nightModeEnabled}
      nightConfig={nightConfig}
      nightModePreset={nightModePreset}
      setNightModeEnabled={setNightModeEnabled}
      setNightModePreset={setNightModePreset}
      crtEnabled={crtEnabled}
      setCrtEnabled={setCrtEnabled}
      chassisDark={chassisDark}
      setChassisDark={setChassisDark}
      dimFactor={dimFactor}
      mediaItem={mediaItem}
      mediaVisible={mediaVisible}
      setMediaVisible={setMediaVisible}
      setMediaItem={setMediaItem}
      mediaFades={mediaFades}
      moduleMediaFileName={currentModuleFileName}
      moduleMediaHintText={moduleMediaHintText}
      onMediaRemove={handleMediaRemove}
      onMediaFadesChange={setMediaFades}
      handleMediaAdd={handleMediaAdd}
      handleRemoteMediaSelect={handleRemoteMediaSelect}
      isReady={isReady}
      channelVU={channelVU}
      moduleMetadata={moduleMetadata}
      showChannelMeters={showChannelMeters}
      setShowChannelMeters={setShowChannelMeters}
      showMetadata={showMetadata}
      setShowMetadata={setShowMetadata}
      showPlaylist={showPlaylist}
      setShowPlaylist={setShowPlaylist}
      showLibraryBrowser={showLibraryBrowser}
      setShowLibraryBrowser={setShowLibraryBrowser}
      showLocalLibrary={showLocalLibrary}
      setShowLocalLibrary={setShowLocalLibrary}
      localLibraryRoots={localLibrary.roots}
      localLibraryLoading={localLibrary.isLoading}
      localLibraryImporting={localLibrary.isImporting}
      localLibraryImportProgress={localLibrary.importProgress}
      localLibraryImportError={localLibrary.importError}
      localLibraryFsAccessSupported={localLibrary.fsAccessSupported}
      activeLibraryEntryId={activeLibraryEntryId}
      onLocalLibraryImportFolder={() => void localLibrary.importFolder()}
      onLocalLibraryImportWebkit={(files) => void localLibrary.importWebkitFiles(files)}
      onLocalLibraryRescanRoot={(rootId) => void localLibrary.rescanRoot(rootId)}
      onLocalLibraryRemoveRoot={(rootId) => void localLibrary.removeRoot(rootId)}
      onLocalLibraryCancelImport={localLibrary.cancelImport}
      onLocalLibraryPlay={handleLocalLibraryPlay}
      playlistItems={playlist.items}
      playlistCurrentIndex={playlist.currentIndex}
      playlistIsPlaying={isPlaying}
      playlistShuffle={playlist.shuffle}
      playlistRepeat={playlist.repeat}
      onPlaylistSelect={handlePlaylistSelect}
      onPlaylistRemove={playlist.remove}
      onPlaylistClear={playlist.clear}
      onPlaylistPrev={handlePlaylistPrev}
      onPlaylistNext={handlePlaylistNext}
      onPlaylistShuffleToggle={playlist.toggleShuffle}
      onPlaylistRepeatCycle={playlist.cycleRepeat}
      onPlaylistFilesAdded={handlePlaylistFilesAdded}
      songsData={songsQuery.data}
      songsLoading={songsQuery.isLoading}
      songsRefreshing={songsQuery.isFetching && !songsQuery.isLoading}
      libraryErrorMessage={libraryErrorMessage}
      onRefreshLibrary={() => void songsQuery.refetch()}
      handleLibrarySongLoad={handleLibrarySongLoad}
      onSyncLibrary={async () => { await syncLibraryMutation.mutateAsync(); }}
      syncPending={syncLibraryMutation.isPending}
      syncLibraryErrorMessage={syncLibraryErrorMessage}
      activeModuleForSave={activeModuleForSave}
      onSaveModule={async (req) => { await saveSongMutation.mutateAsync(req); }}
      savePending={saveSongMutation.isPending}
      saveSongErrorMessage={saveSongErrorMessage}
      cheatsheetOpen={cheatsheetOpen}
      setCheatsheetOpen={setCheatsheetOpen}
      status={status}
      onCopyShareLink={() => void copyShareLink()}
      editMode={patternEdit.editMode}
      onToggleEditMode={patternEdit.toggleEditMode}
      patternEditDirty={patternEdit.isDirty}
      canPatternUndo={patternEdit.canUndo}
      canPatternRedo={patternEdit.canRedo}
      onPatternUndo={patternEdit.undo}
      onPatternRedo={patternEdit.redo}
      onPatternCellEdit={handlePatternCellEdit}
      onPatternCellPatch={patternEdit.editCell}
      onPatternCellClear={patternEdit.clearCell}
      onSequencerCellEdit={handleSequencerCellEdit}
      midiControls={midiControls}
    />
    <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

export default App;
