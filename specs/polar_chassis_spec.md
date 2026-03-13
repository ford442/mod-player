# Unified Chassis Specification - Polar Design
## Access Virus Polar / XASM-1 Audio Player Chassis

---

## 1. Panel Geometry

### SDF Function
```glsl
float sdPolarPanel(vec3 p, vec2 dimensions, float bevelRadius) {
    float d = sdBox(p, vec3(dimensions.x, dimensions.y, 0.05));
    
    // Top bevel
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

### Material
- **Color**: Matte white/silver (0.92, 0.93, 0.95)
- **Roughness**: 0.25
- **Metallic**: 0.85
- **Dimensions**: 0.48 × 0.28 × 0.05

---

## 2. Knob Geometry

### SDF Function
```glsl
float sdPolarKnob(vec3 p, vec3 position, float radius, float height) {
    vec3 localP = p - position;
    float d = sdCappedCylinder(localP, vec2(radius, height * 0.5));
    
    // Top dome
    float dome = sdSphere(localP - vec3(0.0, height * 0.3, 0.0), radius * 1.02);
    d = smin(d, dome - height * 0.2, 0.01);
    
    // Knurling
    float angle = atan(localP.z, localP.x);
    float knurl = sin(angle * 24.0) * 0.002;
    d += knurl * smoothstep(radius * 0.7, radius, length(localP.xz));
    
    // Illuminated ring
    float ringY = height * 0.15;
    float ring = sdTorus(localP - vec3(0.0, ringY, 0.0), 
                         vec2(radius * 1.05, 0.008));
    
    // Shaft hole
    float shaft = sdCylinder(localP + vec3(0.0, height * 0.5, 0.0), 
                             vec2(radius * 0.15, height * 0.1));
    d = max(d, -shaft);
    
    return d;
}
```

### Layout (4 Knobs)
- K1: (-0.12, +0.08, 0.025) - Cutoff
- K2: (+0.12, +0.08, 0.025) - Resonance
- K3: (-0.12, -0.08, 0.025) - Attack
- K4: (+0.12, -0.08, 0.025) - Decay

### Material
- **Color**: Purple metallic (0.4, 0.15, 0.6)
- **Roughness**: 0.3
- **Metallic**: 0.95
- **Emissive Ring**: (0.6, 0.3, 0.9), Intensity: 2.0

---

## 3. Ring Geometry

### SDF Function
```glsl
float sdSegmentedRings(vec3 p, vec3 center, RingData rings) {
    vec3 localP = p - center;
    float d = 1e10;
    
    for (int i = 0; i < 4; i++) {
        float ringRadius = 0.08 + float(i) * 0.035;
        float segmentAngle = 2.0 * PI / 32.0;
        
        float r = length(localP.xz);
        float angle = atan(localP.z, localP.x);
        float segmentIndex = floor(angle / segmentAngle);
        float segmentPhase = fract(angle / segmentAngle);
        
        float gapAngle = segmentAngle * 0.1;
        float inSegment = smoothstep(0.0, 0.02, segmentPhase * segmentAngle - gapAngle * 0.5) 
                        * smoothstep(segmentAngle, segmentAngle - 0.02, segmentPhase * segmentAngle + gapAngle * 0.5);
        
        float thickness = 0.008 - float(i) * 0.001;
        float ringDist = abs(r - ringRadius);
        float ringSdf = sqrt(ringDist * ringDist + localP.y * localP.y) - thickness;
        ringSdf = max(ringSdf, -inSegment * 0.001);
        d = min(d, ringSdf);
        
        if (ringSdf < 0.001) {
            rings.activeRing = i;
            rings.activeSegment = int(segmentIndex);
        }
    }
    
    return d;
}
```

### Configuration
| Ring | Radius | Thickness |
|------|--------|-----------|
| 1 | 0.08 | 0.008 |
| 2 | 0.115 | 0.007 |
| 3 | 0.15 | 0.006 |
| 4 | 0.185 | 0.005 |

### Material
- **Color**: Cyan/blue (0.2, 0.7, 0.9)
- **Emissive**: (0.4, 0.85, 1.0), Intensity: 3.0
- **Translucency**: 0.3

---

## 4. Unified Uniform Struct

```wgsl
struct ChassisUniforms {
    // Panel
    panelDimensions: vec2f,
    panelColor: vec3f,
    panelRoughness: f32,
    panelMetallic: f32,
    
    // Knobs (4x)
    knobPositions: array<vec3f, 4>,
    knobColor: vec3f,
    knobRingColor: vec3f,
    knobRingIntensity: f32,
    
    // Rings
    ringCenter: vec3f,
    ringRadii: vec4f,
    ringColor: vec3f,
    ringEmissive: vec3f,
    ringIntensity: f32,
};

struct AudioUniforms {
    frequencies: vec4f,  // bass, lowMid, highMid, treble
    amplitude: f32,
    time: f32,
    beat: f32,
};
```

---

## 5. PBR Lighting Model

### Environment
- HDRI environment map (studio lighting)
- Ambient occlusion from raymarching steps
- Reflection probes for metallic surfaces

### Materials Summary
| Component | Base Color | Rough | Metal | Emit |
|-----------|------------|-------|-------|------|
| Panel | 0.92, 0.93, 0.95 | 0.25 | 0.85 | 0 |
| Knobs | 0.4, 0.15, 0.6 | 0.30 | 0.95 | 0 |
| Knob Rings | 0.6, 0.3, 0.9 | 0.50 | 0 | 2.0 |
| Rings | 0.2, 0.7, 0.9 | 0.40 | 0 | 3.0 |

---

## 6. Technical Specifications

### Raymarching
- **Max Steps**: 256
- **Epsilon**: 0.0003
- **Max Distance**: 2.0
- **Shadow Steps**: 64

### Performance
- Early-out for distant geometry
- LOD: Simplify rings at distance > 1.0
- Precompute knob positions in vertex shader
