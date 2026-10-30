# Roadmap

Living pointer to active work. **Do not** append agent run diaries here — use GitHub issues and PRs for status.

**Last reconciled:** 2026-10-30 (weekly planner pass). It replaces the 2026-10-23 (#519) and 2026-10-25 (#522) passes. Both were merged, so their sections were interleaved here twice.

**`main` is green.** CI run 720 on `e2251b3` (#508) passed. Run 714 on `f2b9894` (#522) was the last red run (the SC2054 shellcheck break, which #522 itself fixed). `main` has not moved since 2026-10-27.

**Landed 2026-10-25 → 10-27:**
- #520 retired the native engine.
- #521 moved module create off the AudioWorklet thread (#513).
- #522 shipped the #515 toolchain: libopenmpt 0.8.9 pinned, `wasm-flags.sh`, typed catches on the worklet thread, `-Os` + Closure.
- #506 fixed WebGL2 context loss.
- #524 added per-song memory on the fingerprint (#511).
- #508 made WebGPU configure the canvas once, added device-pixel sizing, opt-in HDR and the compatibility rung.

The native drafts #502–#505 were closed against the ADR. #509 and #510 were folded into #507's branch.

**The one open PR is #507** (`refactor/492-player-engine`, PlayerEngine + transport FSM, now with #509's position ring and #510's output-device picker). It is still based on `3732a7a`, and a merge with `main` conflicts in ~38 files. Most of that is "drop the native branch" (#520) and routing `postModuleLoad` through #513's create worker. Only the owner merges it. Until it is rebased, any work under `hooks/libOpenMPT/`, `hooks/audioGraph/`, `audio-worklet/` or `App.tsx` adds to its conflicts.

**The owner's order (comment on #511, 2026-10-20)** was: land the foundation drafts, then #511 → #512 → #513 → #514. #511 and #513 are done. #516 says its item 1 (now **#523**) lands before #512 and #514. On 2026-10-27 the owner opened #525–#529 (resume from the SongSession cursor, one render-settings value, WebGL context options, S3M waveforms, an OPFS crate).

## Open bookkeeping

| Item | State |
|---|---|
| #490 | Closed 2026-10-25 by #519. Done. |
| Lint budget | 26 warnings since #520, budget 27. Review the `react-hooks/exhaustive-deps` warnings one by one (stale-closure risk in a ref-heavy codebase), then lower the budget. #507 claims 7. Do this after #507 lands, because it rewrites most of those hooks. |
| Stale remote branches | Only `main`, `refactor/492-player-engine` and this planner branch are left. |
| Branch ruleset (#442, closed) | Still absent. It is an owner action (the GitHub proxy rejects `POST /rulesets`); see `CONTRIBUTING.md`. |

**Correction (kept):** earlier reconciles called the real-WASM libopenmpt change "#449". That was **#439** (`2d6a4ed`). #449 is the WebGPU render-loop issue.

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
  - **Caveat found under #451:** that "`--debug` links" check only ever linked the wrapper against the *release* `libopenmpt.a` — the weekly debug job restored it from the cache entry it shared with the release job. A **cold** debug build (libopenmpt built with no explicit flags) still failed the same way (`--shared-memory is disallowed by lto.tmp because it was not compiled with 'atomics' or 'bulk-memory' features`, reproduced on emsdk 3.1.51). Debug libopenmpt now gets `-O1 -mbulk-memory -matomics`, builds in its own tree, and is cached under its own flag stamp.

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

**#411 audio-graph leftovers are now cleared:** `utils/audioContextFactory.ts` is the single `AudioContext` construction site (one context per page session, `sampleRate` locked to 48000, `latencyHint` from the stage-mode / `?latency=` profile), and the `?nativeCtx=legacy` dual-context path — `parseNativeCtxQueryParam`, `isNativeLegacyAudioContext`, the dual-context capture block and `public/worklets/native-bridge-processor.js` — is deleted. The #411 leftover (the empty native column in `docs/planning/native-engine-bench-notes.md`) is moot: the native engine was retired, and #505's ADR carries the JS-vs-native measurements.

**Build on foundation before new content.** #437 has landed, so #438 (spectrum-shader family) is unblocked. #417 (performance instrument) is unblocked once #462 lands (the #436 decision is made: opt-in WebGL2 session). #403 (tracker studio) can proceed in parallel with P1; typed worklets (#435) are done, so its sample-audition worklet builds on `audio-worklet/js/` instead of adding more untyped classic JS.

## Active (do now)

| Priority | Issue | Summary |
|----------|-------|---------|
| **P1, current focus** | [#523](https://github.com/ford442/mod-player/issues/523) (#516 item 1) | Swapped volume/effect columns in `utils/patternExtractor.ts` (still `3 → volVal`, `4 → effCmd` on `e2251b3`), a dead `volPacked` nibble layout, and hand-typed `EFFECT_E_DECIMAL` guesses in `gpuPacking.ts` and `compute_note_duration.wgsl`. Fix them with a real-WASM fixture test and `utils/openmptCommands.ts`. Must land before #512 and #514. Disjoint from #507's file list. The native-reader half went away with #520. |
| **P0, owner** | [#507](https://github.com/ford442/mod-player/pull/507) | Rebase on `main` (~38 conflicting files), then merge. It blocks #512 in practice, since both touch the engine and the worklet protocol. |
| P1, decoupled | #516 item 4 (cross-origin isolation) | No sub-issue yet; drafted 2026-10-30. COEP `credentialless` in three places (WebKit has no support for it, so Safari is never isolated), the dead esm.sh importmap and preconnect in `index.html`, and a `deploy.py` that never checks COOP/COEP on the live response. |
| P1 (next) | [#512](https://github.com/ford442/mod-player/issues/512) | JS-engine mixer (mute / solo / per-channel volume that playback and export obey). The ext create goes in `workers/openmpt-create.worker.ts`'s `create()`; in-worklet creates must keep working. After #523 and #507. |
| P1 | [#526](https://github.com/ford442/mod-player/issues/526), [#527](https://github.com/ford442/mod-player/issues/527) | #516 items 2 and 6 as sub-issues: one render-settings value for live / SP fallback / export, and WebGL context options matched to the WebGPU device. #526 touches the worklet, so it goes after #507. |
| P1 | #516 items 5, 7 | iOS cold-start audio unlock (`useAudioGraph`, so after #507), the worklet load-timer leak, Tailwind tokens that emit no CSS, the duplicated parser-worker loader. |
| P2 | [#525](https://github.com/ford442/mod-player/issues/525) | Resume a song from its `SongSession` cursor (#511 follow-up; touches transport actions, so after #507). |

## Next

| Priority | Issue | Summary |
|----------|-------|---------|
| P2 | [#514](https://github.com/ford442/mod-player/issues/514) | Audible pattern studio: ext `play_note` audition (after #512) and a TypeScript XM/MOD writer in `workers/` (after #523, because the writer reads `PatternCell`). |
| P1 (after #507) | [#517](https://github.com/ford442/mod-player/issues/517) | Codebase architecture: move-proof tests, `src/` feature layout with `@/`, one shader source of truth with generated uniform layouts, React 19 / R3F 9 / Tailwind 4, lint `--max-warnings 0`. Land the move between feature PRs. |
| P2 | [#518](https://github.com/ford442/mod-player/issues/518) | Render worker + deterministic music-video export. After #517 splits `WebGPURenderer.ts`. |
| P2 | [#528](https://github.com/ford442/mod-player/issues/528), [#529](https://github.com/ford442/mod-player/issues/529) | S3M sample waveforms + public instrument panel; an OPFS module crate keyed by the song fingerprint. |
| P2 | [#487](https://github.com/ford442/mod-player/issues/487) / [#488](https://github.com/ford442/mod-player/issues/488) | FX rack: fallback IRs where Ogg Opus fails (Safari); enable in public builds after a soak. |
| P3 (toolchain) | emsdk bump | Blocked upstream: 6.0.13 cannot link `-sWASM_WORKERS` with wasm EH. See `docs/WORKLET_AUDIO_BUG.md` § "One toolchain". |

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
| `main` unbroken: `tests/transportEnginePaths.test.ts` uses `masterInputRef` | [#494](https://github.com/ford442/mod-player/pull/494), on `main` 2026-10-16 (`2be1c63`). |
| [#453](https://github.com/ford442/mod-player/issues/453) FX rack on `main` (rebased stack #474–#484, `audio/fx/` 29 files, `smoke:fx:ci` green, bypassed rack nulls at 0) | [#495](https://github.com/ford442/mod-player/pull/495), on `main` 2026-10-16 (`a4bb60a`). Public builds stay gated on `VITE_FX_RACK=1` (#488). |
| [#451](https://github.com/ford442/mod-player/issues/451) last slices: native libopenmpt flag stamp (#471), scoped logger + `no-console` (#472), Vite 5.4 → 7.3.7 with one Vite for app and Vitest (#497) | On `main` 2026-10-16 (`f600eb3`, `f34c800`, `37fe00d`). Close #451. |
| Lint budget 40 → 27 (13 non-hooks warnings fixed) | [#498](https://github.com/ford442/mod-player/pull/498), on `main` 2026-10-16 (`5492556`). The 27 left are 25 `exhaustive-deps` + 2 `only-export-components`. |
| [#490](https://github.com/ford442/mod-player/issues/490) WAV export at the live 48 kHz by default, bit-exact with playback; 44.1 kHz as an explicit option | [#496](https://github.com/ford442/mod-player/pull/496), on `main` 2026-10-16 (`c506a27`, CI run 693 green). |
| [#489](https://github.com/ford442/mod-player/issues/489) Native engine at unity (master volume once, in the GainNode) | [#501](https://github.com/ford442/mod-player/pull/501), on `main` 2026-10-17 (`3732a7a`). Moot after #520. |
| [#491](https://github.com/ford442/mod-player/issues/491) / #505 Native engine retired: `cpp/`, engine selection, native scripts/tests/CI jobs; ADR on `main` | [#520](https://github.com/ford442/mod-player/pull/520), on `main` 2026-10-25 (`3387245`, CI run 710 green). |
| [#513](https://github.com/ford442/mod-player/issues/513) Module create off the AudioWorklet thread (playback heap + create worker); SIMD measured and rejected | [#521](https://github.com/ford442/mod-player/pull/521), on `main` 2026-10-25 (`d8279da`; CI run 712 red on `build-scripts` only, see the top). |
| [#515](https://github.com/ford442/mod-player/issues/515) toolchain: libopenmpt 0.8.9 sha256-pinned, `wasm-flags.sh`, fatal emsdk drift, instruction-level feature gate, worklet typed-catch fix, `-Os` + Closure | [#522](https://github.com/ford442/mod-player/pull/522), on `main` 2026-10-25 (`f2b9894`). Turned `build-scripts` green. |
| #492 Phase 3: WebGL2 context loss / restore, probe context released, opt-in renderer lazy | [#506](https://github.com/ford442/mod-player/pull/506), on `main` 2026-10-27 (`fd0a5b5`, CI run 718 green). |
| [#511](https://github.com/ford442/mod-player/issues/511) Per-song memory on the song fingerprint (`SongSession` in IndexedDB, `computeModuleHash` off the production path) | [#524](https://github.com/ford442/mod-player/pull/524), on `main` 2026-10-27 (`ef4efb1`). |
| #492 Phase 3: canvas configured once per device/format, device-pixel sizing, opt-in HDR output, compatibility adapter rung | [#508](https://github.com/ford442/mod-player/pull/508), on `main` 2026-10-27 (`e2251b3`, CI run 720 green). |
| #502–#505 native drafts | Closed unmerged 2026-10-27 against the #505 ADR (superseded by #520 / #522). |

## Planning scratch (local, gitignored)

Agents may keep ephemeral notes in `.swarm-state.md` or `weekly_plan.md` at the repo root — these files are **not** tracked. Update this roadmap (or open an issue) when work is ready to share.

## Deeper planning docs

See other files in `docs/planning/` for feature specs and epics (`native-engine-platform-epic.md`, `instrument-inspector-mvp.md`, `accurate_playback.md`).
