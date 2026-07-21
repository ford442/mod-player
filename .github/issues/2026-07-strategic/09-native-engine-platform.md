---
title: "P2: Native C++ engine platform — CI cache, force-JS, unified schema"
priority: P2
type: Foundation
complexity: XL
labels: [audio, core, enhancement]
---

## Problem / opportunity

The native Emscripten engine exists end-to-end (`cpp/`, `OpenMPTWorkletEngine`, `openmpt-native.*`) but remains optional/experimental. Gaps are documented in `docs/planning/native-engine-platform-epic.md`:

- PR CI never proves full `build:emcc` link; weekly job rebuilds libopenmpt from source without cache.
- Prefer-when-present exists, but **no durable force-JS** override for debugging with artifacts present.
- Position/VU/PCM schema not fully unified with JS worklet → duplicated apply paths in `useLibOpenMPT` / `useAudioGraph`.
- Native clock still poll-tagged with main `AudioContext.currentTime` in places; MediaRecorder capture blocked on dual AudioContext (`docs/EXPORT.md`).

## Proposed solution

Execute the epic in phases:

1. **CI/DX:** cache `libopenmpt.a` / vendor tree for scheduled + path-filtered PR builds; keep JS worklet clobber guards.
2. **Flags:** `?engine=js|native` + `localStorage.xasm1_audio_engine`; document precedence in `public/worklets/README.md` + AGENTS.
3. **Schema unify:** one apply path for position/VU/PCM messages between native and JS worklet.
4. **Clock:** sample-accurate native timing feeding the same prediction pipeline as issue 05.
5. **Capture:** document or bridge native into a recordable graph (or keep explicit “switch to JS for capture”).

Production default remains JS worklet until native matches sync + reliability bars.

## Acceptance criteria

- [ ] Documented engine precedence + force-JS override works
- [ ] Scheduled (and ideally path-filtered PR) native build uses cached libopenmpt artifacts when possible
- [ ] Shared position/VU apply path used by both engines
- [ ] `verify:native-exports` + worklet integrity guards remain green
- [ ] Capture behavior documented; no silent dual-context recording failures
- [ ] Benchmark note: main-thread cost native vs JS on a large IT (even informal)

## Dependencies / libraries

No npm libraries. CI may add cache actions for emsdk/libopenmpt build outputs.

## Notes

XL multi-phase epic — can spawn sub-issues. Do not block web feature work (#07–#08–#10) on native completion.
