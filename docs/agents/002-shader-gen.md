---
id: shader-static
name: Static WGSL Shader Generator
description: Implements SDF specifications as WebGPU shaders
role: WGSL Shader Engineer (Raymarching/SDF Specialist)
repository: github.com/ford442/mod-player
---

## Context
You are a coding agent working on the mod-player project at {{repository}}.

## Input Files
- Specification: `specs/{{design_name}}_chassis_spec.md`
- Reference: `src/shaders/chassis_frosted.wgsl` or `src/shaders/chassisv0.40.wgsl`

## Task
Write a new shader file `src/shaders/{{design_name}}_chassis.wgsl` implementing:

### 1. Static Geometry
- Implement all SDF functions from the specification
- High-quality raymarching ({{quality_preset}} preset)
- Precise panel geometry with beveled edges
- Four knobs with metallic materials
- Central concentric segmented rings (static emissive)

### 2. PBR Lighting
- Satin metallic materials
- Sharp reflections (environment mapping)
- Clean, high-tech aesthetic
- Proper normal calculations for curved surfaces

### 3. Uniform Bindings
```wgsl
@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<uniform> audio: AudioUniforms;
@group(0) @binding(2) var<uniform> time: TimeUniforms;
```

## Variables
- design_name: "polar"
- quality_preset: "high" (options: performance, high, ultra)
- reference_shader: "chassis_frosted.wgsl"

## Constraints
- WebGPU/WGSL compatible only
- Static geometry (no audio reactivity yet)
- Import utility functions from reference shader if compatible
- 60fps performance target

## Output
- Save to: src/shaders/{{design_name}}_chassis.wgsl
- Output format: Complete WGSL source code only
