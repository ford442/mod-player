---
title: "P1: Split useWebGPURender and break types↔hooks cycles"
priority: P1
type: Refactor
complexity: L
labels: [refactor, webgpu, core]
---

## Problem / opportunity

`hooks/useWebGPURender.ts` (~1258 LOC) is the GPU god-hook: device/pipeline lifecycle, buffer packing upload, bloom integration, textures (osc/palette), and per-frame draw. PR #257 split files over 1000 lines, but complexity moved sideways — this hook and `useLibOpenMPT` remain over budget.

Madge also reports **cycles**: `types.ts` → `src/renderers/types.ts` → `hooks/useWebGPURender.ts` → packing/`computeNoteDuration`. Renderer **types** should not import the WebGPU hook.

## Proposed solution

1. Extract pure modules (no React) under `src/renderers/webgpu/` or `utils/webgpu/`:
   - device/pipeline factory
   - buffer/bind-group managers
   - frame upload (`writeBuffer` packing path)
   - bloom wiring adapter
2. Keep a thin `useWebGPURender` as the React glue (refs, effects, rAF).
3. Move shared renderer types to a cycle-free module (`src/renderers/types.ts` must not import hooks).
4. Re-run madge / document “no hooks imports from types” in AGENTS.
5. Preserve public agent API: `window.currentPatternRenderer` behavior for WebGL2/HTML unchanged; WebGPU path behavior byte-compatible for registered shaders.

## Acceptance criteria

- [ ] `useWebGPURender.ts` under ~700 LOC (or clearly split modules totaling same responsibility)
- [ ] No circular dependency involving `hooks/useWebGPURender` ↔ `src/renderers/types`
- [ ] Visual smoke (`smoke:visual:ci`) still green
- [ ] Packing / duration / trigger Vitest suites still pass
- [ ] No intentional visual changes to production shaders

## Dependencies / libraries

None new. Optional: `madge` as a CI/dev script (devDependency) to gate cycles.

## Notes

Pairs with MainLayout store work: clearer GPU boundary makes PatternDisplay a true facade and simplifies renderer selection.
