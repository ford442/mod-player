# Shader Refactor Validation Checklist & Test Plan

> **Purpose:** Verify that the modular WGSL refactor (include system + chassis extraction + bloom unification) produces visually identical output and does not introduce regressions.

---

## 1. Pre-Flight Checks (Do These First)

Run these commands before any visual testing. All must pass.

| # | Check | Command | Expected Result |
|---|-------|---------|-----------------|
| 1 | Shader build succeeds | `npm run build:shaders` | "✅ Done. N .wgsl file(s) in public/shaders/" |
| 2 | TypeScript compiles | `npm run typecheck` | Only pre-existing `clsx` / `tailwind-merge` errors |
| 3 | Vite production build | `npm run build` | `dist/` created with no shader-related errors |
| 4 | No duplicate WGSL symbols | `node scripts/validate-shaders.mjs` | "0 duplicate function definitions found" |
| 5 | Generated shaders present | `ls public/shaders/*.wgsl` | `patternv0.51.wgsl`, `pattern_bloom.wgsl`, `chassis_frosted.wgsl`, `chassis_dark.wgsl` exist |

---

## 2. Functional Validation by Shader

### 2.1 `patternv0.51.wgsl` (Primary — Most Complex)

Load any MOD file (e.g. `4-mat_madness.mod`) and select **v0.51 (Trap Frosted Lens)** from the shader dropdown.

| # | Test | Visual Criterion | Pass? |
|---|------|-----------------|-------|
| 1 | Circular layout renders | Channels arranged in concentric rings, not a grid | ☐ |
| 2 | Playhead arc (ARC-001) | Thin golden arc sweeps at the current playhead row | ☐ |
| 3 | Three-emitter lens caps | Each cell shows top (blue note-on), middle (note color), bottom (amber control) | ☐ |
| 4 | Note duration tails (DURA) | Sustain notes show dimmed tail LEDs in subsequent rows | ☐ |
| 5 | Channel 0 indicator ring | Center indicator pulses with playhead; blue when active | ☐ |
| 6 | Kick reactive glow | Magenta flash on kick drum hits | ☐ |
| 7 | Night-mode dithering | Subtle film grain visible in dark regions | ☐ |
| 8 | No red-screen artifacts | `in.channel >= uniforms.numChannels` should NOT trigger red return | ☐ |
| 9 | High-precision packing | Notes display correct pitch-class colors (C=red, D=orange, etc.) | ☐ |

### 2.2 `pattern_bloom.wgsl` (Unified Bloom)

Select **Bloom (Unified)** from the shader dropdown.

| # | Test | Visual Criterion | Pass? |
|---|------|-----------------|-------|
| 1 | Preset 0 — Classic HDR | Cyan chrome domes, channel-activity top light, no dimming | ☐ |
| 2 | Preset 1 — Linger | Slower decay on top light, brighter flash on note-on | ☐ |
| 3 | Preset 2 — Expression Strike | Top light reacts to expression data (vol/pan/effect), playhead strike flash | ☐ |
| 4 | Preset 3 — Night Mode | Purple UV ring, dimmed housing, kick dither, bloomPreset=3 | ☐ |
| 5 | Circular layout | Same ring geometry as v0.51 | ☐ |
| 6 | No "dead" cells | Empty cells show chrome dome housing, not pure black | ☐ |

> **How to switch presets:** The app writes `bloomPreset` to `uniforms.colorPalette` (offset 96). Verify each preset by changing `DEFAULT_BLOOM_PRESET` in `types/bloomPresets.ts` temporarily, or add a UI selector.

### 2.3 `chassis_frosted.wgsl` (Background)

Select any shader that uses the frosted chassis: **v0.21, v0.40, v0.42, v0.43, v0.44**.

| # | Test | Visual Criterion | Pass? |
|---|------|-----------------|-------|
| 1 | White plastic panel | Light gray/white background with subtle grain | ☐ |
| 2 | Display recess | Dark rectangular recess at top-center | ☐ |
| 3 | Volume slider | Horizontal slider at left, green handle moves with volume | ☐ |
| 4 | Pan slider | Vertical slider at right, color shifts red↔blue | ☐ |
| 5 | LCD displays | Cyan BPM (3 digits), amber Order/Row (2 digits each) | ☐ |
| 6 | LOOP button | Purple ring icon, lights up when looping | ☐ |
| 7 | OPEN button | Folder icon, amber when clicked | ☐ |
| 8 | PLAY/STOP buttons | Green play triangle, red stop square, at bottom-left | ☐ |
| 9 | PREV/NEXT buttons | Small blue arrows above play/stop | ☐ |
| 10 | Button click feedback | `clickedButton` uniform causes brief glow | ☐ |

### 2.4 `chassis_dark.wgsl` (Background)

Select any shader that uses the dark chassis: **v0.37, v0.38, v0.39**.

| # | Test | Visual Criterion | Pass? |
|---|------|-----------------|-------|
| 1 | Dark plastic case | Near-black background with texture overlay | ☐ |
| 2 | Volume slider | Horizontal track + green circular handle | ☐ |
| 3 | Pan slider | Vertical track + color-coded handle | ☐ |
| 4 | Labels | "Tempo", "BPM", "Pan", "Vol" text visible | ☐ |
| 5 | LCD displays | Cyan BPM, amber Order/Row | ☐ |
| 6 | LOOP button | White square with purple glow when active | ☐ |
| 7 | OPEN button | White square with eject triangle icon | ☐ |
| 8 | PLAY/STOP buttons | White squares at bottom-left | ☐ |
| 9 | Song position rail | Horizontal bar at bottom with position marker | ☐ |
| 10 | Night-mode dimming | `dimFactor < 1.0` darkens case but keeps LCDs bright | ☐ |

### 2.5 Legacy Shaders (Smoke Test)

Quickly verify these still load without WebGPU compilation errors:

- [ ] `v0.30 (Disc)`
- [ ] `v0.35 (Bloom)` — old bloom, not the unified one
- [ ] `v0.38 (Glass)`
- [ ] `v0.42 (Frosted Disc)`
- [ ] `v0.45 (Frosted Bloom)`
- [ ] `v0.46 (Frosted Glass)`
- [ ] `v0.47–v0.50 (Trapcode family)`
- [ ] `v0.23 (Clouds)` / `v0.24 (Tunnel)` — video shaders

---

## 3. Visual Regression Test Plan

### 3.1 Quick Before/After Render Comparison

**Option A: Browser Screenshot Method (Recommended, ~5 min)**

```bash
# 1. Start the dev server
npm run dev

# 2. In another terminal, capture screenshots of all active shaders
node scripts/capture-shader-screenshots.mjs

# 3. Compare with reference images
node scripts/compare-screenshots.mjs
```

The `capture-shader-screenshots.mjs` script will:
1. Launch Chrome with `--enable-unsafe-webgpu`
2. Load the default module (`4-mat_madness.mod`)
3. Wait 5s for audio + render stabilization
4. Cycle through every shader in `SHADER_GROUPS`
5. Save `screenshots/{shaderName}.png`

**Option B: Manual Git Diff Method**

```bash
# 1. Save current ("after") screenshots
npm run dev &
node scripts/capture-shader-screenshots.mjs --out screenshots/after

# 2. Stash changes and capture "before"
git stash push -m "shader-refactor"
npm run build:shaders
node scripts/capture-shader-screenshots.mjs --out screenshots/before

# 3. Restore changes
git stash pop
npm run build:shaders

# 4. Compare
node scripts/compare-screenshots.mjs --before screenshots/before --after screenshots/after
```

### 3.2 What to Look For in Screenshots

| Difference Type | Threshold | Action if Exceeded |
|-----------------|-----------|-------------------|
| Pixel-perfect match | 0% | Ideal — no regression |
| Subtle noise/dither | < 0.5% | Acceptable — time-based noise is expected |
| Color shift | > 2% | Investigate — palette or uniform issue |
| Missing elements | Any | **Blocker** — structural shader bug |
| Layout shift | > 5px | **Blocker** — coordinate math changed |

### 3.3 Known Acceptable Differences

These are expected to differ slightly and are **not** regressions:

- Film-grain dither (`ditherNoise`) — varies per-frame
- Kick-reactive bloom flash — varies with audio
- Playhead position arc — moves continuously
- Chrome specular highlight — angle-dependent

To minimize these, capture screenshots at the **same playhead position** (e.g., pause at order 0, row 16).

---

## 4. Potential Breaking Changes — Watch List

### Critical (Will Cause Black Screen / Red Screen)

| # | Risk | Cause | Detection |
|---|------|-------|-----------|
| 1 | **Missing function** from include | `#include` path typo or file not copied | Browser console: `undefined function 'foo'` |
| 2 | **Duplicate function** | Include file and source both define same fn | `validate-shaders.mjs` catches this |
| 3 | **Binding mismatch** | `Uniforms` struct changed size but TS didn't | `tsc` error or GPU validation error |
| 4 | **Wrong layout type** | `shaderVersion.ts` returns 'standard' instead of 'extended' | Pattern renders as static noise or single color |
| 5 | **High-precision not triggered** | `isHighPrec` check missing new shader name | Notes show as garbled ASCII instead of pitch colors |
| 6 | **Background shader missing** | `getBackgroundShaderFile()` returns deleted file | Black background where chassis should be |

### Medium (Visual Degradation)

| # | Risk | Cause | Detection |
|---|------|-------|-----------|
| 7 | **Bezel texture not loaded** | `loadBezelTexture()` fails for new shader | Circular shaders show black inner ring |
| 8 | **Alpha blending disabled** | `shouldEnableAlphaBlending()` missing new shader | Jagged edges on transparent cells |
| 9 | **`playheadRowAsFloat` wrong** | `fillUniformPayload()` writes u32 instead of f32 | Playhead snaps between integers |
| 10 | **`layoutPreset` not set** | Dark chassis defaults to v0.37 layout | v0.40-style buttons missing or misplaced |
| 11 | **Bloom preset uniform wrong offset** | `bloomPreset` not at byte 96 | All bloom presets look identical |

### Low (Cosmetic)

| # | Risk | Cause | Detection |
|---|------|-------|-----------|
| 12 | **Include comment banners** | Build script adds `// >>> begin include` lines | Slightly larger shader source (harmless) |
| 13 | **Stale `public/shaders/` file** | Old hand-assembled version not deleted | Might be served instead of generated one |

---

## 5. Automated Regression Suite

Run the full suite with:

```bash
npm run test:shaders
```

This should execute:
1. `node scripts/build-shaders.mjs`
2. `node scripts/validate-shaders.mjs`
3. `node scripts/smoke-test-webgpu.mjs`
4. `node scripts/capture-shader-screenshots.mjs --quick`

> **Note:** `test:shaders` is not yet added to `package.json`. Add it when the scripts above are ready.

---

## 6. Sign-Off Criteria

The refactor is considered **validated** when:

- [ ] All 4 generated shaders compile without WebGPU validation errors
- [ ] `patternv0.51.wgsl` passes all 9 functional checks in §2.1
- [ ] `pattern_bloom.wgsl` passes all 6 functional checks in §2.2
- [ ] `chassis_frosted.wgsl` passes all 10 functional checks in §2.3
- [ ] `chassis_dark.wgsl` passes all 10 functional checks in §2.4
- [ ] Screenshot diff for each shader is < 2% pixel difference vs. reference
- [ ] No console errors containing `BOUNDS VIOLATION`, `CELL COUNT MISMATCH`, or `buffer size mismatch`
- [ ] Legacy shaders (§2.5) all load and render without errors
- [ ] `npm run build` completes successfully

---

*Last updated: 2026-05-08*
