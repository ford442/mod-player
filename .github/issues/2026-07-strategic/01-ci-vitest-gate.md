---
title: "P0: Gate CI on the full Vitest suite (`npm test`)"
priority: P0
type: DX / Foundation
complexity: S
labels: [test, maintenance, core]
---

## Problem / opportunity

Locally we already run **61 Vitest tests** across packing, duration parity, trigger tails, shader includes, share state, pattern edit, WAV encoder, etc. CI’s `lint-and-build` job only runs `npm run test:shader-registry` (a Node `.cjs` script). That means PRs can merge while breaking invariants that developers already rely on locally — the exact opposite of compounding quality.

Recent silent-audio and packing work depends on these suites remaining green. Leaving them out of CI recreates the “works on my machine” gap that contributed to production regressions.

## Proposed solution

1. Add a `npm test` (or `vitest run --reporter=default`) step to `.github/workflows/ci.yml` in `lint-and-build`, after `typecheck` and before/alongside `test:shader-registry`.
2. Optionally add `npm run typecheck:tests` so test TS stays honest.
3. Keep `test:shader-registry` (covers registry ↔ `SHADER_GROUPS` agreement not fully duplicated in Vitest).
4. Fail the job on any Vitest failure; do not raise the ESLint warning budget as part of this issue.
5. Document in `AGENTS.md` / `CONTRIBUTING.md` that CI runs the full unit suite.

## Acceptance criteria

- [ ] `lint-and-build` invokes `npm test` and fails the job when any Vitest test fails
- [ ] `npm test` remains green on `main` (61+ tests)
- [ ] Shader-registry check still runs
- [ ] No new dependencies required (Vitest already in `devDependencies`)
- [ ] Docs mention CI unit-test gate

## Dependencies / libraries

None new.

## Notes

Compounds with issue 02 (audio harness can live under Vitest or Playwright once CI already trusts `npm test`).
