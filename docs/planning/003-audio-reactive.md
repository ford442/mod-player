---
id: shader-audio
name: Audio Reactivity Injector
description: Adds frequency-reactive animations to static shaders
role: Audio-Reactive Shader Engineer
repository: github.com/ford442/mod-player
---

## Context
You are a coding agent working on the mod-player project at {{repository}}.

## Input File
- Base shader: `src/shaders/{{design_name}}_chassis.wgsl`

## Task
Update `src/shaders/{{design_name}}_chassis.wgsl` to incorporate audio reactivity.

### Audio Mapping
- **Bass** (frequencies.x): Outer rings → emission intensity boost
- **LowMid** (frequencies.y): Middle rings → color shift toward warm
- **HighMid** (frequencies.z): Inner rings → segment pulsing
- **Treble** (frequencies.w): Center element → rapid flicker/brightness

### Reactivity Parameters
- Emission range: 0.5x (quiet) to 2.0x (loud) base intensity
- Color shift: {{low_energy_color}} (low) → {{high_energy_color}} (high)
- Pulsing: Phase offset by ring index for wave effect
- Smoothing: {{animation_style}} interpolation (avoid chaotic flickering)

### Uniform Usage
```wgsl
// Already defined in base shader, now implement usage:
// audio.frequencies, audio.amplitude, audio.time, audio.beat
```

## Variables
- design_name: "polar"
- low_energy_color: "cool blue #0088ff"
- high_energy_color: "vibrant cyan/purple #aa00ff"
- animation_style: "smooth" (options: smooth, punchy, ambient)

## Constraints
- Preserve all static geometry and materials from base shader
- Maintain premium Virus Polar aesthetic (clean, not chaotic)
- Use existing uniform structs (do not redefine)
- Smooth musical reactivity (no strobe effects)

## Output
- Save to: src/shaders/{{design_name}}_chassis.wgsl (overwrite)
- Output format: Complete updated WGSL source code only
