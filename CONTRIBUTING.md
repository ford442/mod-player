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
npm ci
npm run typecheck
npm run lint
npm run test:shader-registry
npm run build
# optional: npm run smoke:visual:ci (needs preview server)
```

See `docs/REPO_LAYOUT.md` for directory map and `AGENTS.md` / `CLAUDE.md` for architecture.
