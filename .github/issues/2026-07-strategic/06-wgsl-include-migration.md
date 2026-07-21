---
title: "P1: Finish WGSL include migration for remaining production shaders"
priority: P1
type: DX
complexity: M
labels: [shader, maintenance, webgpu]
---

## Problem / opportunity

#318 landed a modular WGSL include system (`scripts/sync-shaders.mjs`, `shaders/lib/`, Vitest include tests). The **Night trio (v0.52–54)** and partial **v0.51** migrated; many other production shaders remain monolithic forks. That reintroduces copy-paste drift (octave brightness, packing decode, emitters, ACES) — exactly the pain that motivated #318.

## Proposed solution

1. Audit production picker shaders in `appConfig.ts` `SHADER_GROUPS` vs `shaders/lib/` coverage (`notes`, `pitch`, `dura`, `palette`, `sdf`, emitters, tonemap, themes).
2. Migrate in family batches (circular LED family first: v0.45–v0.50/v0.57; then square; leave `shaders/legacy/` alone unless still in picker).
3. Require byte-identical or comment-only diffs vs pre-migration expanded output (same approach as Night trio).
4. Keep `npm run sync:shaders` + `test:shader-includes` + `test:shader-registry` green.
5. Do **not** reintroduce `shaderFile.includes('v0.XX')` chains — registry remains SSOT.

## Acceptance criteria

- [ ] All **picker-listed** production pattern shaders either use `//#include` for shared logic or have an explicit documented exception
- [ ] Expanded `public/shaders/` remains generated-only (no hand edits)
- [ ] Visual smoke CI green for existing profile shaders
- [ ] Packing/duration/trigger/octave parity tests still pass
- [ ] AGENTS/CLAUDE note updated: migration status table

## Dependencies / libraries

None new.

## Notes

Makes reactive chassis / new visual features (issues 07–08 adjacent) cheaper and safer.
