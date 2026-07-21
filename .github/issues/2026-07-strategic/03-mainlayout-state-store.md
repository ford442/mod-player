---
title: "P1: Decompose MainLayout prop drilling into a player UI store"
priority: P1
type: Refactor
complexity: L
labels: [refactor, state, ui, core]
---

## Problem / opportunity

`components/MainLayout.tsx` accepts ~**169 prop fields**. `App.tsx` (~1168 LOC) owns composition **and** feature orchestration (shader prefs, bloom, night/CRT, playlist, library, MIDI, export, pattern edit, share). Every new panel (export, library, editor, MIDI) extends the prop bag. This is the highest structural tax on feature velocity and a frequent source of missed wiring / stale props.

Zustand is already a dependency and used well for `store/libraryStore.ts`. The rest of the app never adopted that pattern.

## Proposed solution

Incremental extraction (do not big-bang rewrite):

1. **Define store slices** (suggested):
   - `playerUiStore` — panel visibility, theme, lite/reactive toggles, cheatsheet/debug
   - `shaderPrefsStore` — shaderFile, favorites/recents, bloom, night, CRT, palette, stepsLength
   - Keep **high-frequency audio** on refs from `useLibOpenMPT` (do **not** put `channelStates` / playhead into React/Zustand state)
2. **Thin `MainLayout`** to read stores + a small set of playback props/callbacks (or a `PlayerSession` context for play/stop/seek/volume only).
3. Migrate one panel cluster per PR (e.g. library panels first, then shader chrome, then export/edit) so reviews stay reviewable.
4. Add a short ADR in `docs/` describing what belongs in stores vs refs vs props.

## Acceptance criteria

- [ ] `MainLayoutProps` reduced substantially (target &lt; ~40 explicit props, or equivalent context/store reads)
- [ ] No regression: play/stop/seek, shader switch, library browse, export panel still work
- [ ] High-frequency audio data remains on mutable refs (no 60 Hz React store updates for VU/channel states)
- [ ] `npm test`, `typecheck`, `lint` green
- [ ] Follow-up features (a11y, instrument panel, editor) can mount without adding 10+ props to MainLayout

## Dependencies / libraries

None new — use existing `zustand`.

## Notes

Unlocks issues 07–08–10 (a11y settings, instrument inspector, pattern editor) without further prop explosion. Prefer landing after or in parallel with CI/audio harness so refactors are protected.
