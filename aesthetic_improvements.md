# Aesthetic Improvements Plan: mod-player

## Current State
- **Shaders v0.40/v0.43+**: Frosted glass look achieved, but **caps are opaque**.
- **PatternDisplay.tsx**: Renders grid + chassis/bezel background.
- **Issue**: Cells render fully opaque over frosted chassis → loses translucency/depth.

## Goals
1. **Accurate White Bezel Surround**: Perfect pixel alignment with `bezel-square.png`.
2. **Translucent Frosted Caps**: Like `/projects/ui_componants` experiment (glass + subsurface scattering).
3. **Layered Depth**: Bezel → Chassis → Semi-transparent Caps → Glows/Emissive.

## 1. Bezel Alignment Fix

**Current**: Canvas sized to shader expectations, but offset imprecise.

**Fix** (`PatternDisplay.tsx`):
```tsx
// v0.40/v0.43: Exact square bezel bounds
const BEZEL_INSET = { x: 160, y: 160, w: 705, h: 725 }; // From shader math

// Canvas: 1024x1024
// Render grid to exact inset rect
const gridRect = {
  x: BEZEL_INSET.x / 1024,
  y: BEZEL_INSET.y / 1024,
  w: BEZEL_INSET.w / 1024,
  h: BEZEL_INSET.h / 1024
};

// Pass to shader uniform: gridRect (vec4)
```

**Shader Update** (`patternv0.43.wgsl`):
```wgsl
// Replace hardcoded offsets with uniform
struct Uniforms {
  // ... existing
  gridRect: vec4<f32>,  // x,y,w,h normalized
}

@vertex
// Clip instances outside gridRect
let gridX = localRow * cellW / canvasW;
let gridY = f32(channel) * cellH / canvasH;
if (gridX < gridRect.x || gridX > gridRect.x + gridRect.z || 
    gridY < gridRect.y || gridY > gridRect.y + gridRect.w) {
  discard;
}
```

## 2. Translucent Frosted Caps

**Reference**: `/projects/ui_componants` → frosted glass with:
- Edge refraction
- Subsurface scattering
- Internal glow
- Alpha blending

**Current Shader** (opaque):
```wgsl
let edge = smoothstep(0.0, 0.1, -dBox);
col = mix(col, capColor, edge);  // Opaque overlay
```

**Target** (translucent):
```wgsl
// 1. Base frosted glass
let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.0);
let subsurface = exp(-thickness * 5.0) * noteGlow;
let glassColor = mix(bgColor * 0.3, capColor, 0.7);

// 2. Alpha with fresnel rim
let alpha = smoothstep(0.0, 0.1, -dBox) * (0.6 + 0.4 * fresnel);

// 3. Composite with blend
finalColor = mix(bgColor, glassColor, alpha);
finalColor.rgb += subsurface * capColor * 2.0;
```

**Uniforms Needed**:
```wgsl
glassThickness: f32,  // 0.1-0.3
fresnelPower: f32,    // 2.0-4.0
subsurfaceColor: vec3<f32>
```

## 3. Render Pipeline Changes

**Current**:
```
1. Bezel/Chassis pass (full canvas)
2. Pattern cells (instanced, opaque)
```

**New** (3 passes):
```
1. Bezel background (full 1024x1024)
2. Grid cells (clipped to exact inset rect, alpha-blend)
3. Glow/Emissive post-pass (optional bloom)
```

**PatternDisplay.tsx**:
```tsx
// Pass 1: Bezel
if (bezelPipeline) {
  // Render bezel quad
}

// Pass 2: Cells (ALPHA BLEND ENABLED)
const blendState = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
};
pipeline = device.createRenderPipeline({ ..., fragment: { ..., targets: [{ format, blend: blendState }] } });

// Pass 3: UI overlay (WebGL glass effects)
```

## 4. Shader-Specific Updates

| Shader | Current | Target | Priority |
|--------|---------|--------|----------|
| v0.40  | Opaque grid | Translucent + bezel align | High |
| v0.43  | Frosted UI | Frosted + glass caps | High |
| v0.44  | 64-step | Same + wider grid | Medium |
| v0.45  | Circular | Circular glass | Low |

## 5. ui_componants Integration

**Extract from `/projects/ui_componants`**:
```
FrostedGlassMaterial.tsx → WGSL fragment snippet
- refractionMap (precomputed)
- ior: 1.45 (glass)
- roughness: 0.1 (frosted)
- thicknessMap
```

**Port to WGSL** (`frosted_caps.wgsl` snippet):
```wgsl
fn frostedGlass(p: vec2<f32>, baseColor: vec3<f32>, glow: f32) -> vec4<f32> {
  // Refraction + scattering from ui_componants
  // ...
  return vec4(outColor, alpha);
}
```

## Implementation Priority
```
1. [ ] Bezel alignment uniforms (1 day)
2. [ ] Alpha blending pipeline (1 day) 
3. [ ] Translucent cap shader (2 days)
4. [ ] ui_componants port (3 days)
5. [ ] Bloom/glow pass (1 day)
```

## Visual Mockup References
- `/projects/ui_componants/pattern_experiment.mp4`
- Bezel: `bezel-square.png` (exact bounds)
- Target: Frosted glass keys over chassis → infinite depth illusion.

---
*Generated: $(date)*