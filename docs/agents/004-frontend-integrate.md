---
id: frontend-integrate
name: Frontend Integration & Post-Processing
description: Integrates shaders into React app with bloom/FX
role: Frontend Integration Engineer (React/WebGPU)
repository: github.com/ford442/mod-player
---

## Context
You are a coding agent working on the mod-player project at {{repository}}.

## Input Files
- New shader: `src/shaders/{{design_name}}_chassis.wgsl`
- Target component: `src/components/{{target_component}}`
- Post-processor: `src/shaders/bloom_composite.wgsl`

## Task 1: Component Integration
Update `src/components/{{target_component}}`:

### Changes Required
1. **Shader Replacement**:
   - Remove old chassis shader import
   - Import new `{{design_name}}_chassis.wgsl`
   - Update pipeline layout bindings

2. **Uniform Binding**:
   - Connect AudioProcessor output to shader uniforms
   - Ensure audio buffer updates every frame
   - Bind time uniform for animation

3. **Render Loop**:
   - Maintain existing camera controls
   - Add shader hot-reload for development

## Task 2: Post-Processing Enhancement
Update `src/shaders/bloom_composite.wgsl`:

### Bloom Settings
- Threshold: 0.8 (only very bright elements glow)
- Intensity: High on audio peaks (link to audio.amplitude)
- Radius: Medium for soft glow around rings

### Chromatic Aberration
- Effect: Subtle RGB split around glowing elements
- Intensity: 0.5px to 1.0px offset based on emission strength
- Style: Premium lens effect (not broken/distorted)

## Variables
- design_name: "polar"
- target_component: "Studio3D.tsx"
- bloom_intensity: "dynamic"
- chromatic_aberration: "subtle"

## Performance Targets
- 60fps on mid-tier GPUs
- Proper resource cleanup on component unmount
- Efficient uniform buffer updates

## Output Format
Provide as code blocks with file paths:

```typescript
// src/components/Studio3D.tsx
[integration code]
```

```wgsl
// src/shaders/bloom_composite.wgsl
[post-processing modifications]
```
