# ADR: FX rack character stage — hand-written TypeScript worklet, not Faust (#453)

**Status:** accepted · 2026-10-10
**Decision:** keep the hand-written TypeScript AudioWorklet
(`audio-worklet/js/fx-character-processor.ts` + `audio-worklet/js/fx/`). Do not
adopt Faust (`@grame/faustwasm`) for the character stage now.

## Context

#453's "Phase 3" asked whether the character DSP (tape saturation with ×2
oversampling, the Amiga A500/A1200 LED filter, sample-and-hold + bit crush)
should be authored in Faust and compiled to wasm **at build time**, instead of
hand-written TypeScript compiled by esbuild like the libopenmpt worklet (#435).
The choice was to be made on measured CPU at 48 kHz.

Rule, fixed before measuring: adopt Faust only if **all** hold —

1. CPU ≤ 0.6× the TypeScript worklet,
2. shipped bytes grow by ≤ 40 KB gzipped,
3. output equivalent to ≤ −80 dB RMS difference (same algorithm, so the
   comparison is about the toolchain, not the sound),
4. no new CI system dependency.

## Method

`scripts/bench-fx-character.mjs` (run with `npm i --no-save
@grame/faustwasm@0.19.0` — a 31 MB package that is never a project
dependency):

- `bench/faust/character.dsp` implements the same chain with the same
  constants. The ×2 halfband is written as explicit polyphase at the base rate
  with the **same 24 taps** (`bench/faust/halfband_taps.lib`, generated from
  the TS design), so the two run the same algorithm, not merely similar ones.
  The 2·fs DC blocker becomes a pair of interleaved recursions.
- libfaust-wasm compiles the DSP (Faust compiler 2.x via faustwasm 0.19.0).
- 60 s of stereo noise at 48 kHz in 128-frame quanta through both, every
  sub-stage on (tape drive 0.6, LED on with the A500 RC, crush 11025 Hz /
  8 bits); median of 7 runs, after a warm-up.
- Equivalence: RMS of the difference after a 0.5 s settle, relative to the
  output RMS.

Both run on V8 (TS via TurboFan, Faust wasm via Liftoff → TurboFan), the same
engine as Chrome's AudioWorklet, so the Node numbers carry over. The TS
worklet's in-browser share is measured separately by the Chromium harness
(`npm run smoke:fx:ci`): 2.3–2.5 % of one core in headless Chrome.

## Results

Node 24.14, AMD EPYC (8 vCPU), 2026-10-10:

| | ns / stereo frame | % of one core @ 48 kHz | vs TS |
|---|---:|---:|---:|
| TypeScript worklet | 464–479 | 2.2–2.3 % | 1× |
| Faust wasm, float (`-ftz 2`) | 574 | 2.76 % | **1.20×** |
| Faust wasm, double (`-double -ftz 2`) | 598 | 2.87 % | **1.29×** |

| | Faust float | Faust double |
|---|---:|---:|
| Equivalence (RMS diff vs output) | −77.2 dB | **−93.5 dB** |

The double-precision build confirms the two implement the same algorithm
(−93.5 dB). The float build's −77 dB is float32 rounding in the crusher's
`x / step` landing on the other side of a quantizer tie now and then.

Shipped size (gzipped): TS worklet 6.3 KB; Faust DSP wasm 3.6–3.8 KB + 0.9 KB
JSON, plus a worklet runtime (faustwasm's `dist/esm` is 42 KB gzipped
including its compiler wrapper; a hand-written loader could be a few KB).
Building also needs libfaust (≈ 6 MB of wasm + data) in CI.

## Decision

Faust fails rule 1 by a wide margin: **1.2–1.3× the CPU** of the TypeScript
worklet, not ≤ 0.6×. Rules 2 and 3 could be met (double precision, a small
custom loader), rule 4 not without adding libfaust to the build. Keep the
TypeScript worklet.

Why the TS stage holds up: its kernels are staged block loops over
preallocated Float64 scratch with all state in locals (also what keeps
`process()` allocation-free), the polyphase halfband is folded on its
symmetry (12 multiplies per output instead of 24), and every sub-stage's
smoothing is a couple of compares per sample. Faust's generated code is
per-sample and general; with `tanh` dominating either way, the remaining
work is where the TS version is leaner.

## Consequences

- No Faust toolchain in the build or CI; `bench/faust/` and the benchmark
  script stay as the reproducible record.
- Revisit if the character stage grows much heavier DSP (e.g. ×4/×8
  oversampling, wave-digital tape models), where Faust's library and
  compiler optimizations matter more than they do for this chain — rerun
  `scripts/bench-fx-character.mjs` against the same rule.
- The native C++ engine hosting these stages in its wasm (the #450 threading
  notes) remains a separate follow-up.

## Reproduce

```bash
npm i --no-save @grame/faustwasm@0.19.0
node scripts/bench-fx-character.mjs                          # float
FAUST_ARGS="-double -ftz 2" node scripts/bench-fx-character.mjs
# BENCH_SECONDS / BENCH_RUNS shorten it; FAUSTWASM=<path> points at a copy elsewhere.
```
