# Archive

Historical and experimental code **not wired into the production app**.

Nothing under `archive/` is imported by `App.tsx`, CI, or `npm run build`. Keep experiments here (or a branch) until they have imports, tests, and a review path.

| Path | What it was |
|------|-------------|
| `experimental/components/PatternDisplay.responsive.tsx` | Agent experiment — responsive layout variant (~468 LOC) |
| `experimental/components/PatternDisplay.vfx.tsx` | Agent experiment — VFX variant with weaker WebGPU init (~348 LOC) |

Production pattern UI: `components/PatternDisplay.tsx` + `hooks/useWebGPURender.ts` + `src/renderers/`.
