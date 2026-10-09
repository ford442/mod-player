# Roadmap

Living pointer to active work. **Do not** append agent run diaries here — use GitHub issues and PRs for status.

**Last reconciled:** 2026-10-09. Since 2026-10-02: #460 (`a643822`) salvaged the pieces of three stale branches that never reached `main` — `utils/audioAnalysisBus.ts` (one throttled analysis snapshot fan-out; `ComputeAnalysis` publishes, the CPU `AnalyserNode` producer parks while GPU analysis is live), `loadModule` awaiting `play()`, the `VITE_NATIVE_PARITY_GATE=1` build gate, and untracking `__pycache__/`. CI on `main` is **green** (run 642 on `a643822`). No open PRs. The owner filed two issues on 2026-10-07: **#461** (pause/resume) and **#462** (opt-in WebGL2 visualizer fallback, explicit badge, never silent). #462 **is** the #436 decision: Option B, opt-in only, so #436 stops waiting on an owner call and #417 is unblocked once it lands.

**Correction:** earlier reconciles called the real-WASM libopenmpt change "#449". That was **#439** (`2d6a4ed`). #449 is the WebGPU render-loop issue above, which is what `CLAUDE.md` pitfall 14 cites.

**Foundation state:** stable. #436 (WebGL2 decision) now has its owner decision in #462 (opt-in session, persistent badge, hard-fail stays the default); close #436 when #462 lands. #437 is **still open** on GitHub although its code landed in #445. Close it. `dist/` (21 files) and `test-results/.last-run.json` are still tracked (#451 §6).

## ✅ CI history — three breaks (runs 597–603), all fixed

**Current state: green.** Runs 612 (`048230c`), 614 (`eca1c82`) and 616 (`b75ce9e`) all passed. Runs 606–610 (2026-09-12) were red from the same direct-to-`main` `push fix` pattern and were cleared by the #432 merge.

Runs 597–603 of `ci.yml` were three **independent** breaks, all introduced by direct `push fix` commits to `main`. Kept here because the failure modes are worth remembering.

| # | Break | Status |
|---|-------|--------|
| 1 | `65c0885` deleted **512 lines** from `package-lock.json` with no `package.json` change, stripping the nested `vitest/node_modules/@esbuild/*@0.28.2` subtree plus top-level `netbsd-arm64` / `openbsd-arm64` / `openharmony-arm64`. **All six jobs** died in ~45 s at `npm ci` ("Missing: @esbuild/…@0.28.2 from lock file"). | **Fixed** — lockfile restored to pre-deletion content (exact 512-line reversal, no version drift). |
| 2 | `tests/resolveNativeFactory.test.ts` declared an unused `obj` param → `typecheck:tests` TS6133 under `noUnusedParameters`. | **Fixed** — renamed `_obj`, matching the convention in `nativePatternReader.test.ts`. |
| 3 | `7572ef8` put `-fno-exceptions` in `COMPILE_FLAGS`, which `scripts/build-wasm.sh` passes to the **single combined compile+link** `emcc` invocation (line ~445). emcc then infers `DISABLE_EXCEPTION_THROWING=1` at link, which collides with `__cxa_throw` pulled in from `libopenmpt.a`. `native-full-build` has been red since 2026-09-05; `native-wasm-scheduled.yml` run 9 (2026-09-07) also failed. | **Fixed** — `build-wasm.sh` now compiles and links in two phases (#412). |

Break 3 contradicts the script's own documented contract ("Catching stays enabled: libopenmpt.a requires try/catch. Wrapper objects are still compiled with `-fno-exceptions`"). Throwing was disabled *implicitly*, which was never intended.

Fixed 2026-09-12 under #412, **verified against emsdk 3.1.51** (release and `--debug` both link). The candidate fix noted here (`-sDISABLE_EXCEPTION_THROWING=0`) was not taken — it would have linked full throw support back in to satisfy a `libopenmpt.a` boundary that is dead code anyway. Instead the build is now two `em++` phases: `-fno-exceptions`/`-fno-rtti` live in `CXX_ONLY_FLAGS` and never reach the link line. Two things the reconciliation got wrong and are worth recording:

- **The documented contract was already false.** The link resolves `libc++abi-ww-noexcept` (`DISABLE_EXCEPTION_CATCHING` defaults to 1), so `libopenmpt_c.cpp`'s `try`/`catch` blocks have never been live in any green build here — a throw aborts the module rather than returning an error code. The flag is now set **explicitly** in `EMSCRIPTEN_FLAGS` so this stops depending on an emcc default. (Rebuilding `libopenmpt.a` itself with `-fno-exceptions` remains impossible — verified: `libopenmpt_c.cpp` fails with "cannot use 'try' with exceptions disabled".)
- **`--debug` was broken independently.** Its `COMPILE_FLAGS` lacked `-mbulk-memory -matomics`, and `wasm-ld` rejects `--shared-memory` against objects without those features. Break 3 masked it; both are fixed.

Because a throw is an `abort()`, argument validation is not optional in `cpp/openmpt_wrapper.cpp`. Three reachable aborts were found and fixed while closing #412: `setChannelMute` past the module's channel count (the worklet replays a 32-bit mute mask across module loads), an unknown `set_render_param` id, and an unknown `ctl_set_text` key. Each one killed the whole worklet.

**Lesson worth keeping:** `npm ci` is the first step of every job in `ci.yml`. A hand-edited lockfile takes the whole matrix down and every failure looks identical, which hides the two unrelated breaks underneath it. Regenerate lockfiles with npm, never by editing.

## ✅ `stageMode` remount regression fixed — #427 closed 2026-09-18

The `{stageMode ? <PerformanceStage/> : <ChromeLayout/>}` subtree swap recorded here on 2026-09-11 is **gone**. Verified in tree on `b75ce9e`:

- `components/MainLayout.tsx` renders `<ChromeLayout />` unconditionally and expresses stage mode as CSS only (`data-stage-mode` attribute + `w-screen h-screen bg-black` classes on the root).
- `components/ChromeLayout.tsx` keeps `<PerformanceStage />` at a fixed sibling index between two `stage-chrome` wrappers that are hidden with `aria-hidden`, not unmounted. Its docblock states the invariant.
- `store/playerUiStore.ts` `setStageMode` / `toggleStageMode` write `STAGE_MODE_STORAGE_KEY` and set `{ stageMode }` only — the `editMode: stageMode ? false : state.editMode` mutation is gone, so panel prefs survive a round trip.
- `tests/stageModeLayout.test.ts` pins both halves (no `stageMode ?` ternary in either file; `PerformanceStage` lives in `ChromeLayout`, not `MainLayout`).

Landed by `8175cc9` (`fix(stage): URL ?stage= preference, toggle/exit commands, layout`). The file split deviates from the names #427 proposed (`ChromeLayout` / `PerformanceStage` / `GlobalControlsBar` / `TransportBar` / `SidePanelGrid` / `PatternEditorSection` / `LibraryAndPlaylistSection` instead of `components/layout/Chrome*.tsx`), but the governing rule — the `<canvas>` and audio graph must not remount on toggle — is satisfied.

**The same bug class is still live for 3D mode**, which is what #427 originally cited as the anti-pattern: `App.tsx:508` still early-returns `<App3DModeShell />`, and `components/App3DView.tsx:159` remounts `PatternDisplay` again with `key={shader3D}`. Tracked as **#437**. It landed via #445 on 2026-09-18.

**#411 audio-graph leftovers are now cleared:** `utils/audioContextFactory.ts` is the single `AudioContext` construction site (one context per page session, `sampleRate` locked to 48000, `latencyHint` from the stage-mode / `?latency=` profile), and the `?nativeCtx=legacy` dual-context path — `parseNativeCtxQueryParam`, `isNativeLegacyAudioContext`, the dual-context capture block and `public/worklets/native-bridge-processor.js` — is deleted. Still outstanding on #411: `docs/planning/native-engine-bench-notes.md` now carries the methodology plus **one** recorded JS baseline row (2026-09-18); the native column is still empty and needs an emsdk 3.1.51 host to fill.

**Build on foundation before new content.** #437 has landed, so #438 (spectrum-shader family) is unblocked. #417 (performance instrument) is unblocked once #462 lands (the #436 decision is made: opt-in WebGL2 session). #403 (tracker studio) can proceed in parallel with P1; typed worklets (#435) are done, so its sample-audition worklet builds on `audio-worklet/js/` instead of adding more untyped classic JS.

## Active (do now)

| Priority | Issue | Summary |
|----------|-------|---------|
| P1 (feature, **current focus**) | [#462](https://github.com/ford442/mod-player/issues/462) / [#436](https://github.com/ford442/mod-player/issues/436) | Opt-in WebGL2 visualizer when WebGPU hard-fails. Owner policy: **never silent** — only via `?webgl2=1` or the "Use WebGL2 visualizer" button on the failure card in `components/PatternDisplay.tsx`, with a persistent badge and one `console.warn`. The GLSL session already exists and is unreachable: `src/renderers/webgl2/WebGL2PatternRenderer.ts` (490 lines) + `WebGL2Bloom.ts` + `useWebGL2PatternRender.ts`; `rendererSelection.ts` maps `webgl2` → `webgpu`. `utils/webgpuDevice.ts` stays the only WebGPU acquisition point. This resolves #436 as Option B; retarget the six `scripts/*.mjs` that still default to `renderer=webgl2` (`audio-smoke-config.mjs`, `playhead-acceptance.mjs`, `benchmark-engine-mainthread.mjs`, `audit-shader-modes.mjs`, `capture-trigger-tail.mjs`, `bench-initlib-browser.mjs`) to the backend they actually need. |
| P1 (feature, Copilot-scoped) | [#461](https://github.com/ford442/mod-player/issues/461) | Real pause/resume. The command bus already has `transport.playPause` / `transport.pause` (`utils/playerCommands.ts`, bound by keyboard, MIDI and `mediaSession`), the protocol has `postPause()` and the worklet handles `MT.pause` without resetting position — but `app/useAppKeyboardActions.ts` maps both to `stopMusic(false)`. Work is in `hooks/libOpenMPT/createTransportActions.ts` + `useAppKeyboardActions.ts` + `components/Controls.tsx` / `TransportBar.tsx`. Disjoint from #462's files. |
| P1 (feature, next) | [#448](https://github.com/ford442/mod-player/issues/448) / [#416](https://github.com/ford442/mod-player/issues/416) | Live mute/solo on the JS engine. The worklet stub is the `TODO(#416)` branch on `MT.setChannelMute` in `audio-worklet/js/openmpt-processor.ts` (~line 644). The main-thread send path already exists (`hooks/libOpenMPT/runInit.ts` → `engine.setChannelMute`). Pattern for the ext interactive interface: `utils/libopenmptExt.ts`. |
| P1 (hygiene) | [#451](https://github.com/ford442/mod-player/issues/451) | Toolchain + repo hygiene. Take the **bundle slice first**: `threeVendorManualChunk` (`vite-plugins/crossOriginIsolationHeaders.ts:12-21`) still drags react/react-dom/scheduler into `three-r3f`, so three is modulepreloaded on every page; `verify-bundle-budget.mjs:107` only **warns**. Tailwind content globs and `build.target` as filed. Still true on `a643822`. |
| **close** | [#437](https://github.com/ford442/mod-player/issues/437) | Landed in #445 (`c686bc0`); pinned by `tests/threeDModeLayout.test.ts` and `tests/webgpuDeviceOwnership.test.ts`. |
| **narrow, keep open** | [#442](https://github.com/ford442/mod-player/issues/442) | Preflight + lockfile guard landed in #446. The ruleset still does not exist, and agent sessions cannot create it (the GitHub proxy rejects `POST /rulesets`). The repo owner has to do it by hand once; see `CONTRIBUTING.md`. |

## Next (after foundation)

| Priority | Issue | Summary |
|----------|-------|---------|
| P2 | [#403](https://github.com/ford442/mod-player/issues/403) | Tracker studio: inspector waveforms, S3M extract, **audible** pattern edits via a sample-audition worklet (libopenmpt cannot write cells). Build the worklet on `audio-worklet/js/` (typed, #435). |
| P2 | [#417](https://github.com/ford442/mod-player/issues/417) | Performance instrument: MIDI/chassis on `playerCommands`, `stageMode`, WebCodecs music-video. Unblocked once #462 lands (the #436 decision is made). |
| P2 | [#452](https://github.com/ford442/mod-player/issues/452) | Shader Lab: typed uniform schema (generated WGSL structs) + live WGSL editor with hot pipeline swap. Builds on #449's checked async pipelines. |
| P2 | [#453](https://github.com/ford442/mod-player/issues/453) | Master FX rack after libopenmpt (EQ/comp/reverb/"Amiga" coloration) as a WASM DSP worklet with export parity. |
| P3 | [#454](https://github.com/ford442/mod-player/issues/454) | Module library v2: metadata DB, full-text search, per-song presets, offline crate. |
| P2 (leftover) | #411 (closed) | `native-engine-bench-notes.md` native column still empty. Filling it needs an emsdk 3.1.51 host. #439 rewrote the JS baseline notes, so re-baseline both columns together. |

## Landed (do not re-open)

| Issue | Landed by |
|-------|-----------|
| [#380](https://github.com/ford442/mod-player/issues/380) Playwright audio smoke | #387 (gate is **green** on current `main`) |
| [#381](https://github.com/ford442/mod-player/issues/381) Split `useAudioGraph.ts` | closed; file is ~175 lines + `hooks/audioGraph/` |
| [#382](https://github.com/ford442/mod-player/issues/382) Thin `PatternDisplay.tsx` | #390 |
| [#383](https://github.com/ford442/mod-player/issues/383) Repo hygiene | #392 |
| [#370](https://github.com/ford442/mod-player/issues/370) Split `useLibOpenMPT.ts` | #388 |
| [#371](https://github.com/ford442/mod-player/issues/371) Split `App.tsx` | #389 |
| [#384](https://github.com/ford442/mod-player/issues/384) Native clock + A/V parity | #393 |
| [#394](https://github.com/ford442/mod-player/issues/394) / #386 Accessibility visual pass | #394 |
| [#395](https://github.com/ford442/mod-player/issues/395) GPU compute (closed without analysis pipeline) | superseded by #402 |
| [#396](https://github.com/ford442/mod-player/issues/396) WebGPU hard-fail viz probe | closed; `utils/webgpuDevice.ts` |
| [#398](https://github.com/ford442/mod-player/issues/398) / [#399](https://github.com/ford442/mod-player/issues/399) Inspector names MVP | closed; waveforms still #403 |
| [#400](https://github.com/ford442/mod-player/issues/400) Restore green CI (`typecheck:tests` fix, emsdk 3.1.51 pin, GH Actions majors, doc sync) | #406 + #408 (`lint-and-build` green on `main`) |
| [#401](https://github.com/ford442/mod-player/issues/401) Native single-context + PCM tap + emcc contract | closed; leftover promotion/deploy is #411 |
| [#402](https://github.com/ford442/mod-player/issues/402) GPU compute analysis pipeline | closed; `computeAnalysis.ts` + `pcmBus.ts` |
| [#404](https://github.com/ford442/mod-player/issues/404) Shared PCM bus + performance stage | closed incomplete; leftover consumers/layout are #414 |
| [#405](https://github.com/ford442/mod-player/issues/405) / [#407](https://github.com/ford442/mod-player/issues/407) ESLint warning hygiene | closed |
| Deploy pipeline audit — bundle-budget + stray-artifact `verify` gaps | [#422](https://github.com/ford442/mod-player/pull/422), on `main` 2026-08-30 (`5911949`). Does **not** cover native artifacts — that is still #411. |
| Stale same-length `index.html` on the VPS | `e44c941` 2026-09-01: `deploy.py` always packs HTML and appends `<!-- xasm-deploy:<sha> -->` so the size-skip cannot preserve a stale page. |
| [#411](https://github.com/ford442/mod-player/issues/411) native **deploy awareness** (classify / verify / refuse partial) | [#426](https://github.com/ford442/mod-player/pull/426), on `main` 2026-09-05. `verify-build.mjs` + `deploy.py` classify `dist/worklets/openmpt-native.{js,wasm,aw.js}` as complete / absent / partial. Absent warns and deploys JS-only; partial aborts; `--require-native` / `DEPLOY_REQUIRE_NATIVE=1` refuses absent; `--dry-run` never uploads. Artifacts stay gitignored; `?engine=native` soft-fail unchanged. **This slice only** — the rest of #411 is the "reopen?" row above. |
| `npm ci` restored across all six CI jobs + `typecheck:tests` green | 2026-09-11: `package-lock.json` 512-line restoration and the TS6133 fix. See the red-CI table above. |
| [#427](https://github.com/ford442/mod-player/issues/427) stage mode without a canvas remount | `8175cc9`, verified 2026-09-18. `MainLayout` + `ChromeLayout` + `tests/stageModeLayout.test.ts`. |
| Single `AudioContext` factory; `?nativeCtx=legacy` dual-context path deleted | [#440](https://github.com/ford442/mod-player/pull/440), on `main` 2026-09-18 (`cd23f8d`). `utils/audioContextFactory.ts` is the only construction site; `tests/audioContextFactory.test.ts` fails the build on a second one. |
| One resident native `OpenMPTModule`; typed `ERR_*` load errors; locked `init_audio` | [#441](https://github.com/ford442/mod-player/pull/441), on `main` 2026-09-18 (`21252a9`). Transient `g_metaModule` is unloaded by `commit_module()` before the audio thread builds `g_module`; `scripts/verify-native-exports.mjs` enforces it. |
| [#435](https://github.com/ford442/mod-player/issues/435) Typed JS worklet | [#444](https://github.com/ford442/mod-player/pull/444), on `main` 2026-09-18. `openmpt-worklet.js` is generated from `audio-worklet/js/openmpt-processor.ts`. |
| [#437](https://github.com/ford442/mod-player/issues/437) 3D mode keeps `PatternDisplay` mounted; single WebGPU owner | [#445](https://github.com/ford442/mod-player/pull/445), on `main` 2026-09-18 (`c686bc0`). Issue still open, so close it. |
| [#439](https://github.com/ford442/mod-player/issues/439) Real-WASM libopenmpt for the JS engine (wasm2js glue deleted) | `2d6a4ed` **direct push to `main`**, 2026-09-19 (CI run 623 green). libopenmpt 0.8.4, emsdk 3.1.51, `public/worklets/libopenmpt-worklet.{js,wasm}`, `npm run verify:js-libopenmpt`. Never reviewed as a PR. |
| [#442](https://github.com/ford442/mod-player/issues/442) `npm run preflight` + lockfile guard | [#446](https://github.com/ford442/mod-player/pull/446), on `main` 2026-09-19 (`11f2ef8`). Ruleset half confirmed absent (see Active). |
| Audio runtime failure paths (worklet fault restart → ScriptProcessor fallback, suspend recovery, native seek/position atomics, PCM-tap cursor) | [#456](https://github.com/ford442/mod-player/pull/456), on `main` 2026-09-26 (`398ba46`). Native parse off the audio thread was explicitly deferred. |
| [#449](https://github.com/ford442/mod-player/issues/449) WebGPU render-loop correctness (bloom H/V uniforms, async checked pipelines, throttled debug info) | [#457](https://github.com/ford442/mod-player/pull/457), on `main` 2026-09-26 (`7055a3d`). |
| [#438](https://github.com/ford442/mod-player/issues/438) v0.60 spectrum chassis reading GPU FFT bins | [#458](https://github.com/ford442/mod-player/pull/458), on `main` 2026-09-26 (`9d29bfa`). `ShaderMeta.spectrumBuffer`; placeholder bins until `ComputeAnalysis` resolves. |
| Salvage of stale-branch work: `utils/audioAnalysisBus.ts` (GPU-analysis snapshot fan-out, CPU analyser parks while GPU is live), `loadModule` awaits `play()`, `VITE_NATIVE_PARITY_GATE=1` gate, `__pycache__/` untracked | [#460](https://github.com/ford442/mod-player/pull/460), on `main` 2026-10-05 (`a643822`). CI run 642 green. |

## Planning scratch (local, gitignored)

Agents may keep ephemeral notes in `.swarm-state.md` or `weekly_plan.md` at the repo root — these files are **not** tracked. Update this roadmap (or open an issue) when work is ready to share.

## Deeper planning docs

See other files in `docs/planning/` for feature specs and epics (`native-engine-platform-epic.md`, `instrument-inspector-mvp.md`, `accurate_playback.md`).
