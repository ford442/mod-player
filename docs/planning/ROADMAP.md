# Roadmap

Living pointer to active work. **Do not** append agent run diaries here — use GitHub issues and PRs for status.

## Open issues (hygiene / refactor / DX)

| Priority | Issue | Summary |
|----------|-------|---------|
| P0 | [#380](https://github.com/noahcohn/react-libopenmpt-viewer/issues/380) | Playwright audio smoke harness |
| P0 | [#381](https://github.com/noahcohn/react-libopenmpt-viewer/issues/381) | Split `hooks/useAudioGraph.ts` (<700 lines) |
| P1 | [#382](https://github.com/noahcohn/react-libopenmpt-viewer/issues/382) | Thin `PatternDisplay.tsx` (renderer-host extraction) |
| P1 | [#383](https://github.com/noahcohn/react-libopenmpt-viewer/issues/383) | Repo hygiene: untrack `a.out.*`, agent scratch, root clutter |
| Refactor | [#370](https://github.com/noahcohn/react-libopenmpt-viewer/issues/370) | Split `hooks/useLibOpenMPT.ts` |
| Refactor | [#371](https://github.com/noahcohn/react-libopenmpt-viewer/issues/371) | Split `App.tsx` |
| P2 | [#384](https://github.com/noahcohn/react-libopenmpt-viewer/issues/384) | Native-engine sample-accurate clock + A/V parity |

File-split refactors (#370, #381, #382) should land after #380 so audio smoke can catch regressions.

## Planning scratch (local, gitignored)

Agents may keep ephemeral notes in `.swarm-state.md` or `weekly_plan.md` at the repo root — these files are **not** tracked. Update this roadmap (or open an issue) when work is ready to share.

## Deeper planning docs

See other files in `docs/planning/` for feature specs and epics.
