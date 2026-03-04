---
id: sdf-spec
name: SDF Specification Generator
description: Creates mathematical SDF specifications for audio player chassis
role: Technical Specification Agent (Industrial Design/Shaders)
repository: github.com/ford442/mod-player
---

## Context
You are a coding agent working on the mod-player project at {{repository}}.

## Task
Create a Markdown file named '{{design_name}}_chassis_spec.md' in the `specs/` directory containing:

### 1. SDF (Signed Distance Field) Mathematics
- **Main Panel**: Sleek matte {{primary_color}} front panel with precise bevels and chamfers
- **Knobs**: Four modern minimalist knobs ({{accent_color}} metallic finish with illuminated rings)
- **Central Rings**: Large concentric ring array composed of small glowing translucent rectangular segments (exactly like XASM-1/Access Virus Polar style)

### 2. Material Definitions
- Finish: {{finish}}
- Reflections: Sharp, high-end PBR
- Emissive: Strong emissive properties for ring segments ({{emissive_color}})

### 3. Uniform Structures
Define WGSL-compatible uniform structs for:
```wgsl
struct AudioUniforms {
    frequencies: vec4f,  // bass, lowMid, highMid, treble
    amplitude: f32,
    time: f32,
    beat: f32
};
```

### 4. Technical Specs
- Raymarching step counts and epsilon values
- Material roughness/metallic values
- Emissive intensity ranges (static baseline values)

## Variables
- design_name: "polar" (kebab-case identifier)
- aesthetic_reference: "Access Virus Polar / XASM-1"
- primary_color: "white/silver"
- accent_color: "purple"
- emissive_color: "cyan/blue"
- finish: "satin metallic"

## Output
- Save to: specs/{{design_name}}_chassis_spec.md
- Output format: Complete markdown specification only
