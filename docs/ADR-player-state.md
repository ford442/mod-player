# ADR: Player UI state — stores vs context vs refs

**Status:** Accepted (2026-07); playback-session layer superseded by the PlayerEngine (2026-10, #492 — see below)  
**Context:** `MainLayout` previously accepted ~169 props drilled from `App.tsx`. Feature panels (library, export, MIDI, pattern edit) each added more wiring surface.

## Decision

Split player chrome state into three layers:

| Layer | Mechanism | What belongs here |
|-------|-----------|-------------------|
| **UI prefs** | `store/playerUiStore.ts` (Zustand) | Theme, lite/reactive toggles, panel visibility, debug/cheatsheet chrome. Persisted keys match existing `localStorage` names. |
| **Shader prefs** | `store/shaderPrefsStore.ts` (Zustand) | `shaderFile`, favorites/recents/thumbnails, bloom/color/night/CRT/palette/steps. Per-module shader memory via `moduleHash` + `selectShader()`. |
| **Playback session** | `context/PlayerSessionContext.tsx` | Play/stop/seek, volume/pan, module load status, sequencer matrix snapshot, analyser + **mutable refs** (`playbackStateRef`, `channelStatesRef`, `oscBufferRef`, `audioReactiveRef`). |
| **Feature panels** | `context/PlayerFeaturesContext.tsx` | Library, playlist, export/capture, pattern edit, media overlay, MIDI, shader catalog API — stable callbacks from `App.tsx`. |

`MainLayout` reads stores + contexts directly (**zero props**).

## Rules

1. **Never put high-frequency audio in Zustand** — VU, per-quantum channel shadow state, and fractional playhead stay on refs inside `useLibOpenMPT`; only display-rate snapshots enter React context.
2. **Stores own persistence** — use `utils/localStorageIO.ts` (same JSON format as the former `useLocalStorage` hook) so existing user prefs survive the refactor.
3. **New panels mount via store or features context** — do not add props to `MainLayout`; extend `PlayerFeaturesValue` or add a focused store slice.
4. **App.tsx stays the composition root** — wires hooks, builds context values, registers keyboard/MIDI/share side effects.

## Consequences

- Follow-up features (a11y settings, instrument inspector, editor chrome) can subscribe to `usePlayerUiStore` / `useShaderPrefsStore` or extend `PlayerFeaturesContext` without prop explosion.
- `App3DView` and `ProjectMEmbedView` still receive explicit props (separate entry layouts; future work may share session context).
- Incremental migration: library + shader chrome landed first; additional panel logic can move behind feature sub-hooks in later PRs.

## Verification

```bash
npm run typecheck
npm test
npm run lint
```

Manual: play/stop/seek, shader switch, library browse, export panel, share URL, pattern edit toggle.

## Update (2026-10, #492): the playback session is a PlayerEngine

The "Playback session" row above is gone. `PlayerSessionContext` carried ~50 fields — including the
playhead — in one value, so every consumer re-rendered on every row, and App threaded the 29 UI-store
values it selected into it. Now:

| Layer | Mechanism | What belongs here |
|-------|-----------|-------------------|
| **Player** | `audio/engine/PlayerEngine.ts` (framework-free) + `hooks/usePlayerEngine.ts` | Transport (an FSM), module, levels, engine selection, status; high-rate refs (`playbackStateRef`, `channelStatesRef`, `oscBufferRef`, `audioReactiveRef`) on the engine. Components select snapshot fields with `usePlayerEngine(selector)` (useSyncExternalStore) and call the engine / `usePlayerActions()`; derived values live in `hooks/usePlayerView.ts`. |

Rule 1 still holds, and is now structural: high-frequency audio never enters the snapshot. Rule 4 is
narrower: App wires app-level features (library, media, export, share) and mounts the engine; it does
not pass player state or store values down — `App3DModeShell` and `ProjectMEmbedHost` select their own.
