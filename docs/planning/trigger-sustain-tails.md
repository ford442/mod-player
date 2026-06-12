# Engineering Plan: Trigger Nodes with Sustain Tails

**Status: Implemented** (TRIG-001 / DURA-001)

## 1. Objective

Dual-state LED system for pattern display (WebGPU, WebGL2 reference, HTML fallback):

- **Trigger row** — brilliant, large, prominent glowing node (note-on event)
- **Sustain rows** — smaller, dimmer trail showing note duration
- **Empty cells** — subtle unlit background matrix

## 2. Architecture

### Part A: JS Data Packing (`utils/gpuPacking.ts`)

The GPU buffer carries **continuous sustain data** plus a **discrete trigger flag**.

| Plan concept | Implementation |
|---|---|
| Pitch / sustain present | `packedA` note byte (1–119); DURA-003 copies pitch onto tail rows |
| Trigger flag | `packedB` bit 15 (`PACKEDB_TRIGGER_FLAG = 0x8000`) |
| Duration | `packedA` bits 8–15 |
| Row offset | `packedB` `durationFlags` bits 1–6 |
| Note-off row | `durationFlags` bit 0 |

Functions:

- `calculateNoteDurations()` — scans patterns for note-offs, ECx cuts, volume-offs
- `packPatternMatrixHighPrecision()` — writes trigger bit on `dInfo.isTrigger` rows
- `isTriggerFromPackedB()` — CPU-side parity helper

Used automatically for shaders v0.36+ (see `usesHighPrecisionPacking()` in `utils/shaderVersion.ts`).

### Part B: WGSL Cell Evaluation

Shaders with TRIG-001 dual-state rendering:

| Shader | Trigger + tail style |
|---|---|
| `patternv0.47.wgsl` | Reference — frosted cap, `smoothstep(0.45)` trigger / `0.18` tail |
| `patternv0.50.wgsl` | Default — unified lens cap, three-emitter |
| `patternv0.51.wgsl`, `patternv0.55.wgsl` | Same unpack + classification |
| `patternv0.40.wgsl`, `patternv0.45b.wgsl` | Playhead-scrolled sustain + trigger flash |

Core fragment logic (v0.47 reference):

```wgsl
let dInfo = unpackDurationInfo(in.packedA, in.packedB);
let has_sustain = hasPitchNote && !dInfo.isNoteOff;
let is_trigger  = dInfo.isTrigger && hasPitchNote;
let is_sustain_tail = has_sustain && !is_trigger && dInfo.rowOffset > 0u;
```

Trigger uses larger cap + cyan bloom; sustain uses smaller cap + dim cyan tail.

### Part C: WebGL2 + HTML Fallback

- **WebGL2** (`hooks/webGLShaders.ts`) — mirrors WGSL trigger/tail radii and colors
- **HTML** (`components/PatternSequencer.tsx`) — `calculateNoteDurations()` drives cell scale, opacity, glow

## 3. Verification Criteria

| Criterion | How to verify |
|---|---|
| Short plucks → single bright trigger | Load staccato module; `getTriggerTailStats().sustains === 0` |
| Long notes → bright trigger + dim tail | Load pad-heavy module; sustains > 0 in stats |
| Trigger larger/brighter than tail | Visual: `smoothstep(0.45)` vs `0.18` radii |
| Empty cells stay dim | No note in packedA → no cap drawn |
| No full-lane flooding | Sustain `midIntensity` capped ~0.14–0.35 |

### Automated capture (Colab / headless Chrome)

```bash
npm run dev -- --host 0.0.0.0 --port 5173
npm run capture:trigger-tail
# → /mnt/ramdisk/trigger-tail/*.png + summary.json
```

`window.__TEST_HOOKS__` exposes `seekToRow`, `loadModuleFromUrl`, `getTriggerTailStats`.

## 4. Why This Works

Keeping sustain data intact and only changing *render* branch per row gives:

- Precise rhythmic triggers (big bright nodes)
- Duration information (dim connecting tails)
- Better readability than discrete-only dots or full bright lanes

## 5. Files

| File | Role |
|---|---|
| `utils/gpuPacking.ts` | Duration scan + trigger flag packing |
| `shaders/patternv0.47.wgsl` | Reference WGSL implementation |
| `shaders/patternv0.50.wgsl` | Default production shader |
| `hooks/webGLShaders.ts` | WebGL2 GLSL reference |
| `components/PatternSequencer.tsx` | HTML fallback styling |
| `scripts/capture-trigger-tail.mjs` | Headless Chrome regression captures |
| `utils/shaderVersion.ts` | `usesHighPrecisionPacking()` helper |

## 6. Relation to Other Plans

Supersedes stricter discrete-only step-sequencer accuracy where it conflicts. Complements playhead animation plans (uniform `playheadRow` already passed).

## 7. Automated Tests

```bash
npm run test:trigger-tail   # synthetic 8-row pattern: 1 trigger + 6 sustains + note-off
npm run capture:trigger-tail  # headless Chrome screenshots (Colab)
```

## Appendix: Original WGSL Reference (plan §2B)

Plan used `RGBA32Float` texture sampling; production uses `unpackDurationInfo(packedA, packedB)` with equivalent semantics:

```wgsl
let has_sustain = hasPitchNote && !dInfo.isNoteOff;
let is_trigger  = dInfo.isTrigger && hasPitchNote;  // packedB bit 15
// Trigger: smoothstep(0.45, 0.0, dist) + bloom smoothstep(0.7, 0.0, dist) * 0.6
// Tail:     smoothstep(0.18, 0.0, dist) * 0.65, color (0.15, 0.45, 0.65)
```

See `patternv0.47.wgsl` lines 421–472 for the canonical implementation.