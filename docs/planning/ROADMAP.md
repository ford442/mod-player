# Roadmap

Living pointer to active work. **Do not** append agent run diaries here — use GitHub issues and PRs for status.

**Last reconciled:** 2026-09-18 (#427 closed — verified fixed in tree; #440 / #441 landed green). Foundation issues #401 / #402 / #404 are **closed** (code landed; leftovers filed as #411–#415, re-cut on 2026-09-15 as #435–#439). CI on `main` is **green** for runs 612 / 614 / 616.

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

**The same bug class is still live for 3D mode**, which is what #427 originally cited as the anti-pattern: `App.tsx:508` still early-returns `<App3DModeShell />`, and `components/App3DView.tsx:159` remounts `PatternDisplay` again with `key={shader3D}`. Tracked as **#437**, now the P1.

**#411 audio-graph leftovers are now cleared:** `utils/audioContextFactory.ts` is the single `AudioContext` construction site (one context per page session, `sampleRate` locked to 48000, `latencyHint` from the stage-mode / `?latency=` profile), and the `?nativeCtx=legacy` dual-context path — `parseNativeCtxQueryParam`, `isNativeLegacyAudioContext`, the dual-context capture block and `public/worklets/native-bridge-processor.js` — is deleted. Still outstanding on #411: `docs/planning/native-engine-bench-notes.md` now carries the methodology plus **one** recorded JS baseline row (2026-09-18); the native column is still empty and needs an emsdk 3.1.51 host to fill.

**Build on foundation before new content.** Do not start #417 (performance instrument) or the #438 spectrum-shader family until #437 lands and #436 has a decision — both sit on the same WebGPU init surface. #403 (tracker studio) can proceed in parallel with P1 except live-audition audio, which should wait for typed worklets (#435) if it adds a new AudioWorklet.

## Active (do now)

| Priority | Issue | Summary |
|----------|-------|---------|
| **P1 — do first** | [#437](https://github.com/ford442/mod-player/issues/437) | 3D mode tears down the GPU the way #427 forbade: `App.tsx:508` early-returns `App3DModeShell`, and `App3DView.tsx:159` remounts `PatternDisplay` with `key={shader3D}`. Also three `requestAdapter` call sites (`src/renderers/rendererSelection.ts:113`, `utils/deviceCapabilities.ts:99`, `utils/webgpuDevice.ts:266`) and a probe/runtime `alphaMode` mismatch (`webgpuDevice.ts:387` `opaque` vs `:465` `premultiplied`). |
| P1 | [#436](https://github.com/ford442/mod-player/issues/436) | Resolve the WebGL2 contradiction: revive `?renderer=webgl2` as a real viz session **or** delete the deferred path and retarget smoke/capture/docs. (Re-cut of #415.) |
| P1 | [#435](https://github.com/ford442/mod-player/issues/435) | Compile the JS AudioWorklets from TypeScript — `public/worklets/openmpt-worklet.js` is still untyped, so the message protocol has two sources. (Re-cut of #413.) |
| P1 (hygiene) | [#442](https://github.com/ford442/mod-player/issues/442) | `npm run preflight` aggregate + `scripts/verify-lockfile.mjs`, wired into `lint-and-build` after `npm ci`. Every red run in 597–610 came from a direct `push fix` to `main`. Scoped to `scripts/` / `package.json` / one `ci.yml` step / docs — no overlap with #437. |
| ~~P1~~ **done** | [#427](https://github.com/ford442/mod-player/issues/427) | Closed 2026-09-18. CSS-only stage mode, invariant tree, no pref mutation, pinned by `tests/stageModeLayout.test.ts`. 3D remount carried over to #437. |
| ~~P1~~ **done** | [#412](https://github.com/ford442/mod-player/issues/412) | Two-phase `em++` compile/link fixes the `__cxa_throw` break (and `--debug`'s missing `-matomics`). Mute/interpolation verified against the real wrapper on emsdk 3.1.51. Unblocks #416. |
| P1 | [#414](https://github.com/ford442/mod-player/issues/414) | Bus half **done** (`utils/pcmBus.ts` + `computeAnalysis.ts`). Layout half done as of #427's close. **Close this.** |
| P1 (leftover) | [#411](https://github.com/ford442/mod-player/issues/411) | Audio-graph half **done** (single `AudioContext` factory, 48 kHz locked, profiled `latencyHint`; `?nativeCtx=legacy` deleted). Remaining: `native-engine-bench-notes.md` has methodology plus one recorded JS baseline row — the native column still needs an emsdk 3.1.51 host. |

## Next (after foundation)

| Priority | Issue | Summary |
|----------|-------|---------|
| P2 | [#403](https://github.com/ford442/mod-player/issues/403) | Tracker studio: inspector waveforms, S3M extract, **audible** pattern edits via a sample-audition worklet (libopenmpt cannot write cells). |
| P2 | [#416](https://github.com/ford442/mod-player/issues/416) | Live channel mute/solo through JS + native (export-only today). **Unblocked** — `_set_channel_mute` is exported and range-safe as of #412. Distinct from #403. |
| P2 | [#417](https://github.com/ford442/mod-player/issues/417) | Performance instrument: MIDI/chassis on `playerCommands`, `stageMode`, WebCodecs music-video (`mp4-muxer` optional). `stageMode` is now unblocked; still depends on the #436 decision. |
| P2 | [#438](https://github.com/ford442/mod-player/issues/438) | Bind the GPU FFT spectrum into the chassis shaders — a v0.60 family that reads `computeAnalysis`. Do after #437 (same WebGPU init surface). |
| P2 | [#439](https://github.com/ford442/mod-player/issues/439) | Replace the wasm2js JS engine with real libopenmpt WASM; keep the C++ native build as the SIMD path. |

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

## Planning scratch (local, gitignored)

Agents may keep ephemeral notes in `.swarm-state.md` or `weekly_plan.md` at the repo root — these files are **not** tracked. Update this roadmap (or open an issue) when work is ready to share.

## Deeper planning docs

See other files in `docs/planning/` for feature specs and epics (`native-engine-platform-epic.md`, `instrument-inspector-mvp.md`, `accurate_playback.md`).
