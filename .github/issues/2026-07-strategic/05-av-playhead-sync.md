---
title: "P1: Harden AudioWorklet A/V playhead sync (parity with ScriptProcessor)"
priority: P1
type: Performance
complexity: L
labels: [audio, playhead, accuracy, visualization]
---

## Problem / opportunity

ScriptProcessor queries position on the same callback that renders audio → inherently tight sync. The AudioWorklet path historically lagged **~200–500 ms** visually. Prediction/fractional `rowFraction`, latency-aware dt, EMA, and f32 playhead uniforms have landed (`docs/planning/accurate_playback.md`, #334 noteAge fix), but backlog still treats worklet-vs-ScriptProcessor **parity as unfinished verification + hardening**.

Circular/paged shaders remain the most sensitive to residual drift (page flips late relative to note attacks).

## Proposed solution

1. Promote `npm run test:playhead` (today under `utils/__debug__/playheadPrediction.test.cjs`) into Vitest and CI.
2. Expose a small debug sample (`window.__PLAYHEAD_DEBUG__` or gated HUD) documenting `driftMs`, sample row vs predicted row.
3. Browser acceptance matrix (Chrome Worklet path): steady-tempo MOD; circular shaders v0.45–v0.50; assert page flips land on attacks; compare Worklet vs ScriptProcessor fallback with the same module.
4. Fix remaining gaps found in measurement (buffer tagging, EMA snap thresholds, native poll clock if in scope — otherwise leave native to issue 09).
5. Update `accurate_playback.md` with measured results and close the “200–500 ms” backlog claim with evidence.

## Acceptance criteria

- [ ] Playhead prediction tests run under Vitest + CI
- [ ] Documented manual checklist passes on Worklet engine for at least one circular + one square shader
- [ ] Steady 125 BPM case: predicted latency offset &lt; 1 row for typical 30 ms device latency (existing math assertion kept)
- [ ] No packing/shader uniform layout breaks
- [ ] Worklet path remains default; ScriptProcessor remains fallback only

## Dependencies / libraries

None new.

## Notes

Depends on audio regression harness remaining green so sync work doesn’t reintroduce silent playback.
