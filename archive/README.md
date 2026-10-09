# Archive

Historical and experimental code **not wired into the production app**.

Nothing under `archive/` is imported by `App.tsx`, CI, or `npm run build`. Keep experiments here (or a branch) until they have imports, tests, and a review path.

| Path | What it was |
|------|-------------|
| `experimental/components/PatternDisplay.responsive.tsx` | Agent experiment — responsive layout variant (~468 LOC) |
| `experimental/components/PatternDisplay.vfx.tsx` | Agent experiment — VFX variant with weaker WebGPU init (~348 LOC). It fetches `shaders-enhanced/*.wgsl`, a directory that has since been removed (it was never copied to `public/`, so that fetch already 404ed) |

Production pattern UI: `components/PatternDisplay.tsx` + `hooks/useWebGPURender.ts` + `src/renderers/`.
