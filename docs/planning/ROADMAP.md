# Roadmap

Living pointer to active work. **Do not** append agent run diaries here — use GitHub issues and PRs for status.

**Last reconciled:** 2026-08-21. `lint-and-build` is green on `main` again (#400, landed by #406 + #408); previous Active/#395/#396 rows were stale (those issues are closed; audio-smoke is green).

## Active (do now)

`lint-and-build` is green. `native-full-build` (path-filtered, in `ci.yml`) now compiles libopenmpt cleanly against emsdk 3.1.51 — the #400 pin fix is proven — but its native-engine parity step still fails: `requested native engine but active engine is "worklet" (expected "native-worklet")`. That's a runtime/parity-gate bug in the native audio engine itself, not a build/tooling issue, so it blocks #401 rather than #400. The standalone `native-wasm-scheduled.yml` workflow runs the same parity step and should be expected to fail the same way until #401 lands — someone with `workflow_dispatch` access should confirm on the next manual/weekly run.

| Priority | Issue | Summary |
|----------|-------|---------|
| **P1 — Fix First** | [#401](https://github.com/ford442/mod-player/issues/401) | Native engine production path: single `AudioContext`, authentic PCM tap, `EXPORT_ES6` / heap contract, `--debug` CI cell. Unblocked by #400, but `native-full-build` / `native-wasm-scheduled.yml` fail parity (`active engine is "worklet"`, expected `"native-worklet"`) — likely the first thing to fix here. |
| P1 | [#402](https://github.com/ford442/mod-player/issues/402) | GPU compute analysis: spectrum + waveform extrema + `timestamp-query`. Tracker engine stays CPU/WASM. Replaces AnalyserNode for chassis bands. |

## Next (after foundation)

| Priority | Issue | Summary |
|----------|-------|---------|
| P2 | [#403](https://github.com/ford442/mod-player/issues/403) | Tracker studio: inspector waveforms, S3M extract, **audible** pattern edits via a sample-audition worklet (libopenmpt cannot write cells). |
| P2 | [#404](https://github.com/ford442/mod-player/issues/404) | Shared PCM analysis bus + performance stage (chassis + ProjectM + 3D on one clock). Split remaining `MainLayout` chrome vs stage. |

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

## Planning scratch (local, gitignored)

Agents may keep ephemeral notes in `.swarm-state.md` or `weekly_plan.md` at the repo root — these files are **not** tracked. Update this roadmap (or open an issue) when work is ready to share.

## Deeper planning docs

See other files in `docs/planning/` for feature specs and epics (`native-engine-platform-epic.md`, `instrument-inspector-mvp.md`, `accurate_playback.md`).
