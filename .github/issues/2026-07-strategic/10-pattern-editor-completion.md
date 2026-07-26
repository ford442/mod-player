---
title: "P2: Pattern editor completion — edit → undo → export round-trip"
priority: P2
type: Feature
complexity: L
labels: [feature, ui, enhancement]
---

## Problem / opportunity

A lightweight pattern editor already exists (`components/PatternEditor.tsx`, `usePatternEdit`, Vitest `patternEdit.test.ts`) with edit mode, cell patch/clear, undo/redo hooks wired through App/MainLayout. Prior tracker **#322** treated this as a larger incomplete feature: editing is early/partial and does not yet feel like a durable creator workflow (persist, export edited module, clear dirty-state UX).

Offline WAV export (#333) makes “edit then bounce” newly valuable.

## Proposed solution

1. **Productize existing editor**
   - Clear entry/exit UX; dirty indicator; confirm on module switch
   - Keyboard editing parity with display fields (note/inst/vol/effect) without breaking playhead shortcuts
2. **Persistence path**
   - Export edited pattern matrix back to a downloadable module **or** document honest limits if full module rewrite is out of scope — prefer: export WAV of edited playback + JSON/pattern dump MVP if full `.xm` rewrite is XL
   - If full module rewrite is feasible via libopenmpt interactive APIs, spike first and report
3. **Safety**
   - Undo/redo stack limits; revert to last loaded matrix
   - Editor disabled or read-only while offline export running
4. Mount via player UI store (issue 03) to avoid further MainLayout growth.

## Acceptance criteria

- [x] User can enter edit mode, change cells, undo/redo, revert, and exit without breaking playback
- [x] Dirty state is visible; switching modules prompts when dirty
- [x] At least one “save out” path works (WAV of edited session and/or pattern dump); full binary module rewrite explicitly in or out of scope in the issue resolution notes
- [x] Existing `patternEdit` tests expanded for new behaviors; CI green
- [x] Default play-only UX unchanged when edit mode is off

## Dependencies / libraries

None required for MVP. Full `.xm` rewrite might need additional investigation of libopenmpt write APIs — spike before committing to that scope.

## Notes

Grounded in existing editor code + prior #322. Prefer completing the loop over building a full FastTracker clone.

## Resolution notes (2026-07)

### Spike: libopenmpt module rewrite

**Full binary `.mod`/`.xm`/`.it` rewrite: out of scope.**

libopenmpt (playback library) exposes pattern **read**/format APIs and `interactive` runtime controls (mute, tempo, etc.) only. There is no `set_pattern_*`, save, or export API. Audio and offline WAV continue to render from the original module bytes (`fileDataRef` / `getModuleFileData`).

### MVP shipped

| Area | Implementation |
|------|----------------|
| Chrome | `editMode` in `store/playerUiStore.ts` (not persisted); MainLayout mounts editor from store |
| Edits | Session-only `PatternMatrix` via `usePatternEdit` + `replacePatternMatrix` (visualizer only) |
| Dirty UX | `Edit *`, panel "unsaved", `beforeunload`, confirm on module switch and Revert |
| Keyboard | Tab field cycle; hex nibble entry for inst/vol/eff; piano keys for notes |
| Save-out | JSON pattern dump (`utils/patternDump.ts`) — Download pattern JSON / Dump JSON |
| Export lock | Editor read-only / controls disabled while `isExporting` |
| Honest limits | Banner: edits do not change audio or WAV export |

### Explicit non-goals (still)

- WAV of *edited* playback (requires a custom format rewriter)
- FastTracker-clone UX (octave shift, multi-select, block copy/paste)
