// Polar Chassis Shader - Access Virus Polar Style
// SDF Raymarching Audio Player Chassis
// Generated for mod-player project

// ============================================================================
// CONSTANTS
// ============================================================================
const PI: f32 = 3.14159265359;
const MAX_STEPS: i32 = 256;
const MAX_DIST: f32 = 2.0;
const EPSILON: f32 = 0.0003;
const SHADOW_EPSILON: f32 = 0.001;

// ============================================================================
// UNIFORMS
// ============================================================================
struct CameraUniforms {
    viewMatrix: mat4x4<f32>,
    projMatrix: mat4x4<f32>,
    cameraPos: vec3<f32>,
    time: f32,
};

struct ChassisUniforms {
    // Panel
    panelDimensions: vec2<f32>,
    panelColor: vec3<f32>,
    panelRoughness: f32,
    panelMetallic: f32,
    
    // Knobs
    knobPositions: array<vec3<f32>, 4>,
    knobColor: vec3<f32>,
    knobRingColor: vec3<f32>,
    knobRingIntensity: f32,
    
    // Rings
    ringCenter: vec3<f32>,
    ringRadii: vec4<f32>,      // [0.08, 0.115, 0.15, 0.185]
    ringThicknesses: vec4<f32>, // [0.008, 0.007, 0.006, 0.005]
    ringColor: vec3<f32>,
    ringEmissive: vec3<f32>,
    ringIntensity: f32,
};

struct AudioUniforms {
    frequencies: vec4<f32>,  // bass, lowMid, highMid, treble
    amplitude: f32,
    time: f32,
    beat: f32,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<uniform> chassis: ChassisUniforms;
@group(0) @binding(2) var<uniform> audio: AudioUniforms;

// ============================================================================
// SDF PRIMITIVES
// ============================================================================
fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdSphere(p: vec3<f32>, r: f32) -> f32 {
    return length(p) - r;
}

fn sdCappedCylinder(p: vec3<f32>, h: vec2<f32>) -> f32 {
    let d = abs(vec2<f32>(length(p.xz), p.y)) - h;
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0)));
}

fn sdCylinder(p: vec3<f32>, h: vec2<f32>) -> f32 {
    return length(p.xz) - h.x;
}

fn sdTorus(p: vec3<f32>, t: vec2<f32>) -> f32 {
    let q = vec2<f32>(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

fn smin3(a: f32, b: f32, c: f32, k: f32) -> f32 {
    return smin(smin(a, b, k), c, k);
}

// ============================================================================
// PANEL SDF
// ============================================================================
fn sdPanel(p: vec3<f32>) -> f32 {
    let dim = vec3<f32>(chassis.panelDimensions.x, chassis.panelDimensions.y, 0.05);
    var d = sdBox(p, dim);
    
    // Top bevel
    let topBevel = sdBox(p - vec3<f32>(0.0, dim.y - 0.005, 0.01), 
                         vec3<f32>(dim.x, 0.005, 0.02));
    d = smin(d, topBevel, 0.002);
    
    // Side chamfers
    let sideChamferL = sdBox(p - vec3<f32>(-dim.x + 0.003, 0.0, 0.008),
                             vec3<f32>(0.003, dim.y, 0.015));
    let sideChamferR = sdBox(p - vec3<f32>(dim.x - 0.003, 0.0, 0.008),
                             vec3<f32>(0.003, dim.y, 0.015));
    d = smin(d, min(sideChamferL, sideChamferR), 0.002);
    
    // Bottom lip
    let bottomLip = sdBox(p - vec3<f32>(0.0, -dim.y + 0.008, 0.015),
                          vec3<f32>(dim.x, 0.008, 0.01));
    d = smin(d, bottomLip, 0.003);
    
    return d;
}

// ============================================================================
// KNOB SDF
// ============================================================================
fn sdKnob(p: vec3<f32>, position: vec3<f32>, radius: f32, height: f32) -> f32 {
    let localP = p - position;
    var d = sdCappedCylinder(localP, vec2<f32>(radius, height * 0.5));
    
    // Top dome
    let dome = sdSphere(localP - vec3<f32>(0.0, height * 0.3, 0.0), radius * 1.02);
    d = smin(d, dome - height * 0.2, 0.01);
    
    // Knurling texture
    let angle = atan2(localP.z, localP.x);
    let knurl = sin(angle * 24.0) * 0.002;
    let knurlMask = smoothstep(radius * 0.7, radius, length(localP.xz));
    d += knurl * knurlMask;
    
    // Shaft hole
    let shaft = sdCylinder(localP + vec3<f32>(0.0, height * 0.5, 0.0), 
                           vec2<f32>(radius * 0.15, height * 0.1));
    d = max(d, -shaft);
    
    return d;
}

// Knob illuminated ring (separate for emissive)
fn sdKnobRing(p: vec3<f32>, position: vec3<f32>, radius: f32, height: f32) -> f32 {
    let localP = p - position;
    let ringY = height * 0.15;
    return sdTorus(localP - vec3<f32>(0.0, ringY, 0.0), 
                   vec2<f32>(radius * 1.05, 0.008));
}

fn sdAllKnobs(p: vec3<f32>) -> f32 {
    let radius = 0.025;
    let height = 0.035;
    
    var d = sdKnob(p, chassis.knobPositions[0], radius, height);
    d = min(d, sdKnob(p, chassis.knobPositions[1], radius, height));
    d = min(d, sdKnob(p, chassis.knobPositions[2], radius, height));
    d = min(d, sdKnob(p, chassis.knobPositions[3], radius, height));
    
    return d;
}

// ============================================================================
// RINGS SDF
// ============================================================================
fn sdSegmentedRings(p: vec3<f32>) -> f32 {
    let localP = p - chassis.ringCenter;
    var d = 1e10;
    
    for (var i: i32 = 0; i < 4; i = i + 1) {
        let ringRadius = chassis.ringRadii[i];
        let thickness = chassis.ringThicknesses[i];
        let segmentAngle = 2.0 * PI / 32.0;
        
        let r = length(localP.xz);
        let angle = atan2(localP.z, localP.x);
        let segmentPhase = fract(angle / segmentAngle);
        
        let gapAngle = segmentAngle * 0.1;
        let inSegment = smoothstep(0.0, 0.02, segmentPhase * segmentAngle - gapAngle * 0.5) 
                      * smoothstep(segmentAngle, segmentAngle - 0.02, segmentPhase * segmentAngle + gapAngle * 0.5);
        
        let ringDist = abs(r - ringRadius);
        var ringSdf = sqrt(ringDist * ringDist + localP.y * localP.y) - thickness;
        ringSdf = max(ringSdf, -inSegment * 0.001);
        
        d = min(d, ringSdf);
    }
    
    return d;
}

// ============================================================================
// SCENE SDF
// ============================================================================
struct Material {
    albedo: vec3<f32>,
    roughness: f32,
    metallic: f32,
    emissive: vec3<f32>,
};

// Audio-reactive helper functions
fn getRingAudioIntensity(ringIndex: i32) -> f32 {
    // Map frequency bands to rings
    // Ring 1 (inner): Bass
    // Ring 2: Low-mid
    // Ring 3: High-mid
    // Ring 4 (outer): Treble
    switch ringIndex {
        case 0: { return audio.frequencies.x; } // Bass
        case 1: { return audio.frequencies.y; } // Low-mid
        case 2: { return audio.frequencies.z; } // High-mid
        case 3: { return audio.frequencies.w; } // Treble
        default: { return 0.0; }
    }
}

fn lerpColor(a: vec3<f32>, b: vec3<f32>, t: f32) -> vec3<f32> {
    return a + (b - a) * clamp(t, 0.0, 1.0);
}

fn getMaterial(pos: vec3<f32>, objId: i32) -> Material {
    var mat: Material;
    
    // Audio-reactive parameters
    let bassPulse = audio.frequencies.x * 0.5 + 0.5; // 0.5 to 1.0
    let overallAmp = audio.amplitude;
    let beatPulse = audio.beat;
    
    switch objId {
        case 0: { // Panel
            mat.albedo = chassis.panelColor;
            mat.roughness = chassis.panelRoughness;
            mat.metallic = chassis.panelMetallic;
            mat.emissive = vec3<f32>(0.0);
        }
        case 1: { // Knobs
            mat.albedo = chassis.knobColor;
            mat.roughness = 0.3;
            mat.metallic = 0.95;
            // Subtle knob glow on high amplitude
            let knobGlow = overallAmp * 0.1;
            mat.emissive = chassis.knobRingColor * knobGlow;
        }
        case 2: { // Knob rings
            mat.albedo = vec3<f32>(0.0);
            mat.roughness = 0.5;
            mat.metallic = 0.0;
            // Audio-reactive ring intensity: 2.0 base → 4.0 on bass peaks
            let baseIntensity = chassis.knobRingIntensity;
            let boost = audio.frequencies.x * 2.0; // Bass boost
            let beatFlash = audio.beat * 1.0; // Beat flash
            let intensity = baseIntensity + boost + beatFlash;
            mat.emissive = chassis.knobRingColor * intensity;
        }
        case 3: { // Central rings
            // Determine which ring this is based on distance from center
            let localP = pos - chassis.ringCenter;
            let r = length(localP.xz);
            var ringIdx: i32 = 0;
            if (r > 0.1) { ringIdx = 1; }
            if (r > 0.13) { ringIdx = 2; }
            if (r > 0.165) { ringIdx = 3; }
            
            let freqIntensity = getRingAudioIntensity(ringIdx);
            
            // Base emission: 3.0 → Max: 6.0 on peaks
            let baseEmit = chassis.ringIntensity;
            let maxEmit = baseEmit * 2.0;
            let emitIntensity = mix(baseEmit, maxEmit, freqIntensity);
            
            // Color shift based on energy
            // Low energy: Cyan (0.2, 0.7, 0.9)
            // High energy: Purple (0.6, 0.3, 0.9)
            let lowEnergy = chassis.ringEmissive;
            let highEnergy = vec3<f32>(0.6, 0.3, 0.9);
            let emitColor = lerpColor(lowEnergy, highEnergy, freqIntensity);
            
            // Pulsing phase by ring index (wave effect)
            let timePhase = audio.time * 2.0 + f32(ringIdx) * 0.5;
            let pulse = sin(timePhase) * 0.1 + 0.9; // 0.8 to 1.0
            
            mat.albedo = chassis.ringColor;
            mat.roughness = 0.4;
            mat.metallic = 0.0;
            mat.emissive = emitColor * emitIntensity * pulse;
        }
        default: {
            mat.albedo = vec3<f32>(0.5);
            mat.roughness = 0.5;
            mat.metallic = 0.0;
            mat.emissive = vec3<f32>(0.0);
        }
    }
    
    return mat;
}

fn sceneSDF(p: vec3<f32>) -> vec2<f32> {
    // Returns (distance, objectId)
    // objId: 0=panel, 1=knobs, 2=knobRings, 3=centralRings
    
    let panelDist = sdPanel(p);
    let knobDist = sdAllKnobs(p);
    let ringsDist = sdSegmentedRings(p);
    
    // Determine which object is closest
    var minDist = panelDist;
    var objId = 0;
    
    if (knobDist < minDist) {
        minDist = knobDist;
        objId = 1;
    }
    if (ringsDist < minDist) {
        minDist = ringsDist;
        objId = 3;
    }
    
    return vec2<f32>(minDist, f32(objId));
}

// ============================================================================
// RAYMARCHING
// ============================================================================
fn raymarch(ro: vec3<f32>, rd: vec3<f32>) -> vec4<f32> {
    var t: f32 = 0.0;
    var objId: i32 = -1;
    
    for (var i: i32 = 0; i < MAX_STEPS; i = i + 1) {
        let p = ro + rd * t;
        let result = sceneSDF(p);
        let d = result.x;
        
        if (d < EPSILON) {
            objId = i32(result.y);
            break;
        }
        
        t += d;
        if (t > MAX_DIST) {
            break;
        }
    }
    
    return vec4<f32>(t, f32(objId), 0.0, 0.0);
}

fn calcNormal(p: vec3<f32>) -> vec3<f32> {
    let e = vec2<f32>(EPSILON, 0.0);
    return normalize(vec3<f32>(
        sceneSDF(p + e.xyy).x - sceneSDF(p - e.xyy).x,
        sceneSDF(p + e.yxy).x - sceneSDF(p - e.yxy).x,
        sceneSDF(p + e.yyx).x - sceneSDF(p - e.yyx).x
    ));
}

// ============================================================================
// PBR LIGHTING
// ============================================================================
fn fresnelSchlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
    return F0 + (vec3<f32>(1.0) - F0) * pow(1.0 - cosTheta, 5.0);
}

fn distributionGGX(N: vec3<f32>, H: vec3<f32>, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let NdotH = max(dot(N, H), 0.0);
    let NdotH2 = NdotH * NdotH;
    
    let num = a2;
    let denom = NdotH2 * (a2 - 1.0) + 1.0;
    return num / (PI * denom * denom);
}

fn geometrySmith(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, roughness: f32) -> f32 {
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    let ggx2 = geometrySchlickGGX(NdotV, roughness);
    let ggx1 = geometrySchlickGGX(NdotL, roughness);
    return ggx1 * ggx2;
}

fn geometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
    let r = roughness + 1.0;
    let k = r * r / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k);
}

fn pbrLighting(pos: vec3<f32>, normal: vec3<f32>, viewDir: vec3<f32>, mat: Material) -> vec3<f32> {
    let N = normal;
    let V = viewDir;
    let F0 = mix(vec3<f32>(0.04), mat.albedo, mat.metallic);
    
    // Light direction (key light from top-left)
    let L = normalize(vec3<f32>(-0.5, 0.8, 0.3));
    let H = normalize(V + L);
    
    // Cook-Torrance BRDF
    let NDF = distributionGGX(N, H, mat.roughness);
    let G = geometrySmith(N, V, L, mat.roughness);
    let F = fresnelSchlick(max(dot(H, V), 0.0), F0);
    
    let kS = F;
    let kD = vec3<f32>(1.0) - kS;
    kD = kD * (1.0 - mat.metallic);
    
    let numerator = NDF * G * F;
    let denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.001;
    let specular = numerator / denominator;
    
    let NdotL = max(dot(N, L), 0.0);
    let Lo = (kD * mat.albedo / PI + specular) * vec3<f32>(3.0) * NdotL;
    
    // Ambient
    let ambient = vec3<f32>(0.03) * mat.albedo;
    
    // Add emissive
    return Lo + ambient + mat.emissive;
}

// ============================================================================
// MAIN
// ============================================================================
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    let pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(-1.0,  3.0),
        vec2<f32>( 3.0, -1.0)
    );
    return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let uv = fragCoord.xy / vec2<f32>(800.0, 600.0); // Adjust to your resolution
    let uv = uv * 2.0 - vec2<f32>(1.0);
    
    // Ray setup
    let ro = camera.cameraPos;
    let rd = normalize(vec3<f32>(uv.x, uv.y, -1.0));
    
    // Raymarch
    let result = raymarch(ro, rd);
    let t = result.x;
    let objId = i32(result.y);
    
    if (objId < 0 || t > MAX_DIST) {
        // Background gradient
        let bg = mix(vec3<f32>(0.05, 0.05, 0.08), vec3<f32>(0.02, 0.02, 0.04), uv.y * 0.5 + 0.5);
        return vec4<f32>(bg, 1.0);
    }
    
    // Hit point
    let pos = ro + rd * t;
    let normal = calcNormal(pos);
    
    // Material
    let mat = getMaterial(pos, objId);
    
    // PBR shading
    let color = pbrLighting(pos, normal, -rd, mat);
    
    // Tone mapping (ACES approximation)
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    let mapped = (color * (a * color + b)) / (color * (c * color + d) + e);
    mapped = pow(clamp(mapped, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
    
    return vec4<f32>(mapped, 1.0);
}
