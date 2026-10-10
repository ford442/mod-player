/**
 * FX rack state (#453): the global rack, user presets, and per-song overrides
 * keyed by the loaded file's fingerprint (utils/songIdentity.ts).
 *
 * `effective` is what plays: the current song's override if it has one, else
 * the global state. Edits go to whichever of the two is effective (`scope`).
 * A song override is a full state, not a diff, so later global edits never
 * silently change a song somebody saved.
 *
 * Audio never reads React state: the lazily loaded rack controller subscribes
 * to `effective` (a new reference only when it changes) with useFxStore.subscribe.
 *
 * Persistence: one localStorage key, zod-validated on read (corrupt or foreign
 * data falls back to defaults), written through utils/localStorageIO.ts,
 * debounced — knob drags and MIDI CCs change state at control rate. Song
 * overrides are capped (least recently used out).
 */
import { z } from 'zod';
import { create } from 'zustand';
import { FX_RACK_ENABLED } from '../appConfig';
import {
  denormalize,
  getParamSpec,
  clampToSpec,
} from '../audio/fx/spec/paramSpecs';
import { FX_FACTORY_PRESETS } from '../audio/fx/spec/presets';
import { cloneFxRackState, defaultFxRackState, parseFxRackState } from '../audio/fx/spec/schema';
import { anyModuleActive, type FxModuleId, type FxRackState } from '../audio/fx/types';
import type { FxModuleStatus } from '../audio/fx/modules/types';
import { readLocalStorage, writeLocalStorage } from '../utils/localStorageIO';
import { getSongFingerprint, subscribeSongFingerprint } from '../utils/songIdentity';

export const FX_STORAGE_KEY = 'xasm1_fx_rack';
export const FX_SONG_OVERRIDE_LIMIT = 200;
export const FX_PERSIST_DEBOUNCE_MS = 250;
/** Preset id while the state matches no preset. */
export const CUSTOM_PRESET_ID = 'custom';
const USER_PREFIX = 'user:';

export interface SongOverride {
  state: FxRackState;
  presetId: string | null;
  lastUsed: number;
}

export interface UserPreset {
  name: string;
  state: FxRackState;
}

export type FxRackRuntimeStatus = 'unloaded' | 'loading' | 'ready' | 'error';

export interface FxModuleRuntime {
  status: FxModuleStatus;
  detail?: string;
}

interface PersistedFx {
  version: 1;
  globalPresetId: string;
  globalState: FxRackState;
  userPresets: Record<string, UserPreset>;
  songOverrides: Record<string, SongOverride>;
}

export interface FxStoreState extends PersistedFx {
  songFingerprint: string | null;
  /** What plays: the song override if present, else the global state. */
  effective: FxRackState;
  /** Where edits go. */
  scope: 'global' | 'song';
  effectivePresetId: string | null;
  rackStatus: FxRackRuntimeStatus;
  moduleStatus: Partial<Record<FxModuleId, FxModuleRuntime>>;

  setModuleEnabled(id: FxModuleId | 'rack', enabled?: boolean): void;
  setParam(module: FxModuleId, key: string, value: number | boolean | string, opts?: { normalized?: boolean }): void;
  moveModule(id: FxModuleId, delta: -1 | 1): void;
  applyPreset(id: string): void;
  stepPreset(delta: 1 | -1): void;
  selectPresetByIndex(index: number): void;
  saveForThisSong(): void;
  resetSongToGlobal(): void;
  saveUserPreset(name: string): string;
  deleteUserPreset(id: string): void;
  setSongFingerprint(fingerprint: string | null): void;
  setRackStatus(status: FxRackRuntimeStatus): void;
  setModuleStatus(id: FxModuleId, status: FxModuleStatus, detail?: string): void;
  /** The state WAV export renders through, or null for a dry export. */
  exportSnapshot(): FxRackState | null;
}

const rackState = z.unknown().transform((v) => parseFxRackState(v));

const PersistedSchema = z.object({
  version: z.literal(1),
  globalPresetId: z.string().catch('flat'),
  globalState: rackState,
  userPresets: z.record(z.string(), z.object({ name: z.string(), state: rackState })).catch({}),
  songOverrides: z
    .record(
      z.string(),
      z.object({
        state: rackState,
        presetId: z.string().nullable().catch(null),
        lastUsed: z.number().catch(0),
      }),
    )
    .catch({}),
});

function defaults(): PersistedFx {
  return {
    version: 1,
    globalPresetId: 'flat',
    globalState: defaultFxRackState(),
    userPresets: {},
    songOverrides: {},
  };
}

function loadPersisted(): PersistedFx {
  const raw = readLocalStorage<unknown>(FX_STORAGE_KEY, null);
  if (raw === null) return defaults();
  const parsed = PersistedSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn('[FX] Ignoring unreadable saved FX settings', parsed.error.issues[0]?.message);
    return defaults();
  }
  return parsed.data as PersistedFx;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(get: () => FxStoreState): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const s = get();
    const data: PersistedFx = {
      version: 1,
      globalPresetId: s.globalPresetId,
      globalState: s.globalState,
      userPresets: s.userPresets,
      songOverrides: s.songOverrides,
    };
    writeLocalStorage(FX_STORAGE_KEY, data);
  }, FX_PERSIST_DEBOUNCE_MS);
}

/** Flush a pending write now (tests; page hide). */
export function flushFxPersist(): void {
  if (persistTimer === null) return;
  clearTimeout(persistTimer);
  persistTimer = null;
  const s = useFxStore.getState();
  writeLocalStorage(FX_STORAGE_KEY, {
    version: 1,
    globalPresetId: s.globalPresetId,
    globalState: s.globalState,
    userPresets: s.userPresets,
    songOverrides: s.songOverrides,
  } satisfies PersistedFx);
}

type Derived = Pick<FxStoreState, 'effective' | 'scope' | 'effectivePresetId'>;

function derive(s: PersistedFx & { songFingerprint: string | null }, prev?: Derived): Derived {
  const override = s.songFingerprint ? s.songOverrides[s.songFingerprint] : undefined;
  const effective = override ? override.state : s.globalState;
  return {
    // Keep the reference when nothing changed: subscribers compare by identity.
    effective: prev && prev.effective === effective ? prev.effective : effective,
    scope: override ? 'song' : 'global',
    effectivePresetId: override ? override.presetId : s.globalPresetId,
  };
}

function pruneOverrides(overrides: Record<string, SongOverride>): Record<string, SongOverride> {
  const entries = Object.entries(overrides);
  if (entries.length <= FX_SONG_OVERRIDE_LIMIT) return overrides;
  entries.sort((a, b) => b[1].lastUsed - a[1].lastUsed);
  return Object.fromEntries(entries.slice(0, FX_SONG_OVERRIDE_LIMIT));
}

/** All presets in picker order: factory, then user presets by name. */
export function listFxPresets(userPresets: Record<string, UserPreset>): { id: string; name: string; state: FxRackState }[] {
  const user = Object.entries(userPresets)
    .map(([id, p]) => ({ id, name: p.name, state: p.state }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...FX_FACTORY_PRESETS, ...user];
}

const initial = loadPersisted();
const initialFingerprint = getSongFingerprint();

export const useFxStore = create<FxStoreState>((set, get) => {
  /** Replace the effective state (song override or global) with `next`. */
  const commit = (next: FxRackState, presetId: string | null) => {
    const s = get();
    const state = parseFxRackState(next);
    if (s.scope === 'song' && s.songFingerprint) {
      const songOverrides = {
        ...s.songOverrides,
        [s.songFingerprint]: { state, presetId, lastUsed: Date.now() },
      };
      set({ songOverrides, ...derive({ ...s, songOverrides }, s) });
    } else {
      const globalPresetId = presetId ?? CUSTOM_PRESET_ID;
      set({ globalState: state, globalPresetId, ...derive({ ...s, globalState: state, globalPresetId }, s) });
    }
    schedulePersist(get);
  };

  const editEffective = (edit: (draft: FxRackState) => void) => {
    const draft = cloneFxRackState(get().effective);
    edit(draft);
    commit(draft, null);
  };

  const applyPresetState = (id: string) => {
    const preset = listFxPresets(get().userPresets).find((p) => p.id === id);
    if (preset) commit(cloneFxRackState(preset.state), id);
  };

  return {
    ...initial,
    songFingerprint: initialFingerprint,
    ...derive({ ...initial, songFingerprint: initialFingerprint }),
    rackStatus: 'unloaded',
    moduleStatus: {},

    setModuleEnabled(id, enabled) {
      editEffective((draft) => {
        if (id === 'rack') draft.enabled = enabled ?? !draft.enabled;
        else draft.modules[id].enabled = enabled ?? !draft.modules[id].enabled;
      });
    },

    setParam(module, key, value, opts) {
      const spec = getParamSpec(module, key);
      if (!spec) return;
      let next: number | boolean | string;
      if (spec.kind === 'number') {
        if (typeof value !== 'number') return;
        next = opts?.normalized ? denormalize(spec, value) : clampToSpec(spec, value);
      } else if (spec.kind === 'bool') {
        next = typeof value === 'boolean' ? value : typeof value === 'number' ? value >= 0.5 : value === 'true';
      } else {
        const values = spec.options.map((o) => o.value);
        if (typeof value === 'number') {
          // Normalized 0…1 spans the options (MIDI CC); otherwise it's an index.
          const index = Math.round(opts?.normalized ? value * (values.length - 1) : value);
          next = values[Math.min(values.length - 1, Math.max(0, index))]!;
        } else if (typeof value === 'string' && values.includes(value)) {
          next = value;
        } else {
          return;
        }
      }
      editEffective((draft) => {
        (draft.modules[module].params as unknown as Record<string, unknown>)[key] = next;
      });
    },

    moveModule(id, delta) {
      editEffective((draft) => {
        const i = draft.order.indexOf(id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= draft.order.length) return;
        [draft.order[i], draft.order[j]] = [draft.order[j]!, draft.order[i]!];
      });
    },

    applyPreset(id) {
      applyPresetState(id);
    },

    stepPreset(delta) {
      const presets = listFxPresets(get().userPresets);
      const current = presets.findIndex((p) => p.id === get().effectivePresetId);
      const next = (current < 0 ? (delta > 0 ? 0 : presets.length - 1) : current + delta + presets.length) % presets.length;
      applyPresetState(presets[next]!.id);
    },

    selectPresetByIndex(index) {
      const preset = listFxPresets(get().userPresets)[index];
      if (preset) applyPresetState(preset.id);
    },

    saveForThisSong() {
      const s = get();
      if (!s.songFingerprint) return;
      const songOverrides = pruneOverrides({
        ...s.songOverrides,
        [s.songFingerprint]: {
          state: cloneFxRackState(s.effective),
          presetId: s.effectivePresetId === CUSTOM_PRESET_ID ? null : s.effectivePresetId,
          lastUsed: Date.now(),
        },
      });
      set({ songOverrides, ...derive({ ...s, songOverrides }, s) });
      schedulePersist(get);
    },

    resetSongToGlobal() {
      const s = get();
      if (!s.songFingerprint || !s.songOverrides[s.songFingerprint]) return;
      const songOverrides = { ...s.songOverrides };
      delete songOverrides[s.songFingerprint];
      set({ songOverrides, ...derive({ ...s, songOverrides }, s) });
      schedulePersist(get);
    },

    saveUserPreset(name) {
      const s = get();
      const id = `${USER_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const userPresets = { ...s.userPresets, [id]: { name: name.trim() || 'Preset', state: cloneFxRackState(s.effective) } };
      set({ userPresets });
      commit(cloneFxRackState(s.effective), id);
      return id;
    },

    deleteUserPreset(id) {
      const s = get();
      if (!s.userPresets[id]) return;
      const userPresets = { ...s.userPresets };
      delete userPresets[id];
      const patch: Partial<FxStoreState> = { userPresets };
      if (s.globalPresetId === id) patch.globalPresetId = CUSTOM_PRESET_ID;
      set(patch);
      set(derive({ ...get() }, get()));
      schedulePersist(get);
    },

    setSongFingerprint(fingerprint) {
      const s = get();
      if (fingerprint === s.songFingerprint) return;
      let songOverrides = s.songOverrides;
      const override = fingerprint ? songOverrides[fingerprint] : undefined;
      if (fingerprint && override) {
        songOverrides = { ...songOverrides, [fingerprint]: { ...override, lastUsed: Date.now() } };
        schedulePersist(get);
      }
      set({ songFingerprint: fingerprint, songOverrides, ...derive({ ...s, songFingerprint: fingerprint, songOverrides }, s) });
    },

    setRackStatus(rackStatus) {
      set({ rackStatus });
    },

    setModuleStatus(id, status, detail) {
      set((s) => ({ moduleStatus: { ...s.moduleStatus, [id]: detail ? { status, detail } : { status } } }));
    },

    exportSnapshot() {
      if (!FX_RACK_ENABLED) return null;
      const s = get();
      if (!anyModuleActive(s.effective)) return null;
      const snapshot = cloneFxRackState(s.effective);
      // A room this browser can't load renders dry rather than failing the export.
      if (s.moduleStatus.room?.status === 'unavailable') snapshot.modules.room.enabled = false;
      return anyModuleActive(snapshot) ? snapshot : null;
    },
  };
});

subscribeSongFingerprint((fingerprint) => useFxStore.getState().setSongFingerprint(fingerprint));
