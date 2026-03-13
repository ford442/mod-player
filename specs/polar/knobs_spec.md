# Knobs SDF Specification - Polar Design

## Design Reference
Access Virus Polar - Modern minimalist control knobs

## Knob Geometry

### SDF Function
```glsl
float sdPolarKnob(vec3 p, vec3 position, float radius, float height) {
    vec3 localP = p - position;
    
    // Main cylindrical body
    float d = sdCappedCylinder(localP, vec2(radius, height * 0.5));
    
    // Top dome (slight convex curve)
    float dome = sdSphere(localP - vec3(0.0, height * 0.3, 0.0), radius * 1.02);
    d = smin(d, dome - height * 0.2, 0.01);
    
    // Knurling/grip texture (subtle ridges)
    float angle = atan(localP.z, localP.x);
    float knurl = sin(angle * 24.0) * 0.002; // 24 ridges
    d += knurl * smoothstep(radius * 0.7, radius, length(localP.xz));
    
    // Illuminated ring (emissive band near top)
    float ringY = height * 0.15;
    float ringDist = abs(localP.y - ringY);
    float ringRadius = radius * 1.05;
    float ring = sdTorus(localP - vec3(0.0, ringY, 0.0), 
                         vec2(ringRadius, 0.008));
    
    // Shaft hole (bottom center)
    float shaft = sdCylinder(localP + vec3(0.0, height * 0.5, 0.0), 
                             vec2(radius * 0.15, height * 0.1));
    d = max(d, -shaft);
    
    return d;
}

// Distance to torus for illuminated ring
float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}
```

### Layout (4 Knobs)
```
Panel Top-Down View:

    [K1]      [K2]
       
    [K3]      [K4]

Positions (relative to panel center):
- K1: (-0.12, +0.08, 0.025)  // Cutoff
- K2: (+0.12, +0.08, 0.025)  // Resonance
- K3: (-0.12, -0.08, 0.025)  // Attack
- K4: (+0.12, -0.08, 0.025)  // Decay
```

### Dimensions
- **Radius**: 0.025 (2.5cm knobs)
- **Height**: 0.035 (3.5cm tall)
- **Ring Width**: 0.008
- **Ring Offset**: 0.015 from top

### Material Properties
- **Finish**: Purple metallic (anodized aluminum look)
- **Base Color**: RGB(0.4, 0.15, 0.6)
- **Roughness**: 0.3 (slightly brushed)
- **Metallic**: 0.95
- **Anisotropy**: 0.2 (subtle brushed texture)

### Emissive Ring Parameters
```glsl
vec3 ringEmissiveColor = vec3(0.6, 0.3, 0.9); // Purple glow
float ringEmissiveIntensity = 2.0; // Base brightness
float ringEmissiveFalloff = 0.5;   // Edge softness
```

### PBR Parameters
```glsl
vec3 knobBaseColor = vec3(0.4, 0.15, 0.6);
float knobRoughness = 0.3;
float knobMetallic = 0.95;
float knobAnisotropy = 0.2;

// Emissive ring (uniform for audio reactivity)
vec3 ringBaseColor = vec3(0.6, 0.3, 0.9);
float ringIntensity = 2.0;
```

---

## WGSL Uniform Struct
```wgsl
struct KnobUniforms {
    positions: array<vec3f, 4>,  // 4 knob positions
    radius: f32,
    height: f32,
    baseColor: vec3f,
    roughness: f32,
    metallic: f32,
    // Emissive ring
    ringColor: vec3f,
    ringIntensity: f32,
};
```

## Audio Reactivity Mapping
- **Bass frequencies**: Ring intensity boost (2.0x → 4.0x)
- **Overall amplitude**: Subtle knob glow pulse
- **Beat detection**: Ring flash on strong beats

## Raymarching Parameters
- **Max Steps**: 64 per knob
- **Epsilon**: 0.0005
- **Shadow Softness**: 0.02
