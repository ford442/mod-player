---
title: "P0: Audio silent-playback regression harness (worklet lifecycle)"
priority: P0
type: Foundation / Test
complexity: M
labels: [audio, test, core, bug]
---

## Problem / opportunity

Production hit a **silent-playback cascade** in mid-July:
- #329 — every `play()` re-initialized libopenmpt in the shared `AudioWorkletGlobalScope`, corrupting the WASM heap (silent XM after module switch + runaway `ended → seek 0`).
- #330 — `stopMusic` suspended `AudioContext`; `resume()` after `suspend()` needs a fresh user gesture, so auto-play from picker/playlist/share URL played silently.

Both fixes are **merged**, but `weekly_plan.md` still calls out **standing debt**: no automated regression guard for either root cause. Without a harness, the next worklet/cache/init change can reintroduce “Playing but no sound” — the worst failure mode for a music player.

## Proposed solution

Add an automated guard covering the two exact root causes:

1. **Unit / worklet-lifecycle assertions** (preferred first slice):
   - Assert `play()` / module reload does **not** re-init libopenmpt in the shared worklet scope when a module is already loaded (singleton path).
   - Assert normal `stopMusic(false)` / reload does **not** leave the graph’s `AudioContext` in `suspended` solely due to stop (keep-alive contract).
   - Prefer pure assertions against extracted helpers or a thin test double of the worklet message protocol where full AudioContext isn’t available in Node.

2. **Playwright smoke slice** (second slice, optional in same PR or follow-up):
   - Load default module with `?renderer=html` (CI-friendly).
   - Exercise: file reload, MOD↔XM switch stub, stop→play.
   - Assert UI does not enter a runaway seek loop; assert `activeEngine` / status does not claim Playing while worklet reports error (best-effort without requiring audible output in headless).

3. Document the harness in `docs/WORKLET_AUDIO_BUG.md` as prevention.

Touch only the audio path + tests: `hooks/useLibOpenMPT.ts`, `useAudioGraph.ts`, `useWorkletLoader.ts`, `public/worklets/openmpt-worklet.js`, new tests under `tests/` or `scripts/`.

## Acceptance criteria

- [ ] Automated test(s) fail if `play()` re-inits shared worklet libopenmpt when already initialized
- [ ] Automated test(s) fail if normal stop/reload suspends AudioContext (keep-alive contract)
- [ ] Tests run in CI (depends on / pairs with Vitest CI gate)
- [ ] Manual checklist for audible paths remains in docs (default auto-load, picker, storage playlist, share URL, MOD↔XM)
- [ ] No shader/packing/registry changes

## Dependencies / libraries

None required. May reuse existing Playwright (already used for `smoke:visual`).

## Notes

Highest-leverage foundation work after CI gate — protects the core product promise.
