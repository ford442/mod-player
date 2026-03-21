# Mod-Player Shader Analysis

## Current State

The repo has **49+ shader versions** with a lot of iteration and experimentation. Here's what I found:

### Shape Types Used

1. **Rounded Box/Square** (`sdRoundedBox`) - Primary shape across most versions
2. **Circle** (`sdCircle`) - Function exists but rarely used as main shape
3. **Ellipse** (`sdEllipse`) - Added in v0.49

### Layout Types

| Version | Layout | Description |
|---------|--------|-------------|
| v0.40 | Horizontal Grid | Traditional tracker grid (time=X, channels=Y) |
| v0.25 | Circular Ring | 128-step ring with fixed cell sizes |
| v0.48-49 | Concentric Rings | 64-step radial layout with frosted glass |

### Visual Styles

1. **Frosted Glass Caps** (v0.48+) - Translucent glass with visible LED diode underneath
2. **Simple LED Buttons** (v0.25) - Clean technical look with cyan accents
3. **Hardware Bezel** (bezel.wgsl) - Fullscreen background with recess options

### Key SDF Functions Available

```wgsl
fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32
fn sdCircle(p: vec2<f32>, r: f32) -> f32
fn sdEllipse(p: vec2<f32>, ab: vec2<f32>) -> f32
```

## Recommendation

### Option A: Three Selectable Shaders

1. **Square/Grid Shader** (based on v0.40)
   - Clean horizontal grid layout
   - Rounded box cells
   - Simple, readable

2. **Circle/Ring Shader** (based on v0.48/49)
   - Concentric ring layout
   - Frosted glass aesthetic
   - Radial arrangement

3. **Triangle Shader** (new)
   - Would need to create `sdTriangle` or `sdEquilateralTriangle`
   - Could use triangular grid or radial wedge layout

### Option B: Simplified Approach

Pick **one** shader that supports shape selection via uniform:
- Single shader file
- Uniform controls: `shapeType` (0=square, 1=circle, 2=triangle)
- Same layout, different cell shapes

### Issues to Fix Before Launch

Looking at the latest shaders, potential issues:
1. **v0.49** has UI discard logic that might clip content: `if (in.position.y > uniforms.canvasH * 0.88) { discard; }`
2. Multiple shader files create maintenance burden
3. No clean separation between layout and cell rendering
4. Hardcoded magic numbers everywhere

## Next Steps

1. Decide: 3 separate shaders OR 1 shader with shape selection?
2. Clean up and finalize the chosen approach
3. Add triangle SDF function if needed
4. Test with actual module playback
5. Document the shader API/uniforms
