---
id: merge-specs
name: Specification Merger
parallelizable: false
dependencies: [001a, 001b, 001c]
inputs:
  - specs/{{design_name}}/panel_spec.md
  - specs/{{design_name}}/knobs_spec.md
  - specs/{{design_name}}/rings_spec.md
outputs: specs/{{design_name}}_chassis_spec.md
---

Merge the three component specifications into a unified specification:

**Task**:
1. Read all three input spec files
2. Combine into single markdown document with sections:
   - Panel Geometry (from panel_spec)
   - Knob Geometry (from knobs_spec)
   - Ring Geometry (from rings_spec)
   - Unified Uniform Structs
   - PBR Lighting Model (global settings)
3. Resolve any coordinate system conflicts
4. Ensure consistent naming conventions

**Output**: Complete `specs/{{design_name}}_chassis_spec.md` ready for shader generation
