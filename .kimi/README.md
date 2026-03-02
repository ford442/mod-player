# Kimi Task System - Chassis Generation Pipeline

This directory contains task definitions for generating audio-reactive 3D chassis shaders for the mod-player project.

## Directory Structure

```
.kimi/
├── tasks/           # Task definition YAML files
├── templates/       # Pipeline templates and schemas
└── README.md        # This file
```

## Tasks

### 001-sdf-spec.yaml
**SDF Specification Generator** - Creates mathematical specifications for chassis designs
- Inputs: Design name, aesthetic reference, material palette
- Outputs: `specs/{design_name}_chassis_spec.md`

### 002-shader-gen.yaml
**Static WGSL Shader Generator** - Implements SDF specs as WebGPU shaders
- Inputs: SDF specification, base shader reference
- Outputs: `src/shaders/{design_name}_chassis.wgsl`

### 003-audio-reactive.yaml
**Audio Reactivity Injector** - Adds frequency-reactive animations
- Inputs: Static shader, audio mapping configuration
- Outputs: Updated `src/shaders/{design_name}_chassis.wgsl`

### 004-frontend-integrate.yaml
**Frontend Integration** - Integrates shaders into React app with post-processing
- Inputs: Shader, target component, post-effects config
- Outputs: Updated component and bloom composite shader

## Usage Examples

### Quick Start (Virus Polar Style)

```bash
# Run the pipeline with variables
kimi task run 001-sdf-spec \
  --var design_name=polar \
  --var aesthetic_reference="Access Virus Polar / XASM-1" \
  --var "accent_color=purple metallic"

kimi task run 002-shader-gen --var design_name=polar
kimi task run 003-audio-reactive --var design_name=polar
kimi task run 004-frontend-integrate --var design_name=polar
```

### Custom Design (Cyberpunk)

```bash
kimi task run 001-sdf-spec \
  --var design_name=cyberdeck \
  --var aesthetic_reference="Cyberpunk 2077 / Deckard's Piano" \
  --var "primary_color=matte black carbon fiber" \
  --var "accent_color=neon orange" \
  --var "emissive_color=amber/red"

kimi task run 002-shader-gen --var design_name=cyberdeck --var quality_preset=ultra
kimi task run 003-audio-reactive --var design_name=cyberdeck --var animation_style=punchy
kimi task run 004-frontend-integrate --var design_name=cyberdeck
```

## Automation Script

Add this to `scripts/generate-chassis.sh`:

```bash
#!/bin/bash
DESIGN_NAME=$1
AESTHETIC=$2

if [ -z "$DESIGN_NAME" ]; then
    echo "Usage: ./scripts/generate-chassis.sh <design-name> <aesthetic-reference>"
    echo "Example: ./scripts/generate-chassis.sh polar 'Access Virus Polar'"
    exit 1
fi

echo "🎨 Generating chassis pipeline for: $DESIGN_NAME"

kimi task run .kimi/tasks/001-sdf-spec.yaml --var design_name=$DESIGN_NAME --var aesthetic_reference="$AESTHETIC"
kimi task run .kimi/tasks/002-shader-gen.yaml --var design_name=$DESIGN_NAME
kimi task run .kimi/tasks/003-audio-reactive.yaml --var design_name=$DESIGN_NAME
kimi task run .kimi/tasks/004-frontend-integrate.yaml --var design_name=$DESIGN_NAME

echo "✅ Complete! Check src/shaders/${DESIGN_NAME}_chassis.wgsl"
```

## Design Variables

| Variable | Type | Description | Default |
|----------|------|-------------|---------|
| `design_name` | string | Kebab-case identifier | `new-design` |
| `aesthetic_reference` | string | Visual style reference | `Access Virus Polar` |
| `material_palette` | object | Colors and finishes | See task 001 |
| `quality_preset` | enum | Rendering quality | `high` |
| `animation_style` | enum | Audio reactivity style | `smooth` |

## Pipeline Flow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  001-sdf    │───→│  002-shader │───→│  003-audio  │───→│  004-front  │
│   -spec     │    │   -static   │    │  -reactive  │    │  -integrate │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
      │                   │                   │                   │
      ▼                   ▼                   ▼                   ▼
specs/{name}.md   shaders/{name}.wgsl  shaders/{name}.wgsl  Studio3D.tsx
```

This system lets you iterate rapidly: change the `aesthetic_reference` and `material_palette` variables to generate entirely new chassis designs (Retro 80s, Soviet Brutalist, H.R. Giger, etc.) using the same proven pipeline structure.
