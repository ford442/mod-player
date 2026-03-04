---
id: panel-spec
name: Panel SDF Specification
parallelizable: true
outputs: specs/{{design_name}}/panel_spec.md
---

Generate SDF mathematics for the main chassis panel only:

**Scope**: Front panel geometry exclusively (no knobs, no rings)
- Material: {{primary_color}} with {{finish}} finish
- Features: Precise bevels, chamfered edges, mounting screws
- Dimensions: Aspect ratio, thickness, curvature

**Output Format**:
```markdown
## Panel Geometry
- SDF: `sdPanel(p, dimensions, bevelRadius)`
- Material: roughness=X, metallic=Y
```

**Variables**: design_name, primary_color, finish
**Output**: specs/{{design_name}}/panel_spec.md
