# Roadmap

Living pointer to active work. **Do not** append agent run diaries here — use GitHub issues and PRs for status.

**Last reconciled:** 2026-09-12 (#412 closed; CI break 3 fixed). Foundation issues #401 / #402 / #404 are **closed** (code landed; leftovers filed as #411–#415). #411 was closed 2026-09-05 by #426.

## 🔴 CI was red on `main` for 7 consecutive runs (2026-09-05 → 2026-09-11)

Runs 597–603 of `ci.yml`. Three **independent** breaks, all introduced by direct `push fix` commits to `main`. Last fully green run on `main` is 596 (`952b949`, the #426 merge).

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

## ⚠️ `stageMode` landed, but violates the one rule #427 was written to enforce

`0f0019e` (2026-09-07) split `MainLayout.tsx` 848 → 23 lines and added `ChromeLayout`, `PerformanceStage`, `GlobalControlsBar`, `TransportBar`, `SidePanelGrid`, `PatternEditorSection`, `LibraryAndPlaylistSection`, plus `stageMode` in `store/playerUiStore.ts`. That closes the **layout half of #414** structurally.

But `MainLayout.tsx:19` is:

```tsx
{stageMode ? <PerformanceStage /> : <ChromeLayout />}
```

`PerformanceStage` owns `PatternDisplay` and is rendered *inside* `ChromeLayout` (line 21) when stage mode is off, and as a *direct child of the root* when it is on. React reconciles by position and type, so toggling unmounts the whole `ChromeLayout` subtree — **the `<canvas>` remounts**, tearing down the WebGPU device, swapchain, bloom post-processor and the analysis pipeline fed by the AudioWorklet. This is the `is3DMode`-style subtree swap #427 explicitly forbade ("Do not model `stageMode` on `is3DMode`"), and the black-canvas / audio-glitch failure mode it was written to prevent.

Second deviation: `setStageMode` / `toggleStageMode` do `editMode: stageMode ? false : state.editMode`, mutating a user preference. #427 required `stageMode` be an **override layer, not a mutation** — entering and exiting stage mode must leave panel prefs unchanged. Today a round trip silently loses `editMode`.

Fix per #427: render both subtrees unconditionally in a structurally invariant order and express stage mode purely as CSS. Neither deviation is caught by `typecheck` / `lint` / `test` — all of those pass.

**#427 is therefore not done.** Its acceptance criteria on canvas remount, prefs round-trip and URL-param precedence are unmet. #414's layout half is structurally complete but behaviourally regressed.

**#411 leftovers are still in the tree** despite the issue being closed: `?nativeCtx=legacy` / `isNativeLegacyAudioContext` remain live in `App.tsx`, `app/usePlayerFeaturesValue.ts`, `hooks/audioGraph/startNativePlayback.ts` and `utils/nativeClockAnchor.ts`; `docs/planning/native-engine-bench-notes.md` is still methodology-only (dated 2026-07-25, no measured numbers). Re-file under #412 or reopen — do not assume closed means done.

**Build on foundation before new content.** Do not start #417 (performance instrument) or new shaders until P1 rows below have a decision/PR. #403 (tracker studio) can proceed in parallel with P1 except live-audition audio, which should wait for typed worklets (#413) if it adds a new AudioWorklet.

## Active (do now)

| Priority | Issue | Summary |
|----------|-------|---------|
| **P1 — Fix First** | [#427](https://github.com/ford442/mod-player/issues/427) | `stageMode` canvas-remount regression: replace the `{stageMode ? <PerformanceStage/> : <ChromeLayout/>}` subtree swap at `MainLayout.tsx:19` with always-rendered children + CSS-only stage mode, and stop `setStageMode` mutating `editMode`. Landed in `0f0019e` against the issue's one governing rule. |
| ~~P1~~ **done** | [#412](https://github.com/ford442/mod-player/issues/412) | Two-phase `em++` compile/link fixes the `__cxa_throw` break (and `--debug`'s missing `-matomics`); `STACK_SIZE`, explicit `DISABLE_EXCEPTION_CATCHING=1`, interactive `ctl`/mute and the one-module native parse were already in tree. Mute/interpolation verified against the real wrapper on emsdk 3.1.51. Unblocks #416. |
| P1 | [#413](https://github.com/ford442/mod-player/issues/413) | Compile `openmpt-worklet.js` / native-bridge from TypeScript (single protocol source). |
| P1 | [#414](https://github.com/ford442/mod-player/issues/414) | Bus half **done** (`utils/pcmBus.ts` + `computeAnalysis.ts`, consumed by `frameDraw.ts` and both `start*Playback.ts`). Layout half structurally landed in `0f0019e` but behaviourally regressed — tracked as #427 above. Close this once #427 is green. |
| P1 (reopen?) | [#411](https://github.com/ford442/mod-player/issues/411) | Closed 2026-09-05 by #426, but only the deploy-awareness slice shipped. Still in tree: `?nativeCtx=legacy` / `isNativeLegacyAudioContext`, unlocked shared `AudioContext` sampleRate, and `native-engine-bench-notes.md` with no measured numbers. |
| P1 | [#415](https://github.com/ford442/mod-player/issues/415) | Resolve WebGL2 contradiction: revive `?renderer=webgl2` as a real viz session **or** delete the deferred path and retarget smoke/capture/docs. |

## Next (after foundation)

| Priority | Issue | Summary |
|----------|-------|---------|
| P2 | [#403](https://github.com/ford442/mod-player/issues/403) | Tracker studio: inspector waveforms, S3M extract, **audible** pattern edits via a sample-audition worklet (libopenmpt cannot write cells). |
| P2 | [#416](https://github.com/ford442/mod-player/issues/416) | Live channel mute/solo through JS + native (export-only today). **Unblocked** — `_set_channel_mute` is exported and range-safe as of #412. Distinct from #403. |
| P2 | [#417](https://github.com/ford442/mod-player/issues/417) | Performance instrument: MIDI/chassis on `playerCommands`, `stageMode`, WebCodecs music-video (`mp4-muxer` optional). Depends on #414 + #415 decision. |

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

## Planning scratch (local, gitignored)

Agents may keep ephemeral notes in `.swarm-state.md` or `weekly_plan.md` at the repo root — these files are **not** tracked. Update this roadmap (or open an issue) when work is ready to share.

## Deeper planning docs

See other files in `docs/planning/` for feature specs and epics (`native-engine-platform-epic.md`, `instrument-inspector-mvp.md`, `accurate_playback.md`).
