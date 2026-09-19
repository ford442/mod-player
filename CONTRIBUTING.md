# Contributing

## First-party vs experimental

| First-party (ship here) | Experimental (do not land without review) |
|-------------------------|---------------------------------------------|
| `components/`, `hooks/`, `utils/`, `src/` | `archive/` |
| `shaders/` + `public/shaders/` (synced) | `shaders-enhanced/` (prototypes) |
| `appConfig.ts`, `utils/shaderRegistry.ts` | Agent scratch output at repo root |
| `scripts/`, `cpp/`, `public/worklets/` | Duplicate mini-apps or vendor trees |

## Rules for agents and humans

1. **No orphan components** — Do not add files under `components/` unless something in the app imports them (`App.tsx`, `MainLayout.tsx`, etc.).
2. **Shader changes** — Edit `utils/shaderRegistry.ts` + `appConfig.ts` + WGSL; run `npm run test:shader-registry`.
3. **Agent output** — Put throwaway experiments in `archive/` or a feature branch, not next to production files.
4. **libopenmpt source** — Only `vendor/libopenmpt-*` (gitignored, downloaded by `scripts/build-wasm.sh`). Do not commit a second copy at repo root.
5. **Deploy** — Use `deploy.py` only; `deploy_old.py` was removed.

## Checks before PR

```bash
npm run preflight
```

One command, chained with `&&`, stopping at the first failure. In order:
`verify:lockfile` → `npm ci --dry-run --ignore-scripts` → `lint` → `typecheck` →
`typecheck:tests` → `test` → `test:shader-registry` → `build`. It mirrors the
`lint-and-build` CI job, so a green preflight is a real signal about **that job**.

**What preflight does _not_ cover:** `visual-smoke`, `audio-smoke`,
`playhead-smoke`, `wasm-smoke-test` and `native-full-build`. Those need a
Playwright browser or emsdk 3.1.51 and still only run in CI (or locally via
`npm run smoke:visual:ci`, `npm run smoke:audio:ci`, `npm run smoke:playhead`,
`npm run build:emcc`).

### Lockfile guards

- `npm run verify:lockfile` (`scripts/verify-lockfile.mjs`) checks only what npm's
  own validation skips: `lockfileVersion` is exactly 3, and every non-`link`
  `packages[]` entry has both `resolved` and `integrity`.
- `npm ci --dry-run --ignore-scripts` is the dependency-graph check. It is npm's
  own validator — it catches a deleted `packages[]` subtree in ~2s, offline, and
  names the exact missing specifier (`Missing: @esbuild/…@0.21.5 from lock file`).
  Do not wrap or reimplement it.

Regenerate `package-lock.json` with `npm install`; never hand-edit it.

### `main` is protected

`main` is covered by a repository ruleset: changes land through a pull request
with the `lint-and-build` status check passing, and force-pushes and branch
deletion are blocked. Direct `git push origin main` is refused — use a feature
branch.

See `docs/REPO_LAYOUT.md` for directory map and `AGENTS.md` / `CLAUDE.md` for architecture.
