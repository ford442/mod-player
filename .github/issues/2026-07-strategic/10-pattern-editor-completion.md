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

- [ ] User can enter edit mode, change cells, undo/redo, revert, and exit without breaking playback
- [ ] Dirty state is visible; switching modules prompts when dirty
- [ ] At least one “save out” path works (WAV of edited session and/or pattern dump); full binary module rewrite explicitly in or out of scope in the issue resolution notes
- [ ] Existing `patternEdit` tests expanded for new behaviors; CI green
- [ ] Default play-only UX unchanged when edit mode is off

## Dependencies / libraries

None required for MVP. Full `.xm` rewrite might need additional investigation of libopenmpt write APIs — spike before committing to that scope.

## Notes

Grounded in existing editor code + prior #322. Prefer completing the loop over building a full FastTracker clone.
