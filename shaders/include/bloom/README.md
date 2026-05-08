# Modular Bloom Shader System

## Overview

This directory contains a refactored, modular bloom pattern shader system that
replaces the five monolithic `patternv0.*_bloom.wgsl` variants with:

- **4 shared include modules** (`core`, `math`, `chrome`, `utils`)
- **1 unified main shader** (`pattern_bloom.wgsl`) with runtime preset switching

## Line-Count Comparison

| Approach | Files | Total Lines | Duplication |
|----------|-------|-------------|-------------|
| Old (v0.30–v0.35) | 5 standalone shaders | **1,944** | ~80% copy-paste |
| New (modular) | 4 includes + 1 main | **814** | **0%** (all shared) |
| **Savings** | — | **−1,130 lines (−58%)** | — |

## Architecture

```
pattern_bloom.wgsl          ← 506 lines (entry point + preset logic)
├── bloom/core.wgsl         ← 140 lines (uniforms, bindings, vertex shader)
├── bloom/math.wgsl         ←  41 lines (SDFs, palettes, note helpers)
├── bloom/chrome.wgsl       ←  89 lines (FragmentConstants, drawChromeIndicator)
└── bloom/utils.wgsl        ←  38 lines (bloom curves, kick glow, dither)
```

### Why inlining instead of `#include`?

WGSL has no native `#include` preprocessor. The project already fetches shaders
as strings and passes them to `device.createShaderModule()`. The main file above
is a **fully assembled, drop-in replacement** with clear `SECTION` banners so you
can split it back out later if you add a JS assembler.

## Preset System

The unified shader exposes a `bloomPreset` uniform (at offset 96, aliasing the
`colorPalette` slot in the extended uniform buffer). The host sets this to switch
visual modes at runtime:

| Preset | Name | Description | Origin |
|--------|------|-------------|--------|
| `0` | **Classic HDR** | Channel-activity top light, snappy decay, no dimming | v0.30_bloom |
| `1` | **Linger** | Slower decay, brighter flashes, additive bloom | v0.32_bloom |
| `2` | **Expression Strike** | Step-level expression data, playhead strike burst | v0.33_bloom |
| `3` | **Night Mode** | Dimming, UV purple ring, kick reactive, dither | v0.34/v0.35_bloom |

All presets use the **modern high-precision data packing** (same as v0.51), so
you only need one `packPatternMatrixHighPrecision` call on the TypeScript side.

### Preset behavior matrix

| Feature | Classic (0) | Linger (1) | Strike (2) | Night (3) |
|---------|-------------|------------|------------|-----------|
| Top light source | Channel activity | Channel activity | Step expression | Step expression |
| Top decay rate | `exp(-age*4.0)` | `exp(-age*1.5)` | — | — |
| Playhead strike | ❌ | ❌ | ✅ (3×) | ✅ (3×) |
| Note linger | ❌ | ✅ | ✅ | ✅ |
| Night dimming | ❌ | ❌ | ❌ | ✅ (`dimFactor`) |
| UV purple ring | ❌ | ❌ | ❌ | ✅ |
| Kick reactive glow | ❌ | ❌ | ❌ | ✅ |
| Film-grain dither | ❌ | ❌ | ❌ | ✅ |

## TypeScript Integration

### 1. Add the new shader to `SHADER_GROUPS`

In `App.tsx`, replace the old bloom entry:

```typescript
// Before
{ id: 'patternv0.35_bloom.wgsl', label: 'v0.35 (Bloom)' },

// After
{ id: 'pattern_bloom.wgsl', label: 'Bloom (Unified)' },
```

### 2. Update `useWebGPURender.ts` flags

Add `pattern_bloom.wgsl` to the modern-shader lists:

```typescript
// isHighPrec — use packPatternMatrixHighPrecision
const isHighPrec = shaderFile.includes('v0.36') || ... || shaderFile.includes('pattern_bloom');

// playheadRowAsFloat
playheadRowAsFloat: shaderFile.includes('v0.21') || ... || shaderFile.includes('pattern_bloom'),
```

### 3. Pass the preset

The `bloomPreset` field lives at the same byte offset as `colorPalette` (offset
96 in the extended uniform buffer). You can pass the preset by reusing the
existing `colorPalette` parameter:

```typescript
fillUniformPayload(layoutTypeRef.current, {
  // ... other params ...
  colorPalette: presetIndex, // 0–3 mapped to bloomPreset
}, uint, float);
```

Or add a dedicated `bloomPreset` key to the params object and write it to
`uint[24]` in `fillUniformPayload`.

### 4. Update `PatternDisplay.tsx` overlay logic

Add `pattern_bloom` to any filename-based checks that currently look for
`v0.35`:

```typescript
const isOverlayActive = shaderFile.includes('v0.21') || ... || shaderFile.includes('pattern_bloom');
const padTopChannel = shaderFile.includes('v0.16') || ... || shaderFile.includes('pattern_bloom');
```

## Data Format Notes

The old `patternv0.35_bloom.wgsl` used the **legacy** `packPatternMatrix` format:
- `packedA`: `[note:8][inst:8][volCmd:8][volVal:8]` (note as raw numeric index)
- `packedB`: `[volType:8][volValue:8][effCode:8][effParam:8]`

The unified shader uses the **modern** `packPatternMatrixHighPrecision` format:
- `packedA`: `[note:8][inst:8][duration:8][volPacked:8]`
- `packedB`: `[effCmd:8][effVal:8][durationFlags:7][reserved:1][volCmd:8]`

This fixes a long-standing bug in v0.35 where `pitchClassFromPacked` treated
note indices as ASCII character codes, causing incorrect note colors.

## Standalone Bloom Pipeline

The post-processing bloom pass (`bloom_threshold`, `bloom_blur`, `bloom_composite`)
is **unchanged**. It operates on the rendered scene texture and is completely
decoupled from the pattern shader presets.
