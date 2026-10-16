# Roadmap

Living pointer to active work. **Do not** append agent run diaries here — use GitHub issues and PRs for status.

**Last reconciled:** 2026-10-16.

**`main` is red.** `lint-and-build` has failed on every push since `b3202b5` (#467): its new test still passes `analyserRef`, which #473 renamed to `masterInputRef`. The one-line fix is **#494** (CI green). Merge it first.

**The #453 FX rack is not on `main`.** Only #473 (prep + master input) reached `main`; #474–#484 were merged into their stacked base branches. **#495** is the whole stack rebased onto `main` as one PR (10 commits, `audio/fx/` byte-identical to the stack tip, CI green, `smoke:fx:ci` passes; the bypassed rack nulls at exactly 0).

**Since 2026-10-09, landed on `main`:** #464 (opt-in WebGL2 session: closes #462 and the #436 decision), #465 / #466 / #468 / #469 / #470 (#451 slices: three.js off the initial load, preflight == CI, the real worklet singleton under test, faster CI, dead code untracked), #467 (#461 real pause/resume), #473 (#453 prep: multi-entry worklet build, Web Audio test harness, single master input).

**Correction:** earlier reconciles called the real-WASM libopenmpt change "#449". That was **#439** (`2d6a4ed`). #449 is the WebGPU render-loop issue, which is what `CLAUDE.md` pitfall 14 cites.

## Integration queue (#490), in merge order

Each PR passes CI on its own. They were also merged together into one scratch tree, which passes the full suite (108 files, 981 tests), ESLint (0 errors, 27 warnings) and the bundle budget.

| Order | PR | What | Notes |
|---|---|---|---|
| 1 | [#494](https://github.com/ford442/mod-player/pull/494) | Unbreak `main` (1 line) | #495, #471, #472, #497 and #498 each carry the same commit so their CI is green; it drops out of their squash once #494 lands |
| 2 | [#495](https://github.com/ford442/mod-player/pull/495) | #453 FX rack on `main` | CodeRabbit skipped it ("too many files"), so it needs a human review |
| 3 | [#496](https://github.com/ford442/mod-player/pull/496) (draft) | WAV export at 48 kHz, bit-exact with playback | Stacked on #495: rebase after it lands |
| 3 | this PR (draft) | Roadmap reconcile | Stacked on #495 |
| any | [#471](https://github.com/ford442/mod-player/pull/471) | Native libopenmpt flag stamp | Merges cleanly; native jobs green on current `main` |
| any | [#472](https://github.com/ford442/mod-player/pull/472) | Scoped logger + `no-console` | Import-only conflicts with #495 and #496, documented on the PR |
| any | [#497](https://github.com/ford442/mod-player/pull/497) | Vite 5.4 → 7.3.7 (one Vite) | |
| any | [#498](https://github.com/ford442/mod-player/pull/498) | Lint 40 → 27 warnings | Holds at 27 with every other PR merged |

**Branches left on the remote:** the eight `feat/453-*` branches and `docs/453-faust-adr` are #495's history. Delete them once it lands. `feat/revive-webgl2-viz` (#415 Option A, automatic WebGL2 fallback) contradicts the owner's Option B decision (#462 → #464) and is obsolete. Its one other idea, detecting a blank WebGPU `captureStream` frame before recording, would need to fail visibly rather than silently switch renderers; a candidate for #417.

## ✅ CI history — three breaks (runs 597–603), all fixed

**Historical:** runs 612 (`048230c`), 614 (`eca1c82`) and 616 (`b75ce9e`) were green. For the current state of `main`, see the top of this file. Runs 606–610 (2026-09-12) were red from the same direct-to-`main` `push fix` pattern and were cleared by the #432 merge.

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
| **P0, current focus** | [#490](https://github.com/ford442/mod-player/issues/490) | Integration first: the queue above. Nothing new starts until `main` is green and holds the FX rack. Still open after the queue: 25 `react-hooks/exhaustive-deps` warnings (review one by one) and the two context files' `only-export-components`. |
| P1 (next, in parallel) | [#491](https://github.com/ford442/mod-player/issues/491) / [#492](https://github.com/ford442/mod-player/issues/492) | #491: native engine + WASM toolchain correctness (`g_moduleData` race, parse off the audio thread, libopenmpt exceptions, SIMD gate). #492: `PlayerEngine` FSM outside React, one protocol table, SAB position ring. |
| P1 (feature) | [#448](https://github.com/ford442/mod-player/issues/448) / [#416](https://github.com/ford442/mod-player/issues/416) | Live mute/solo on the JS engine. The worklet stub is the `TODO(#416)` branch on `MT.setChannelMute` in `audio-worklet/js/openmpt-processor.ts`. The main-thread send path already exists (`hooks/libOpenMPT/runInit.ts` → `engine.setChannelMute`). Pattern for the ext interactive interface: `utils/libopenmptExt.ts`. |
| P1 (hygiene) | [#451](https://github.com/ford442/mod-player/issues/451) | The remaining slices are #471, #472 and #497 (queue above). Close #451 when they land. |
| **close** | [#437](https://github.com/ford442/mod-player/issues/437) | Landed in #445 (`c686bc0`); pinned by `tests/threeDModeLayout.test.ts` and `tests/webgpuDeviceOwnership.test.ts`. Still open on GitHub. |
| **narrow, keep open** | [#442](https://github.com/ford442/mod-player/issues/442) | Preflight + lockfile guard landed in #446. The ruleset still does not exist, and agent sessions cannot create it (the GitHub proxy rejects `POST /rulesets`). The repo owner has to do it by hand once; see `CONTRIBUTING.md`. |

## Next (after foundation)

| Priority | Issue | Summary |
|----------|-------|---------|
| P2 | [#403](https://github.com/ford442/mod-player/issues/403) | Tracker studio: inspector waveforms, S3M extract, **audible** pattern edits via a sample-audition worklet (re-check the "libopenmpt cannot write cells" premise against #493 first). Build the worklet on `audio-worklet/js/` (typed, #435). |
| P2 | [#417](https://github.com/ford442/mod-player/issues/417) | Performance instrument: MIDI/chassis on `playerCommands`, `stageMode`, WebCodecs music-video. Unblocked: #462 landed (#464). |
| P2 | [#452](https://github.com/ford442/mod-player/issues/452) | Shader Lab: typed uniform schema (generated WGSL structs) + live WGSL editor with hot pipeline swap. Builds on #449's checked async pipelines. |
| P2 | [#485](https://github.com/ford442/mod-player/issues/485)–[#488](https://github.com/ford442/mod-player/issues/488) | FX rack follow-ups, once #495 lands: per-song shader prefs on the song fingerprint (#485), chunked export for long modules (#486), fallback IRs where Ogg Opus fails, i.e. Safari (#487), enable in public builds after a soak (#488; public builds are gated on `VITE_FX_RACK=1`). Design + limits: `docs/FX_RACK.md`; Faust decision: `docs/ADR-fx-character-dsp.md`. |
| P2 | [#493](https://github.com/ford442/mod-player/issues/493) | Editable modules: libopenmpt 0.8.4 already contains OpenMPT's soundlib writers behind `MODPLUG_NO_FILESAVE`, which challenges #403's "libopenmpt cannot write" premise. After #491 / #492. |
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
| [#462](https://github.com/ford442/mod-player/issues/462) / [#436](https://github.com/ford442/mod-player/issues/436) Opt-in WebGL2 visualizer (never automatic, persistent badge) | [#464](https://github.com/ford442/mod-player/pull/464), on `main` 2026-10-11 (`c77e48f`). |
| [#461](https://github.com/ford442/mod-player/issues/461) Real pause/resume (Play/Pause, Space, MIDI, Media Session) | [#467](https://github.com/ford442/mod-player/pull/467), on `main` 2026-10-11 (`b3202b5`). Its new test broke `main` (fix: #494). |
| [#451](https://github.com/ford442/mod-player/issues/451) slices: three.js off the initial load (#465), preflight == CI (#466), the real worklet singleton under test (#468), faster CI (#469), dead code + strays untracked (#470) | On `main` 2026-10-10 → 2026-10-14. Remaining: #471, #472, #497. |
| [#453](https://github.com/ford442/mod-player/issues/453) prep: multi-entry worklet build, Web Audio test harness, single master input + connect-only master chain | [#473](https://github.com/ford442/mod-player/pull/473) (with #474 folded in), on `main` 2026-10-11 (`8c8bb13`). The rack itself is #495. |

## Planning scratch (local, gitignored)

Agents may keep ephemeral notes in `.swarm-state.md` or `weekly_plan.md` at the repo root — these files are **not** tracked. Update this roadmap (or open an issue) when work is ready to share.

## Deeper planning docs

See other files in `docs/planning/` for feature specs and epics (`native-engine-platform-epic.md`, `instrument-inspector-mvp.md`, `accurate_playback.md`).
