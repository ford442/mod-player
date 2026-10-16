# Contributing

## First-party vs experimental

| First-party (ship here) | Experimental (do not land without review) |
|-------------------------|---------------------------------------------|
| `components/`, `hooks/`, `utils/`, `src/` | `archive/` |
| `shaders/` + `public/shaders/` (synced) | Shader prototypes that are not registered in `utils/shaderRegistry.ts` |
| `appConfig.ts`, `utils/shaderRegistry.ts` | Agent scratch output at repo root |
| `scripts/`, `cpp/`, `public/worklets/` | Duplicate mini-apps or vendor trees |

## Rules for agents and humans

1. **No orphan components** — Do not add files under `components/` unless something in the app imports them (`App.tsx`, `MainLayout.tsx`, etc.).
2. **Shader changes** — Edit `utils/shaderRegistry.ts` + `appConfig.ts` + WGSL; run `npm run test:shader-registry` (Vitest, also part of `npm test`).
3. **Agent output** — Put throwaway experiments in `archive/` or a feature branch, not next to production files.
4. **libopenmpt source** — Only `vendor/libopenmpt-*` (gitignored, downloaded by `scripts/build-wasm.sh`). Do not commit a second copy at repo root.
5. **Deploy** — Use `deploy.py` only; `deploy_old.py` was removed.

## Checks before PR

```bash
npm run preflight
```

One command, chained with `&&`, stopping at the first failure. In order:
`verify:lockfile` → `npm ci --dry-run --ignore-scripts --offline` → `verify:wasm` →
`verify:js-libopenmpt` → `verify:js-worklet-fresh` → `lint` → `typecheck` →
`typecheck:worklet` → `typecheck:tests` → `test` → `test:shader-includes` → `build` →
`verify:build:root` → `verify:bundle-budget`.

The `lint-and-build` CI job is `npm ci` followed by `npm run preflight` — it *is* this
chain, so the two cannot drift apart. Add new CI gates to the `preflight` script in
`package.json`, not to the workflow. It needs no network after `npm ci`.

**What preflight does _not_ cover:** `visual-smoke`, `audio-smoke`,
`playhead-smoke`, `wasm-smoke-test` and `native-full-build`. Those need a
Playwright browser or emsdk 3.1.51 and still only run in CI (or locally via
`npm run smoke:visual:ci`, `npm run smoke:audio:ci`, `npm run smoke:playhead`,
`npm run build:emcc`).

### Lockfile guards

- `npm run verify:lockfile` (`scripts/verify-lockfile.mjs`) checks only what npm's
  own validation skips: `lockfileVersion` is exactly 3, and every non-`link`
  `packages[]` entry has both `resolved` and `integrity`.
- `npm ci --dry-run --ignore-scripts --offline` is the dependency-graph check. It is npm's
  own validator — it catches a deleted `packages[]` subtree in ~2s, offline, and
  names the exact missing specifier (`Missing: @esbuild/…@0.21.5 from lock file`).
  Do not wrap or reimplement it.

Regenerate `package-lock.json` with `npm install`; never hand-edit it.

### `main` should be protected, but is not yet

Every one of the thirteen red CI runs behind #442 came from a direct `push
fix` commit to `main` — this convention alone did not stop them, and never
will, because it is opt-in. The fix is a **repository ruleset** on `main`:
require a pull request, require the `lint-and-build` status check, block
force-pushes, block branch deletion.

Checked directly against the GitHub API on 2026-09-26: `GET
/repos/ford442/mod-player/rulesets` returns `[]`. No ruleset exists yet, which
is also why `2d6a4ed` (a 40-file direct push, 2026-09-19) went straight
through. An agent session cannot create one — GitHub write access here is
scoped to code operations (push, PR, issues), and a repository-administration
call such as `POST /rulesets` is rejected by the proxy with "Write access to
this GitHub API path is not permitted through this proxy." **The repo owner
has to create it by hand**, once, in the GitHub UI:

Settings → Rules → Rulesets → New branch ruleset, target `main`, enforcement
Active, then enable: Require a pull request before merging (0 required
approvals is fine for a solo repo), Require status checks to pass →
`lint-and-build`, Block force pushes, Restrict deletions. Add yourself to
"Bypass list" with mode "Always" if you want an emergency hatch — but treat
that bypass as a last resort, not a substitute for a PR.

Until that ruleset exists, `git push origin main` **will succeed** — treat
the "use a feature branch" rule as still load-bearing on discipline alone.

See `docs/REPO_LAYOUT.md` for directory map and `AGENTS.md` / `CLAUDE.md` for architecture.
