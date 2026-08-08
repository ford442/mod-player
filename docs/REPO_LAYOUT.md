# Repository layout

What is **production** vs **supporting** vs **ignored/experimental**.

## Production (first-party)

| Area | Role |
|------|------|
| `App.tsx`, `components/`, `hooks/` | React UI and audio bridge |
| `utils/shaderRegistry.ts`, `appConfig.ts` | Shader capabilities + picker |
| `shaders/`, `public/shaders/` | WGSL sources (keep in sync via `npm run sync:shaders`) |
| `src/renderers/` | WebGPU / WebGL2 / HTML renderer chain |
| `public/worklets/` | Tracked JS AudioWorklet (`openmpt-worklet.js`); native `openmpt-native.*` is build output |
| `cpp/` | Optional Emscripten native engine |
| `deploy.py` | Production deploy (storage API → VPS) |

## Supporting (in repo, not app runtime)

| Area | Role |
|------|------|
| `docs/` | Guides (`VISUAL_SMOKE.md`, `DEPLOY.md`, planning notes) |
| `docs/planning/ROADMAP.md` | Short living roadmap (GitHub issues); not agent run diaries |
| `scripts/` | Build, smoke tests, shader sync |
| `.github/workflows/` | CI |
| `archive/` | Demoted experiments — **not imported** |
| `shaders-enhanced/` | WGSL prototypes; promote via registry when ready |

## Gitignored / download at build time

| Path | Role |
|------|------|
| `vendor/` | libopenmpt tarball extracted by `scripts/build-wasm.sh` |
| `node_modules/`, `dist/` | npm / Vite output |
| `public/worklets/openmpt-native.*` | Emscripten build artifacts (from `npm run build:emcc`) |
| `a.out`, `a.out.*` | Emscripten default-name leftovers — **never commit** |
| `.swarm-state.md`, `weekly_plan.md` | Local agent planning scratch — use issues + `docs/planning/ROADMAP.md` |

**Do not** commit `libopenmpt-0.8.4+release/` at repo root — use `vendor/` only.

## Removed (P1 cleanup)

These were deleted or archived to reduce agent confusion:

- `components/PatternDisplay.responsive.tsx` / `.vfx.tsx` → `archive/experimental/components/`
- `kimi_agents/`, `mod-player-shaders/` — parallel scratch / historical fork
- Root `libopenmpt-0.8.4+release/` — duplicate of vendor download
- `deploy_old.py`, `finish_linting*.sh`, `kimi-fix-modplayer.sh`, `plan_test.md`
- `a.out.js`, `a.out.wasm`, `a.out.aw.js`, `a.out.ww.js` — untracked Emscripten default-name leftovers (not `openmpt-native.*`)
- `weekly_plan.md`, `.swarm-state.md`, `docs/.swarm-state.md` — agent run diaries replaced by `docs/planning/ROADMAP.md` + gitignore
- Root one-offs: `benchmark_pattern.cjs`, `test_perf.cjs`, `test.ts`, `verify_ui.py` — superseded by `scripts/` smoke tests

## Sparse checkout hint

Minimal clone for app work (no vendor, no archive):

```bash
git sparse-checkout set App.tsx components hooks utils src shaders public scripts package.json package-lock.json
```

Vendor libopenmpt is fetched on first `npm run build:emcc` if missing.
