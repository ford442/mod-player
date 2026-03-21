# Finalized Pattern Shaders

Four clean, production-ready WGSL shaders for the mod-player visualizer.

## Overview

| Shader | Layout | Cell Shape | Aesthetic | Best For |
|--------|--------|------------|-----------|----------|
| `pattern_square.wgsl` | Horizontal Grid | Rounded Square | Clean, technical | Traditional tracker feel |
| `pattern_circle.wgsl` | Concentric Rings | Circle | Warm, glowing | Eye-catching radial view |
| `pattern_triangle.wgsl` | Concentric Rings | Triangle | Edgy, unique | Distinctive look |
| `pattern_circle_frosted.wgsl` | Concentric Rings | Circle | **Frosted glass** | Premium translucent look |

## Shader Selection

Switch between shaders in your app code by loading the appropriate WGSL file:

```typescript
// Example shader selection
const SHADERS = {
  square:   '/shaders/pattern_square.wgsl',
  circle:   '/shaders/pattern_circle.wgsl',
  triangle: '/shaders/pattern_triangle.wgsl',
  frosted:  '/shaders/pattern_circle_frosted.wgsl',  // Best of v0.48/49
};

const selectedShader = SHADERS[selectedShape];
```

## Frosted Glass Shader (NEW)

The `pattern_circle_frosted.wgsl` shader combines the best of v0.48/49 with cleanup:

### Features
- **Frosted glass material** with subsurface scattering
- **Dual-color lighting**: Blue (idle) / Orange (active at playhead)
- **Gaussian diffusion** - light fills cap volume, no sharp LED dot
- **15 effect visualization** via `activeEffect` in packedB high byte
- **Channel mute feedback** - dims muted channels

### Dual-Color Lighting System
```
Idle Note (not at playhead):
  - Light color: Blue (0.2, 0.4, 1.0)
  - Soft ambient glow via Gaussian scatter

Active Note (at playhead):
  - Light color: Orange (1.0, 0.6, 0.1)
  - Bright flash with bloom boost
```

### Required Setup
Same as `pattern_circle.wgsl`:
```typescript
// Set padTopChannel for indicator ring
uniforms.padTopChannel = 1;  // Channel 0 = playhead indicator
```

## Uniform Buffer Layout

All three shaders use the same uniform structure:

```wgsl
struct Uniforms {
  numRows: u32,
  numChannels: u32,
  playheadRow: f32,        // Current playback position
  isPlaying: u32,
  cellW: f32,
  cellH: f32,
  canvasW: f32,
  canvasH: f32,
  tickOffset: f32,
  bpm: f32,
  timeSec: f32,
  beatPhase: f32,          // 0.0-1.0 beat cycle
  groove: f32,
  kickTrigger: f32,        // 0.0-1.0 kick intensity
  activeChannels: u32,
  isModuleLoaded: u32,
  bloomIntensity: f32,
  bloomThreshold: f32,
  invertChannels: u32,
  
  // Shader-specific:
  // Square: dimFactor: f32, gridRect: vec4<f32>
  // Circle: padTopChannel: u32
  // Triangle: padTopChannel: u32
};
```

## Shape-Specific Parameters

### Square Shader

```wgsl
// Additional uniforms for square shader
dimFactor: f32,           // Global dimming (0.0-1.0)
gridRect: vec4<f32>,      // x, y, width, height (normalized)
```

**Layout:** Traditional horizontal grid where time flows left-to-right and channels are stacked vertically.

**Visual Features:**
- Rounded square cells with subtle border glow
- Note visualization with pitch-based color
- Effect indicator in corner
- Playhead highlighting

### Circle Shader

```wgsl
// Additional uniforms for circle shader
padTopChannel: u32,       // If 1, channel 0 is indicator ring
```

**Layout:** Radial arrangement with concentric rings. Each ring is a channel, time flows around the circle.

**Visual Features:**
- Circular cells with ring glow effect
- Warm orange playhead accent
- Inner/outer ring detail
- Specular highlight for depth

### Triangle Shader

```wgsl
// Additional uniforms for triangle shader
padTopChannel: u32,       // If 1, channel 0 is indicator ring
```

**Layout:** Same radial arrangement as circle, but with triangular cells pointing outward.

**Visual Features:**
- Rounded triangle cells
- Pink/magenta accent color
- Highlight at triangle tip
- Bottom effect dot indicator

## Color Palettes

All shaders use the same pitch-to-color mapping via `neonPalette()`:

```
Pitch class (0-11) → HSL color cycle
- C  (0)  → Purple
- C# (1)  → Blue-purple
- D  (2)  → Blue
- D# (3)  → Cyan
- E  (4)  → Teal
- F  (5)  → Green
- F# (6)  → Lime
- G  (7)  → Yellow
- G# (8)  → Orange
- A  (9)  → Red-orange
- A# (10) → Red
- B  (11) → Magenta
```

## Bind Group Layout

```wgsl
@group(0) @binding(0) cells: array<u32>           // Pattern data
@group(0) @binding(1) uniforms: Uniforms
@group(0) @binding(2) rowFlags: array<u32>
@group(0) @binding(3) channels: array<ChannelState>
@group(0) @binding(4) buttonsSampler: sampler
@group(0) @binding(5) buttonsTexture: texture_2d<f32>
```

## Data Packing

Pattern data is packed into two u32s per cell:

```
packedA: [Note(8) | Instr(8) | VolCmd(8) | VolVal(8)]
packedB: [Unused(16) | EffCmd(8) | EffVal(8)]
```

## Migration from Old Shaders

If you're currently using one of the v0.4x shaders:

1. **Replace shader file** with the appropriate finalized version
2. **Update uniform buffer** to match the new layout
3. **Set shape-specific parameters** (gridRect for square, padTopChannel for circle/triangle)
4. **Remove any UI discard logic** from your render pipeline (if you had workarounds)

## Performance Notes

- All shaders use similar complexity (SDF-based rendering)
- Circle and triangle shaders have slightly more complex SDFs but use same vertex load
- Bloom intensity affects fill rate, not vertex processing
- Dithering adds minimal cost but improves visual quality

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Cells not visible | Check `gridRect` (square) or ring radius bounds (circle/triangle) |
| Colors look wrong | Verify note values are 0-255, not 0-11 |
| Playhead not highlighting | Ensure `playheadRow` is updated every frame as f32 |
| Too dark | Increase `bloomIntensity` or check `dimFactor` (square) |
| UI overlap | For circle/triangle, set `padTopChannel=1` to reserve channel 0 |

## Future Enhancements

Potential additions for v2:
- Shader hot-swapping without pipeline rebuild
- Uniform-controlled color schemes
- Additional shapes (hexagon, diamond)
- Combined shape shader with shape selector uniform
