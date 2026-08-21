# Roadmap

Living pointer to active work. **Do not** append agent run diaries here — use GitHub issues and PRs for status.

**Last reconciled:** 2026-08-19. Previous Active/#395/#396 rows were stale (those issues are closed; audio-smoke is green).

## Active (do now)

Foundation first: CI has been red on `main` (`lint-and-build` / `typecheck:tests`) and the weekly native build could not compile libopenmpt 0.8.4 against emsdk 3.1.50. Fix is up in [PR #406](https://github.com/ford442/mod-player/pull/406) — do not start P2 studio/stage work until it merges and CI is confirmed green.

| Priority | Issue | Summary |
|----------|-------|---------|
| **P0 — Fix First** | [#400](https://github.com/ford442/mod-player/issues/400) | Restore green CI: `typecheck:tests` (`resolveNativeFactory.test.ts`), pin emsdk **3.1.51** everywhere. Fixed in [#406](https://github.com/ford442/mod-player/pull/406); pending CI confirmation before close-out. |
| P1 | [#401](https://github.com/ford442/mod-player/issues/401) | Native engine production path: single `AudioContext`, authentic PCM tap, `EXPORT_ES6` / heap contract, `--debug` CI cell. Blocked on #400's pin. |
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

## Planning scratch (local, gitignored)

Agents may keep ephemeral notes in `.swarm-state.md` or `weekly_plan.md` at the repo root — these files are **not** tracked. Update this roadmap (or open an issue) when work is ready to share.

## Deeper planning docs

See other files in `docs/planning/` for feature specs and epics (`native-engine-platform-epic.md`, `instrument-inspector-mvp.md`, `accurate_playback.md`).
