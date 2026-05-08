# WGSL Shader Include System

This directory contains the source WGSL shaders for the mod-player WebGPU visualizer.

## Directory Layout

```
shaders/
  src/           ← Source files that use #include directives
  include/       ← Shared modules (libraries)
  archive/       ← Old shaders kept for reference
  *.wgsl         ← Legacy standalone shaders (copied as-is to public/shaders/)
```

## How It Works

The project uses a small custom preprocessor (`scripts/build-shaders.mjs`) because WGSL has no native `#include`.

1. **Source files** in `shaders/src/` use `#include "path"` directives.
2. **Include paths** are resolved relative to `shaders/include/` first, then relative to the source file.
3. The build script inlines included files recursively and writes the assembled result to `public/shaders/`.
4. **Legacy shaders** in `shaders/` root (not in `src/` or `include/`) are copied verbatim to `public/shaders/`.

## Build Command

```bash
npm run build:shaders
```

This is also run automatically before `npm run dev` and `npm run build`.

## Writing a New Shader with Includes

Create a file in `shaders/src/myshader.wgsl`:

```wgsl
// ============================================================
// myshader.wgsl
// ============================================================

#include "common.wgsl"
#include "pattern_base.wgsl"

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  // Your fragment shader logic here...
}
```

Then run `npm run build:shaders`. The assembled file will appear at `public/shaders/myshader.wgsl`.

## Available Include Modules

### Core
- `common.wgsl` — Standard `Uniforms` struct, bindings, circular vertex shader (`vs`), SDFs (`sdRoundedBox`, `sdCircle`, `sdEllipse`), palettes (`neonPalette`, `pitchClassFromIndex`), and shared constants (`DEAD_COLOR`, `TAU`, etc.).
- `pattern_base.wgsl` — LED lens logic, duration unpacking (`unpackDurationInfo`), sustain brightness, three-emitter top-LED helper, and `drawUnifiedLensCap`.
- `bloom_utils.wgsl` — Bloom curves (`bloomBoost`, `bloomBoostMedium`, `bloomSoft`), glow kernels, kick-reactive flash, and dither noise.
- `chassis_base.wgsl` — `BezelUniforms`, SDF primitives, 7-segment digit rendering, noise, and fullscreen vertex shader for chassis backgrounds.

### Bloom Family
- `bloom/core.wgsl` — Extended `Uniforms` with `bloomPreset`, circular vertex shader, and `ChannelState`.
- `bloom/math.wgsl` — SDFs, `neonPalette`, `pitchClassFromIndex`, and `effectColorFromCode`.
- `bloom/chrome.wgsl` — HDR chrome dome indicator (`drawChromeIndicator`) with bezel + lens optics.
- `bloom/utils.wgsl` — Bloom intensity curves and post-processing utilities.

## Include Guard

Add `#pragma once` at the top of an include file to prevent it from being inlined more than once per compilation unit (useful if multiple includes transitively include the same file).

## Important Rules

1. **Binding order matters.** `common.wgsl` or `bloom/core.wgsl` must be included first because they declare `struct Uniforms` and `@group(0) @binding(N)`.
2. **No duplicate definitions.** WGSL does not allow two functions with the same name. Ensure your includes and source don't define the same function.
3. **Generated files are ephemeral.** Never edit `public/shaders/*.wgsl` directly — changes will be overwritten on the next build.
