# Kimi Agent Tasks for mod-player

Reusable AI agent tasks for generating audio-reactive 3D chassis shaders.

## Quick Start

```bash
# Run full pipeline for new design
kimi pipeline run .kimi/config/chassis-pipeline.yaml --var design_name=cyberpunk --var aesthetic_reference="Cyberpunk 2077"

# Or run individual stages
kimi task run .kimi/tasks/001-sdf-spec.md --var design_name=retro
kimi task run .kimi/tasks/002-shader-gen.md --var design_name=retro
```

## File Structure

- `tasks/001-sdf-spec.md` - Generates mathematical specifications
- `tasks/002-shader-gen.md` - Creates static WGSL shaders
- `tasks/003-audio-reactive.md` - Adds audio reactivity
- `tasks/004-frontend-integrate.md` - Integrates into React/Three.js
- `config/chassis-pipeline.yaml` - Orchestrates full pipeline

## Variables

All tasks accept these variables:

| Variable | Default | Description |
|----------|---------|-------------|
| design_name | required | Identifier for the design (e.g., "polar", "cyber") |
| aesthetic_reference | "Access Virus Polar" | Visual style reference |
| primary_color | "white/silver" | Main chassis color |
| accent_color | "purple" | Knob/accent color |
| emissive_color | "cyan" | LED/Ring glow color |
| quality_preset | "high" | Raymarching quality |
| target_component | "Studio3D.tsx" | React component to modify |

## Examples

### Virus Polar Style

```bash
kimi task run .kimi/tasks/001-sdf-spec.md \
  --var design_name=polar \
  --var aesthetic_reference="Access Virus Polar"
```

### Cyberpunk Style

```bash
kimi task run .kimi/tasks/001-sdf-spec.md \
  --var design_name=cyber \
  --var aesthetic_reference="Cyberpunk 2077" \
  --var primary_color="matte black" \
  --var accent_color="neon orange" \
  --var emissive_color="hot pink"
```

### Parallel Swarm (Multiple Designs)

Run multiple designs simultaneously in separate terminals:

```bash
# Terminal 1
kimi pipeline run .kimi/config/chassis-pipeline.yaml --var design_name=polar

# Terminal 2  
kimi pipeline run .kimi/config/chassis-pipeline.yaml --var design_name=cyber

# Terminal 3
kimi pipeline run .kimi/config/chassis-pipeline.yaml --var design_name=brutalist
```
