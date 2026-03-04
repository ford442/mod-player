---
id: knobs-spec
name: Knobs SDF Specification  
parallelizable: true
outputs: specs/{{design_name}}/knobs_spec.md
---

Generate SDF mathematics for the control knobs only:

**Scope**: Four knobs (no panel, no rings)
- Material: {{accent_color}} metallic
- Features: Illuminated rings, knurling/grip texture, shaft holes
- Layout: Positions relative to panel center

**Output Format**:
```markdown
## Knob Geometry
- SDF: `sdKnob(p, position, radius, height)`
- Emissive: Ring glow parameters
```

**Variables**: design_name, accent_color
**Output**: specs/{{design_name}}/knobs_spec.md
