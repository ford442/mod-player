# Roadmap

Living pointer to active work. **Do not** append agent run diaries here — use GitHub issues and PRs for status.

**Last reconciled:** 2026-09-05. Foundation issues #401 / #402 / #404 are **closed** (code landed; leftovers filed as #411–#415). Weekly `native-wasm-scheduled.yml` is **green** as of 2026-08-31 (run 33362867908).

**Deploy native-artifact gap behind #411 — closed 2026-09-05.** `scripts/verify-build.mjs` and `deploy.py` now classify `dist/worklets/openmpt-native.{js,wasm,aw.js}` as complete / absent / partial (invalid content fails). Absent warns and still deploys JS-only; partial aborts; `--require-native` / `DEPLOY_REQUIRE_NATIVE=1` refuses absent; `--dry-run` never uploads. Artifacts stay gitignored. Runtime `?engine=native` soft-fail is unchanged.

**#411 itself remains open** (parity gate on preview, delete `?nativeCtx=legacy`, lock shared `AudioContext` sampleRate, engine benches). Do not treat the deploy tri-state as the whole P1 row.

**Build on foundation before new content.** Do not start #417 (performance instrument) or new shaders until P1 rows below have a decision/PR. #403 (tracker studio) can proceed in parallel with P1 except live-audition audio, which should wait for typed worklets (#413) if it adds a new AudioWorklet.

## Active (do now)

| Priority | Issue | Summary |
|----------|-------|---------|
| **P1 — Fix First** | [#411](https://github.com/ford442/mod-player/issues/411) | Promote native after green parity: deploy `openmpt-native.*`, open the parity gate on preview only, delete `?nativeCtx=legacy`, lock shared `AudioContext` sampleRate, fill engine benches. |
| P1 | [#412](https://github.com/ford442/mod-player/issues/412) | C++ compile leftovers (`STACK_SIZE`, `-fno-exceptions`) + interactive `ctl` / mute KEEPAlives; stop a third wasm2js module when native is active. |
| P1 | [#413](https://github.com/ford442/mod-player/issues/413) | Compile `openmpt-worklet.js` / native-bridge from TypeScript (single protocol source). |
| P1 | [#414](https://github.com/ford442/mod-player/issues/414) | Finish analysis-bus consumers; split `MainLayout.tsx` (still 848 lines on 2026-09-04) into chrome vs `stageMode` performance stage. Leftover of closed #404. The bus half exists (`utils/pcmBus.ts` + `src/renderers/webgpu/computeAnalysis.ts`, consumed by `frameDraw.ts` and both `hooks/audioGraph/start*Playback.ts`); the layout half is **unstarted** — `stageMode` appears in zero source files. |
| P1 | [#415](https://github.com/ford442/mod-player/issues/415) | Resolve WebGL2 contradiction: revive `?renderer=webgl2` as a real viz session **or** delete the deferred path and retarget smoke/capture/docs. |

## Next (after foundation)

| Priority | Issue | Summary |
|----------|-------|---------|
| P2 | [#403](https://github.com/ford442/mod-player/issues/403) | Tracker studio: inspector waveforms, S3M extract, **audible** pattern edits via a sample-audition worklet (libopenmpt cannot write cells). |
| P2 | [#416](https://github.com/ford442/mod-player/issues/416) | Live channel mute/solo through JS + native (export-only today). Blocked on #412 for native; JS engine can ship first. Distinct from #403. |
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

## Planning scratch (local, gitignored)

Agents may keep ephemeral notes in `.swarm-state.md` or `weekly_plan.md` at the repo root — these files are **not** tracked. Update this roadmap (or open an issue) when work is ready to share.

## Deeper planning docs

See other files in `docs/planning/` for feature specs and epics (`native-engine-platform-epic.md`, `instrument-inspector-mvp.md`, `accurate_playback.md`).
