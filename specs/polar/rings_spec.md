# Rings SDF Specification - Polar Design

## Design Reference
Access Virus Polar XASM-1 - Central concentric ring array with segmented glowing elements

## Ring Geometry

### SDF Function
```glsl
// Main segmented rings function
float sdSegmentedRings(vec3 p, vec3 center, RingData rings) {
    vec3 localP = p - center;
    float d = 1e10;
    
    // 4 concentric rings
    for (int i = 0; i < 4; i++) {
        float ringRadius = 0.08 + float(i) * 0.035; // 0.08, 0.115, 0.15, 0.185
        float segmentAngle = 2.0 * PI / 32.0; // 32 segments per ring
        
        // Polar coordinates
        float r = length(localP.xz);
        float angle = atan(localP.z, localP.x);
        
        // Current segment index
        float segmentIndex = floor(angle / segmentAngle);
        float segmentPhase = fract(angle / segmentAngle);
        
        // Segment gap (small spacing between segments)
        float gapAngle = segmentAngle * 0.1;
        float inSegment = smoothstep(0.0, 0.02, segmentPhase * segmentAngle - gapAngle * 0.5) 
                        * smoothstep(segmentAngle, segmentAngle - 0.02, segmentPhase * segmentAngle + gapAngle * 0.5);
        
        // Ring thickness
        float thickness = 0.008 - float(i) * 0.001; // Slightly thinner outer rings
        
        // Distance to ring torus
        float ringDist = abs(r - ringRadius);
        float ringSdf = sqrt(ringDist * ringDist + localP.y * localP.y) - thickness;
        
        // Apply segment masking (gap between segments)
        ringSdf = max(ringSdf, -inSegment * 0.001);
        
        // Add to overall distance (union of all rings)
        d = min(d, ringSdf);
        
        // Store segment index for audio reactivity (passed to material)
        if (ringSdf < 0.001) {
            rings.activeRing = i;
            rings.activeSegment = int(segmentIndex);
        }
    }
    
    return d;
}

struct RingData {
    int activeRing;
    int activeSegment;
    float segmentIntensity[4][32]; // Per-segment intensity for animation
};
```

### Ring Configuration
```
Ring Layout (Top-Down View):

        ╭──────────────╮
       ╱   ╭──────╮     ╲    <- Ring 4 (outer)
      │   ╱  ╭──╮  ╲      │      32 segments
      │  │  ╱    ╲  │     │      Radius: 0.185
      │  │ │  ██  │ │     │      Thickness: 0.005
      │  │ │  ██  │ │     │
      │  │  ╲    ╱  │     │   <- Ring 3
      │   ╲  ╰──╯  ╱      │      32 segments  
       ╲    ╰────╯       ╱       Radius: 0.15
        ╰──────────────╯         Thickness: 0.006
                                  
          ╭────────╮            <- Ring 2
         ╱  ╭──╮    ╲              32 segments
        │  ╱    ╲    │             Radius: 0.115
        │ │  ██  │   │             Thickness: 0.007
        │  ╲    ╱    │
         ╲  ╰──╯    ╱          <- Ring 1 (inner)
          ╰────────╯               32 segments
                                   Radius: 0.08
                                   Thickness: 0.008
```

### Dimensions
| Ring | Radius | Thickness | Segments | Segment Arc |
|------|--------|-----------|----------|-------------|
| 1 (inner) | 0.08 | 0.008 | 32 | 11.25° |
| 2 | 0.115 | 0.007 | 32 | 11.25° |
| 3 | 0.15 | 0.006 | 32 | 11.25° |
| 4 (outer) | 0.185 | 0.005 | 32 | 11.25° |

- **Vertical Position**: Centered at panel center (z=0.03 above panel surface)
- **Gap Between Segments**: 10% of arc length
- **Segment Height**: 0.01 (protruding slightly from panel)

### Material Properties
- **Material**: Translucent glowing polycarbonate
- **Base Color**: Cyan/blue (RGB: 0.2, 0.7, 0.9)
- **Emissive**: Strong emissive glow
- **Translucency**: 0.3 (light passes through)
- **Refraction**: 1.4 (plastic-like)

### PBR Parameters
```glsl
vec3 ringBaseColor = vec3(0.2, 0.7, 0.9);      // Cyan-blue
vec3 ringEmissive = vec3(0.4, 0.85, 1.0);      // Brighter cyan glow
float ringEmissiveIntensity = 3.0;              // Base brightness
float ringTranslucency = 0.3;
float ringRoughness = 0.4;                      // Slight diffusion
float ringIOR = 1.4;                           // Plastic refraction
```

---

## WGSL Uniform Struct
```wgsl
struct RingUniforms {
    center: vec3f,
    ringCount: u32,           // 4
    segmentCount: u32,        // 32
    // Per-ring parameters
    ringRadii: vec4f,         // [0.08, 0.115, 0.15, 0.185]
    ringThicknesses: vec4f,   // [0.008, 0.007, 0.006, 0.005]
    // Audio reactivity
    segmentIntensity: array<f32, 128>, // 4 rings * 32 segments
    globalIntensity: f32,
};
```

## Audio Reactivity Mapping

### Frequency Bands → Rings
| Frequency | Target Ring | Effect |
|-----------|-------------|--------|
| Bass (20-150Hz) | Ring 1 (inner) | Intensity boost, warmth shift |
| Low-Mid (150-500Hz) | Ring 2 | Color shift toward purple |
| High-Mid (500Hz-2kHz) | Ring 3 | Segment pulsing, wave effect |
| Treble (2kHz+) | Ring 4 (outer) | Rapid shimmer, brightness |

### Animation Parameters
- **Base Emission**: 3.0
- **Max Emission**: 6.0 (2x boost on peaks)
- **Pulsing Phase**: Offset by ring index (wave travels outward)
- **Color Shift**: Cyan (low) → Purple (high)
- **Smoothing**: 0.1s attack, 0.3s decay

### Segment Addressing
```glsl
// Calculate segment index for animation
fn getSegmentIndex(ringIndex: u32, segmentIndex: u32) -> u32 {
    return ringIndex * 32u + segmentIndex;
}

// Update intensity (called per frame with audio data)
fn updateSegmentIntensity(ring: u32, segment: u32, intensity: f32) {
    let idx = getSegmentIndex(ring, segment);
    ringUniforms.segmentIntensity[idx] = intensity;
}
```

---

## Raymarching Parameters
- **Max Steps**: 256 (complex geometry)
- **Epsilon**: 0.0003
- **Glow Falloff**: Distance-based emissive attenuation
- **Subsurface**: Approximate translucency in shading

## Performance Notes
- Use early-out for distant rings
- Precompute segment intensities in vertex shader if possible
- Consider LOD: simplify to solid rings when far away
