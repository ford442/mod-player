---
id: rings-spec
name: Rings SDF Specification
parallelizable: true
outputs: specs/{{design_name}}/rings_spec.md
---

Generate SDF mathematics for the central concentric rings only:

**Scope**: Segmented ring array (no panel, no knobs)
- Material: Translucent glowing segments
- Features: {{ring_count}} concentric rings, {{segment_count}} rectangular segments per ring
- Animation prep: Segment indexing for audio reactivity

**Output Format**:
```markdown
## Ring Geometry
- SDF: `sdSegmentedRings(p, center, ringData)`
- Emissive: Base color {{emissive_color}}, intensity ranges
```

**Variables**: design_name, emissive_color, ring_count=4, segment_count=32
**Output**: specs/{{design_name}}/rings_spec.md
