# Experimental PatternDisplay variants (orphaned)

These files were generated during agent-swarm experiments and were **never imported** by the app.

Do not copy them back into `components/` without:

1. A real import from `App.tsx` / `MainLayout.tsx`
2. Registry entry in `utils/shaderRegistry.ts` (not new `includes('v0.XX')` chains)
3. `npm run typecheck` + `npm run test:shader-registry` + `npm run smoke:visual:ci`

Use the production stack instead: `components/PatternDisplay.tsx`.
