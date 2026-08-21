# WGSL Shaders for mod-player

This directory contains the WebGPU shader library for the mod-player tracker visualizer. Shaders are organized by their active status and layout type.

## Directory Structure

### Root Shaders (Active & Maintained)

The root directory contains **30 actively-used shaders** that are production-ready and integrated into the application:

#### **Pattern Shaders** (Real-time tracker data visualization)

**Square/Horizontal Layouts:**
- `patternv0.21.wgsl` — Wall (horizontal grid)
- `patternv0.39.wgsl` — Modern (horizontal)
- `patternv0.40.wgsl` — Frosted Grid
- `patternv0.43.wgsl` — Frosted Wall (32-channel variant)
- `patternv0.44.wgsl` — Frosted Wall (64-channel variant)

**Circular Layouts:**
- `patternv0.30.wgsl` — Disc (legacy circular)
- `patternv0.35_bloom.wgsl` — Bloom effect with circular layout
- `patternv0.37.wgsl` — Legacy circular (reference layout)
- `patternv0.38.wgsl` — Glass (circular with transparency)
- `patternv0.42.wgsl` — Frosted Disc (circular with frosted effect)
- `patternv0.45.wgsl` — Frosted Bloom (circular with bloom)
- `patternv0.45b.wgsl` — Note-On Sustain (circular variant)
- `patternv0.46.wgsl` — Frosted Glass (circular with advanced glass effect)
- `patternv0.47.wgsl` — Trap Frosted (circular with trap layout)
- `patternv0.48.wgsl` — Trap Frosted Disc (disc variant)
- `patternv0.49.wgsl` — Trap Frosted Glass (advanced circular)
- `patternv0.50.wgsl` — Trap Frosted Lens (tier-B: `theme_trap_frosted` + `circular_led_body`)
- `patternv0.50b.wgsl` — Hybrid Frosted Lens (tier-A utility includes)
- `patternv0.51.wgsl` — Playhead Arc (tier-B: `emitters_playhead` + arc FS)
- `patternv0.52.wgsl` — Night (theme-only entry → `lib/circular_night_body.wgsl`)
- `patternv0.53.wgsl` — Midnight (theme-only night variant)
- `patternv0.54.wgsl` — Neon Night (theme-only night variant)
- `patternv0.55.wgsl` — Oscilloscope mode (tier-A includes + binding 6)
- `patternv0.56.wgsl` / `patternv0.57.wgsl` — instrument palette / velocity LED (tier-A or tier-B body)
- `patternv0.58.wgsl` — Reactive chassis (tier-B: `circular_led_reactive_body`)

**Video overlay shaders (documented exceptions — no cell-packing path):**
- `patternv0.23.wgsl` — Clouds (video texture mode)
- `patternv0.24.wgsl` — Tunnel (video texture mode)

#### **Background/Chassis Shaders** (Device bezel & frame rendering)

- `bezel.wgsl` — Hardware bezel photo (used by circular layouts v0.45+)
- `chassis_frosted.wgsl` — Procedural frosted panel (used by square layouts)
- `chassis_video.wgsl` — Video background composite
- `chassisv0.1.wgsl` — Legacy chassis (very old circular layouts)
- `chassisv0.37.wgsl` — Legacy circular chassis (v0.37–v0.39 era)

#### **Post-Processing Shaders** (Bloom, blur, composite)

- `bloom_blur.wgsl` — Gaussian blur kernel
- `bloom_composite.wgsl` — Additive bloom composite (single-layer)
- `bloom_composite_layered.wgsl` — Multi-layer bloom composite
- `bloom_threshold.wgsl` — Threshold extraction for single-layer bloom
- `bloom_threshold_layered.wgsl` — Threshold extraction for multi-layer bloom

#### **Compute Shaders** (No vertex/fragment stages)

- `compute_note_duration.wgsl` — DURA-001: raw-packed cells → high-precision
  duration/sustain/trigger packing. One invocation per channel,
  `@workgroup_size(64, 1, 1)`; host dispatch must divide the channel count by
  the same constant (`NOTE_DURATION_WORKGROUP_SIZE` in `utils/computeNoteDuration.ts`).
- `compute_analysis.wgsl` — GPU audio analysis. Two entry points sharing one
  bind group: `waveform_main` (PCM → oscilloscope min/max tiles) and
  `spectrum_main` (Hann → radix-2 FFT → 4 bands + 32 log bins). Host is
  `src/renderers/webgpu/computeAnalysis.ts`; opted into per shader via the
  `usesGpuSpectrum` flag on `ShaderMeta`. Reads rendered PCM only — the tracker
  engine stays on CPU/WASM.

### `legacy/` Subfolder (Archived & Experimental)

The `legacy/` subdirectory contains **33 older or experimental shaders** that are no longer in active use but preserved for reference and potential restoration:

**Early Pattern Versions:**
- `patternShader.wgsl`, `patternShaderv0.0.wgsl`, `patternShaderv0.1.wgsl`, `patternShaderv0.11.wgsl`
- `patternv0.13.wgsl` through `patternv0.22.wgsl` (early extended-layout experiments)
- `patternv0.25` variants (5 files including `-sized`, `_clean`, `_minimax` experiments)
- `patternv0.26.wgsl` (pre-circular era)

**Circular Layout Experiments:**
- `patternv0.27` variants (4 files: `-orig`, `-v2`, `flip`, original)
- `patternv0.28.wgsl`, `patternv0.29.wgsl` (intermediate circular iterations)
- `patternv0.31.wgsl`, `patternv0.32.wgsl` (extended iteration)

**Bloom Experiments:**
- `patternv0.30_bloom.wgsl` (early bloom variant)
- `patternv0.32_bloom.wgsl`, `patternv0.33_bloom.wgsl`, `patternv0.34_bloom.wgsl` (bloom algorithm evolution)

**Miscellaneous:**
- `patternv0.36.wgsl` (high-precision packing prototype)
- `chassisv0.40.wgsl` (square chassis variant, superseded)

## Shader Development Notes

### Versioning Convention

Shaders follow semantic versioning in their filenames:
- `patternv0.XX.wgsl` — Main pattern visualization shader (tracked version)
- `chassisv0.XX.wgsl` — Background chassis shader (tracked separately)
- Suffixes like `_bloom`, `-sized`, `_clean` indicate variants or experiments

**DO NOT** add `shaderFile.includes('v0.XX')` chains in host code. Register capabilities in `utils/shaderRegistry.ts` (`ShaderMeta`) instead.

### Adding a New Shader

When introducing a new shader version:

1. **Create the WGSL file** in the root `shaders/` directory with a sequential version number (e.g., `patternv0.52.wgsl`)
2. **Reuse shared logic** from `shaders/lib/` via `//#include "lib/<fragment>.wgsl"` where possible. This keeps common code (e.g. `octaveBrightness`, DURA duration unpacking, three-emitter lens cap) in one place.
3. **Sync to public/**: Run `npm run sync:shaders`. The script resolves includes and writes flat, self-contained WGSL to `public/shaders/`. Do not hand-edit `public/shaders/`.
4. **Update App.tsx**: Add the shader to the appropriate `SHADER_GROUPS` array (SQUARE, CIRCULAR, or VIDEO)
5. **Update version checks** in:
   - `utils/shaderVersion.ts` — Add version to layout type, background selection, and alpha blending checks
   - `components/PatternDisplay.tsx` — Update canvas size and buffer packing logic
6. **Test**: Verify shader loads, renders, and synchronizes correctly with audio playback

### Shader Include System

Shared WGSL fragments live in `shaders/lib/`. **Canonical composition libs** (prefer these in new circular work):

| Lib | Role |
|-----|------|
| `lib/packing.wgsl` | PackedA/B field unpack, TRIG-001 `classifyCell`, pulls `notes` + `dura` |
| `lib/emitters.wgsl` | Three-emitter surface (pulls `lens_cap`, `top_emitter`, SDF, tonemap) |
| `lib/polar_layout.wgsl` | Circular ring geometry helpers for VS/FS |
| `lib/night_theme.wgsl` | Default night palette (v0.52 dusky) |
| `lib/circular_night_body.wgsl` | Shared uniforms + VS + FS for night family |
| `lib/theme_trap_frosted.wgsl` | Trap/frosted palette (v0.50 family) |
| `lib/circular_led_body.wgsl` | Trap three-emitter body (v0.50) |
| `lib/circular_led_velocity_body.wgsl` | v0.57 VEL-001 body |
| `lib/circular_led_reactive_body.wgsl` | v0.58 REACT-001 body |
| `lib/emitters_trap.wgsl` / `lib/lens_cap_trap.wgsl` | Trap lens cap (brilliantLEDCore mid glow) |
| `lib/emitters_playhead.wgsl` / `lib/lens_cap_playhead.wgsl` | v0.51 playhead variant |
| `lib/velocity_led.wgsl` | VEL-001 `normalizedCellVolume` |
| `lib/audio_reactive.wgsl` | REACT-001 multi-band chassis helpers |

**GPU audio analysis libs** (compute only — no bindings, no entry points):

| Lib | Role |
|-----|------|
| `lib/fft.wgsl` | Radix-2 in-place FFT in workgroup storage, Hann window, `fftMagnitude` |
| `lib/spectrum_bands.wgsl` | 4-band energy reduce + 32 log-spaced display bins (needs `lib/fft.wgsl` first) |
| `lib/waveform_minmax.wgsl` | Oscilloscope tile extrema + envelope collapse |

`lib/waveform_minmax.wgsl` calls `waveformSampleMono(frame)`, which the
including entry shader must declare **before** the include — WGSL resolves
functions in declaration order. `lib/spectrum_bands.wgsl` likewise has to come
after `lib/fft.wgsl`.

Sizing constants are duplicated in TypeScript (`MAX_FFT_SIZE`,
`SPECTRUM_BIN_COUNT`, workgroup sizes). `tests/computeAnalysis.test.ts` pins
them against the WGSL source — a mismatch there is a silent runtime bug, so it
fails the suite instead.

Supporting fragments:

- `lib/notes.wgsl` — `NOTE_MIN` / `NOTE_MAX` / `NOTE_OFF_MIN`
- `lib/pitch.wgsl` — pitch helpers including `octaveBrightness`
- `lib/dura.wgsl` — `NoteDurationInfo`, `unpackDurationInfo` (TRIG-001)
- `lib/palette.wgsl` — `selectPalette`
- `lib/sdf.wgsl` / `lib/tonemap.wgsl` / `lib/color_preserve.wgsl`
- `lib/top_emitter.wgsl` / `lib/lens_cap.wgsl`
- `lib/theme_night_53.wgsl` / `lib/theme_night_54.wgsl` — night variant palettes

**Night circular family (theme-only entries):**

```wgsl
// patternv0.52.wgsl — only theme differs
//#include "lib/night_theme.wgsl"
//#include "lib/circular_night_body.wgsl"
```

v0.53 / v0.54 swap in `theme_night_53` / `theme_night_54`. A packing or polar fix in `lib/` updates all three after sync.

Include directives look like WGSL comments so source files remain valid if loaded directly:

```wgsl
//#include "lib/pitch.wgsl"
```

**Publish path (single):** `npm run sync:shaders` (`scripts/sync-shaders.mjs`) expands includes recursively, guards against double-inclusion and cycles, rejects residual `//#include` in output, and writes flat WGSL to `public/shaders/`. Wired as `predev` / `prebuild`. Never hand-edit `public/shaders/`. The `lib/` directory is not copied to public (WebGPU has no includes).

### GPU Data Packing

**Standard Layout (v0.12 and earlier):**
```
Uint32 = [Note(8) | Instrument(8) | VolCmd(8) | VolVal(8)]
```

**High-Precision Layout (v0.13+, enhanced from v0.36+):**
```
PackedA = [Note(8) | Instrument(8) | VolCmd(8) | VolVal(8)]
PackedB = [Reserved(16) | EffectCmd(8) | EffectVal(8)]
```

**Critical:** If you modify packing in TypeScript (e.g., `utils/gpuPacking.ts` or `PatternDisplay.tsx`), you **must** update the bit-shifting logic in the corresponding WGSL shader.

## Performance & Compatibility

- **WebGPU Requirement:** Chrome 113+, Edge 113+, Arc, or other WebGPU-enabled browsers
- **Fallbacks:** WebGPU → WebGL2 (`?renderer=webgl2`, GLSL reference) → HTML (`?renderer=html`)
- **Canvas Sizes:** Most shaders use 1024×1024; legacy (v0.25–v0.26) use 2048×2016
- **Bloom Pipeline:** Uses separate threshold, blur, and composite passes

## Maintenance

- **Sync shaders between `/shaders/` and `/public/shaders/`** when adding new shaders. Runtime shaders must be in `public/shaders/` to be served to browsers
- **Archive old shaders** to `legacy/` to reduce visual clutter and improve IDE performance
- **Update references** in TypeScript when moving or removing a shader from the version-detection chains
- **Test locally** with `npm run dev` before deploying

## References

For deeper context on shader architecture and data flow, see:
- `CLAUDE.md` — Quick architecture reference
- `DEVELOPER_CONTEXT.md` — Detailed rationale and data-packing spec
- `AGENTS.md` — Build and deployment instructions
