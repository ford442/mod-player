# Panel SDF Specification - Polar Design

## Design Reference
Access Virus Polar / XASM-1 - Premium synthesizer front panel

## Panel Geometry

### SDF Function
```glsl
float sdPolarPanel(vec3 p, vec2 dimensions, float bevelRadius) {
    // Main panel box
    float d = sdBox(p, vec3(dimensions.x, dimensions.y, 0.05));
    
    // Top bevel (slight angle)
    float topBevel = sdBox(p - vec3(0.0, dimensions.y - 0.005, 0.01), 
                           vec3(dimensions.x, 0.005, 0.02));
    d = smin(d, topBevel, 0.002);
    
    // Side chamfers
    float sideChamferL = sdBox(p - vec3(-dimensions.x + 0.003, 0.0, 0.008),
                               vec3(0.003, dimensions.y, 0.015));
    float sideChamferR = sdBox(p - vec3(dimensions.x - 0.003, 0.0, 0.008),
                               vec3(0.003, dimensions.y, 0.015));
    d = smin(d, min(sideChamferL, sideChamferR), 0.002);
    
    // Bottom lip
    float bottomLip = sdBox(p - vec3(0.0, -dimensions.y + 0.008, 0.015),
                          vec3(dimensions.x, 0.008, 0.01));
    d = smin(d, bottomLip, 0.003);
    
    return d;
}
```

### Dimensions
- **Width**: 0.48 (48cm virtual units)
- **Height**: 0.28 (28cm virtual units)  
- **Thickness**: 0.05 (5mm base + bevels)
- **Aspect Ratio**: 1.71 (widescreen synthesizer format)

### Material Properties
- **Finish**: Satin metallic
- **Primary Color**: Matte white/silver (RGB: 0.92, 0.93, 0.95)
- **Roughness**: 0.25 (satin smooth)
- **Metallic**: 0.85 (high metallic)
- **Clearcoat**: 0.3 (subtle protective layer)

### PBR Parameters
```glsl
vec3 panelBaseColor = vec3(0.92, 0.93, 0.95);
float panelRoughness = 0.25;
float panelMetallic = 0.85;
float panelClearcoat = 0.3;
float panelClearcoatRoughness = 0.15;
```

### Mounting Features
- 4 corner mounting holes (screw heads visible)
- Screw head diameter: 0.006
- Screw head depth: 0.002
- Recessed screw holes with subtle shadow

### Surface Details
- Brushed metal texture (anisotropic reflection)
- Subtle panel divisions (embossed lines)
- Logo/badge area (center-top, recessed)

---

## WGSL Uniform Struct
```wgsl
struct PanelUniforms {
    dimensions: vec2f,      // width, height
    bevelRadius: f32,
    baseColor: vec3f,
    roughness: f32,
    metallic: f32,
};
```

## Raymarching Parameters
- **Max Steps**: 128
- **Epsilon**: 0.001
- **Max Distance**: 2.0
