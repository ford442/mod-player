// ============================================================================
// MOD Player Pattern Visualization Shader v0.50-IMPROVED
// Three-Emitter LED System with Enhanced Realism
// ============================================================================

// ----------------------------------------------------------------------------
// Uniforms and Bindings
// ----------------------------------------------------------------------------

struct Uniforms {
    // Grid configuration
    gridWidth: u32,
    gridHeight: u32,
    cellSize: f32,
    padding: f32,
    
    // Timing and animation
    time: f32,
    bpm: f32,
    playheadPosition: f32,
    
    // Visual parameters
    bloomIntensity: f32,
    ledAge: f32,           // 0.0 = new, 1.0 = aged
    contrastBoost: f32,
    
    // Layout flags
    layoutType: u32,       // 0 = square, 1 = circular
    padTopChannel: u32,    // true = channel 0 is indicator ring
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> channelStates: array<ChannelState>;
@group(0) @binding(2) var<storage, read> rowFlags: array<u32>;
@group(0) @binding(3) var textureSampler: sampler;
@group(0) @binding(4) var backgroundTexture: texture_2d<f32>;

// Packed channel state for performance
struct ChannelState {
    data: u32,             // Packed: trigger(1) | note(7) | octave(4) | volume(8) | effect(8) | flags(4)
};

// ----------------------------------------------------------------------------
// Bit Packing/Unpacking Functions
// ----------------------------------------------------------------------------

fn unpackTrigger(data: u32) -> bool { return (data & 0x1u) != 0u; }
fn unpackNote(data: u32) -> u32 { return (data >> 1u) & 0x7Fu; }
fn unpackOctave(data: u32) -> u32 { return (data >> 8u) & 0xFu; }
fn unpackVolume(data: u32) -> u32 { return (data >> 12u) & 0xFFu; }
fn unpackEffect(data: u32) -> u32 { return (data >> 20u) & 0xFFu; }
fn unpackMuted(data: u32) -> bool { return ((data >> 28u) & 0x1u) != 0u; }
fn hasExpression(data: u32) -> bool { return unpackEffect(data) != 0u || unpackVolume(data) != 64u; }

// ----------------------------------------------------------------------------
// Color Science and Palette Functions
// ----------------------------------------------------------------------------

// Circle of fifths - musically meaningful pitch-class colors
const PITCH_COLORS = array<vec3<f32>, 12>(
    vec3(1.00, 0.05, 0.05),  // C   - Pure Red
    vec3(1.00, 0.35, 0.00),  // C#  - Orange-Red (enhanced)
    vec3(1.00, 0.85, 0.00),  // D   - Golden Yellow
    vec3(0.60, 0.95, 0.00),  // D#  - Lime-Green (enhanced)
    vec3(0.05, 0.90, 0.05),  // E   - Pure Green
    vec3(0.00, 0.85, 0.50),  // F   - Teal
    vec3(0.00, 0.80, 0.95),  // F#  - Cyan (enhanced)
    vec3(0.05, 0.50, 1.00),  // G   - Sky Blue
    vec3(0.15, 0.20, 1.00),  // G#  - Deep Blue (enhanced)
    vec3(0.55, 0.00, 0.95),  // A   - Purple
    vec3(0.95, 0.00, 0.75),  // A#  - Magenta (enhanced)
    vec3(1.00, 0.05, 0.40)   // B   - Pink
);

fn pitchToColor(note: u32, octave: u32) -> vec3<f32> {
    let pitchClass = note % 12u;
    var color = PITCH_COLORS[pitchClass];
    
    // Octave brightness variation (higher = slightly brighter)
    let octaveFactor = 1.0 + f32(octave) * 0.03;
    color *= octaveFactor;
    
    // Enhanced saturation for accidentals
    if (pitchClass == 1u || pitchClass == 3u || pitchClass == 6u || 
        pitchClass == 8u || pitchClass == 10u) {
        let luma = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(vec3(luma), color, 1.25);
    }
    
    return color;
}

// Vintage LED aging simulation
fn applyLEDAging(color: vec3<f32>, age: f32) -> vec3<f32> {
    // Older LEDs shift toward yellow and lose saturation
    let yellowShift = vec3(0.92, 0.88, 0.65);
    let aged = mix(color, color * yellowShift, age * 0.4);
    
    // Reduced saturation with age
    let luma = dot(aged, vec3(0.299, 0.587, 0.114));
    return mix(vec3(luma), aged, 1.0 - age * 0.2);
}

// ----------------------------------------------------------------------------
// Tone Mapping and HDR Handling
// ----------------------------------------------------------------------------

fn reinhardExtended(color: vec3<f32>, maxWhite: f32) -> vec3<f32> {
    let numerator = color * (1.0 + color / (maxWhite * maxWhite));
    return numerator / (1.0 + color);
}

fn acesToneMap(color: vec3<f32>) -> vec3<f32> {
    // ACES Filmic tone mapping approximation
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3(0.0), vec3(1.0));
}

// ----------------------------------------------------------------------------
// Dithering Functions
// ----------------------------------------------------------------------------

// Interleaved gradient noise (better than simple random)
fn ign(uv: vec2<f32>) -> f32 {
    let n = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    return fract(52.9829189 * fract(n * 0.06711056));
}

fn dither8x8(uv: vec2<f32>, color: vec3<f32>) -> vec3<f32> {
    let ditherMatrix = array<f32, 64>(
        0.0, 32.0, 8.0, 40.0, 2.0, 34.0, 10.0, 42.0,
        48.0, 16.0, 56.0, 24.0, 50.0, 18.0, 58.0, 26.0,
        12.0, 44.0, 4.0, 36.0, 14.0, 46.0, 6.0, 38.0,
        60.0, 28.0, 52.0, 20.0, 62.0, 30.0, 54.0, 22.0,
        3.0, 35.0, 11.0, 43.0, 1.0, 33.0, 9.0, 41.0,
        51.0, 19.0, 59.0, 27.0, 49.0, 17.0, 57.0, 25.0,
        15.0, 47.0, 7.0, 39.0, 13.0, 45.0, 5.0, 37.0,
        63.0, 31.0, 55.0, 23.0, 61.0, 29.0, 53.0, 21.0
    );
    
    let idx = (u32(uv.x) % 8u) + (u32(uv.y) % 8u) * 8u;
    let threshold = ditherMatrix[idx] / 64.0 - 0.5;
    return color + threshold / 255.0;
}

// ----------------------------------------------------------------------------
// SDF Functions with Enhanced Quality
// ----------------------------------------------------------------------------

fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
    return length(p) - r;
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + vec2(r);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}

fn sdSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

// Analytic anti-aliasing step
fn aastep(threshold: f32, value: f32, gradient: vec2<f32>) -> f32 {
    let afwidth = length(gradient) * 0.7071; // sqrt(2)/2
    return smoothstep(threshold - afwidth, threshold + afwidth, value);
}

// ----------------------------------------------------------------------------
// LED Lens Cap Simulation
// ----------------------------------------------------------------------------

struct LensParams {
    size: vec2<f32>,
    cornerRadius: f32,
    domeHeight: f32,
    emitterSpacing: f32,
};

fn simulateLEDLens(
    uv: vec2<f32>,
    emitters: array<vec3<f32>, 3>,
    intensities: array<f32, 3>,
    params: LensParams
) -> vec4<f32> {
    // 1. Lens cap outer shape
    let outerDist = sdRoundedBox(uv, params.size, params.cornerRadius);
    
    // 2. Dome profile (convex lens effect)
    let domeCenter = vec2(0.0, params.size.y * 0.05);
    let domeDist = sdCircle(uv - domeCenter, params.size.x * 0.85);
    
    // 3. Calculate internal glow from each emitter
    var internalGlow = vec3(0.0);
    var totalIntensity = 0.0;
    
    for(var i: i32 = 0; i < 3; i = i + 1) {
        // Emitter position (stacked vertically)
        let emitterY = params.emitterSpacing * f32(i - 1);
        let emitterUV = vec2(uv.x, uv.y - emitterY);
        let dist = length(emitterUV);
        
        // Diffusion within encapsulant (Gaussian falloff)
        let diffusion = exp(-dist * dist * 12.0);
        
        // Add color with intensity
        internalGlow += emitters[i] * intensities[i] * diffusion;
        totalIntensity += intensities[i] * diffusion;
    }
    
    // 4. Cross-emitter color bleeding (subsurface scattering)
    let bleedAmount = totalIntensity * 0.15;
    internalGlow = mix(internalGlow, vec3(dot(internalGlow, vec3(0.333))), bleedAmount);
    
    // 5. Fresnel reflection on lens surface
    let viewAngle = abs(uv.y) / params.size.y;
    let fresnel = pow(1.0 - saturate(viewAngle), 2.5) * 0.25;
    
    // 6. Specular highlight (simulating light source reflection)
    let specularPos = vec2(params.size.x * 0.3, -params.size.y * 0.3);
    let specularDist = length(uv - specularPos);
    let specular = pow(saturate(1.0 - specularDist * 4.0), 30.0) * 0.4;
    
    // 7. Combine all lighting
    var finalColor = internalGlow * (1.0 + fresnel);
    finalColor += vec3(specular);
    
    // 8. Lens edge darkening
    let edgeDarken = smoothstep(params.size.x * 1.2, params.size.x * 0.8, length(uv));
    finalColor *= 0.7 + edgeDarken * 0.3;
    
    // 9. Alpha based on lens shape
    let alpha = smoothstep(0.0, 0.015, -outerDist);
    
    return vec4(finalColor, alpha);
}

// ----------------------------------------------------------------------------
// Vintage LED Response Curve
// ----------------------------------------------------------------------------

fn vintageLEDResponse(input: f32, age: f32) -> f32 {
    // Non-linear response (LEDs don't respond linearly to current)
    var response = pow(saturate(input), 1.7 + age * 0.3);
    
    // Soft saturation at high intensities
    response = response / (1.0 + response * 0.1);
    
    // Minimum glow (all LEDs have some leakage)
    return response * 0.98 + 0.02;
}

// ----------------------------------------------------------------------------
// Beat Synchronization
// ----------------------------------------------------------------------------

fn getBeatPulse(time: f32, bpm: f32) -> f32 {
    let beatDuration = 60.0 / bpm;
    let beatPhase = fract(time / beatDuration);
    // Subtle accent on beat
    return 1.0 + sin(beatPhase * 6.28318) * 0.08;
}

// ----------------------------------------------------------------------------
// Main Fragment Shader
// ----------------------------------------------------------------------------

@fragment
fn main(@location(0) uv: vec2<f32>, @location(1) cellCoord: vec2<f32>) -> @location(0) vec4<f32> {
    // Calculate grid cell
    let cellX = u32(cellCoord.x * f32(uniforms.gridWidth));
    let cellY = u32(cellCoord.y * f32(uniforms.gridHeight));
    let cellIndex = cellY * uniforms.gridWidth + cellX;
    
    // Get channel state
    let ch = channelStates[cellIndex];
    let chData = ch.data;
    
    // Unpack state
    let isMuted = unpackMuted(chData);
    let hasNote = unpackNote(chData) > 0u;
    let note = unpackNote(chData);
    let octave = unpackOctave(chData);
    let isTriggered = unpackTrigger(chData);
    let hasExpression = hasExpression(chData);
    
    // Playhead position check
    let playheadRow = u32(uniforms.playheadPosition);
    let isPlayhead = (cellY == playheadRow);
    let playheadActivation = select(0.0, 1.0, isPlayhead);
    
    // Get beat pulse
    let beatPulse = getBeatPulse(uniforms.time, uniforms.bpm);
    
    // ----------------------------------------------------------------------------
    // EMITTER 1 (TOP): Blue Note-On Indicator
    // ----------------------------------------------------------------------------
    let blueColor = vec3<f32>(0.0, 0.4, 1.0);  // More saturated blue
    var topIntensity = 0.02;  // Base leakage
    
    if (!isMuted) {
        if (isTriggered) {
            // Full brightness on trigger with bloom
            topIntensity = 1.0 + uniforms.bloomIntensity * 1.5;
        } else if (playheadActivation > 0.5 && hasNote) {
            // Dim playhead indicator
            topIntensity = playheadActivation * 0.5;
        }
    }
    
    // Apply vintage response
    topIntensity = vintageLEDResponse(topIntensity, uniforms.ledAge);
    
    // ----------------------------------------------------------------------------
    // EMITTER 2 (MIDDLE): Steady Note Color
    // ----------------------------------------------------------------------------
    var noteColor = vec3<f32>(0.08);  // Base dim glow
    var midIntensity = 0.08;
    
    if (hasNote) {
        // Get pitch-based color
        noteColor = pitchToColor(note, octave);
        
        // Apply aging
        noteColor = applyLEDAging(noteColor, uniforms.ledAge);
        
        // Steady intensity (doesn't blink)
        midIntensity = 0.55 + uniforms.bloomIntensity * 1.5;
        
        // Boost with beat pulse for active notes
        if (isTriggered) {
            midIntensity *= beatPulse;
        }
    }
    
    // Apply vintage response
    midIntensity = vintageLEDResponse(midIntensity, uniforms.ledAge);
    
    // ----------------------------------------------------------------------------
    // EMITTER 3 (BOTTOM): Amber Control Message Indicator
    // ----------------------------------------------------------------------------
    let amberColor = vec3<f32>(1.0, 0.6, 0.0);  // More orange amber
    var botIntensity = 0.02;  // Base leakage
    
    if (!isMuted && hasExpression) {
        botIntensity = 0.75 + uniforms.bloomIntensity;
        
        // Flash on effect change
        if (isTriggered) {
            botIntensity *= 1.2;
        }
    }
    
    // Apply vintage response
    botIntensity = vintageLEDResponse(botIntensity, uniforms.ledAge);
    
    // ----------------------------------------------------------------------------
    // LED Lens Simulation
    // ----------------------------------------------------------------------------
    
    // Normalize UV to cell-local coordinates (-1 to 1)
    let localUV = (fract(cellCoord * vec2(f32(uniforms.gridWidth), f32(uniforms.gridHeight)))) * 2.0 - 1.0;
    
    // Lens parameters
    let lensParams = LensParams(
        vec2(0.85, 0.9),    // size
        0.25,               // cornerRadius
        0.15,               // domeHeight
        0.35                // emitterSpacing
    );
    
    // Emitter colors and intensities
    let emitterColors = array<vec3<f32>, 3>(blueColor, noteColor, amberColor);
    let emitterIntensities = array<f32, 3>(topIntensity, midIntensity, botIntensity);
    
    // Simulate LED lens
    var ledResult = simulateLEDLens(localUV, emitterColors, emitterIntensities, lensParams);
    
    // ----------------------------------------------------------------------------
    // Background Integration
    // ----------------------------------------------------------------------------
    
    // Sample background texture
    let bgColor = textureSample(backgroundTexture, textureSampler, uv);
    
    // Housing/plastic color around LED
    let housingColor = vec3(0.12, 0.12, 0.14);
    
    // Light bleed into housing
    let bleedAmount = (topIntensity + midIntensity + botIntensity) * 0.08;
    let finalHousing = mix(housingColor, ledResult.rgb, bleedAmount);
    
    // Composite LED over background
    var finalColor = mix(finalHousing, ledResult.rgb, ledResult.a);
    
    // ----------------------------------------------------------------------------
    // Post-Processing
    // ----------------------------------------------------------------------------
    
    // Apply contrast boost
    finalColor = pow(finalColor, vec3(1.0 / uniforms.contrastBoost));
    
    // Tone mapping for HDR values
    finalColor = acesToneMap(finalColor * 1.2);
    
    // Dithering to prevent banding
    finalColor = dither8x8(uv * vec2(f32(uniforms.gridWidth), f32(uniforms.gridHeight)), finalColor);
    
    // Final output
    return vec4(saturate(finalColor), 1.0);
}

// ----------------------------------------------------------------------------
// Compute Shader (Optional - for advanced effects)
// ----------------------------------------------------------------------------

@compute @workgroup_size(8, 8)
fn computeBloom(@builtin(global_invocation_id) gid: vec3<u32>) {
    // This would be used for multi-pass bloom computation
    // Left as placeholder for future implementation
}
