# Roadmap

Living pointer to active work. **Do not** append agent run diaries here — use GitHub issues and PRs for status.

## Active (do now)

| Priority | Issue | Summary |
|----------|-------|---------|
| **P0 — Fix First** | [audio-smoke CI red](https://github.com/ford442/mod-player/actions/workflows/ci.yml) | `audio-smoke` job red on every merge to `main` since #380 landed. Fails `stop-play: wrapOverruns +1` (`scripts/audio-smoke.mjs:139`). Decide: real stop→play restart glitch vs. over-strict zero-tolerance gate; land a fix that keeps the gate's teeth. |
| P0 | [#381](https://github.com/ford442/mod-player/issues/381) | Split `hooks/useAudioGraph.ts` (<700 lines). Deferred until the audio-smoke gate is green (same file may be touched by the fix). |

## New (opened 2026-08-14, not yet scheduled)

| Priority | Issue | Summary |
|----------|-------|---------|
| Feature | [#395](https://github.com/ford442/mod-player/issues/395) | GPU compute for spectrum / viz analysis; tracker engine stays CPU/WASM. Good future kimi-cli deep-work day. |
| Needs decision | [#396](https://github.com/ford442/mod-player/issues/396) | WebGPU-required hard-fail boot probe, dropping WebGL2/HTML fallback. **Conflicts** with CLAUDE.md ("always check for fallback paths") and the `visual-smoke` CI job depends on those fallbacks — confirm intent before building. |

## Landed — close-out pending

PRs merged; issues still OPEN and should be reconciled/closed:

| Issue | Landed by |
|-------|-----------|
| [#380](https://github.com/ford442/mod-player/issues/380) Playwright audio smoke harness | #387 (gate now needs the Fix-First repair above) |
| [#382](https://github.com/ford442/mod-player/issues/382) Thin `PatternDisplay.tsx` | #390 |
| [#383](https://github.com/ford442/mod-player/issues/383) Repo hygiene (untrack `a.out.*`, scratch) | #392 |
| [#370](https://github.com/ford442/mod-player/issues/370) Split `hooks/useLibOpenMPT.ts` | #388 |
| [#371](https://github.com/ford442/mod-player/issues/371) Split `App.tsx` | #389 |
| [#384](https://github.com/ford442/mod-player/issues/384) Native-engine clock + A/V parity | #393 |

## Planning scratch (local, gitignored)

Agents may keep ephemeral notes in `.swarm-state.md` or `weekly_plan.md` at the repo root — these files are **not** tracked. Update this roadmap (or open an issue) when work is ready to share. The weekly dispatch (kickoff prompts for kimi-cli / Copilot / chat models / Jules) is delivered as a private Claude artifact, not committed here.

## Deeper planning docs

See other files in `docs/planning/` for feature specs and epics.
