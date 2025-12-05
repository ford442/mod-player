// patternv0.23.wgsl
// Mode: "The Hologram Stage"
// Features: Audio-reactive video glitch, Laser light show

struct Uniforms {
  numRows: u32,
  numChannels: u32,
  playheadRow: u32,
  isPlaying: u32,
  cellW: f32,
  cellH: f32,
  canvasW: f32,
  canvasH: f32,
  tickOffset: f32,
  bpm: f32,
  timeSec: f32,
  beatPhase: f32,
  groove: f32,
  kickTrigger: f32,
  activeChannels: u32,
  isModuleLoaded: u32,
};

@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var<storage, read> rowFlags: array<u32>;

struct ChannelState { volume: f32, pan: f32, freq: f32, trigger: u32, noteAge: f32, activeEffect: u32, effectValue: f32, isMuted: u32 };
@group(0) @binding(3) var<storage, read> channels: array<ChannelState>;
@group(0) @binding(4) var mySampler: sampler;
@group(0) @binding(5) var myTexture: texture_2d<f32>; // The Dancer Video/Image

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  // Draw a single full-screen quad (ignoring the grid instance count)
  var out: VertexOut;
  if (instanceIndex > 0u) {
    out.position = vec4<f32>(0.0);
    out.uv = vec2<f32>(0.0);
    return out;
  }
  
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
  );
  let pos = quad[vertexIndex];
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5;
  return out;
}

// --- HELPERS ---

fn palette(t: f32) -> vec3<f32> {
    // Neon palette
    let a = vec3<f32>(0.5, 0.5, 0.5);
    let b = vec3<f32>(0.5, 0.5, 0.5);
    let c = vec3<f32>(1.0, 1.0, 1.0);
    let d = vec3<f32>(0.263, 0.416, 0.557);
    return a + b * cos(6.28318 * (c * t + d));
}

fn freqToColor(freq: f32) -> vec3<f32> {
    let logF = log2(max(freq, 50.0)) - 5.0; 
    return palette(fract(logF * 0.12));
}

// Distance from a point p to a line segment (a to b)
fn sdLine(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
    var uv = in.uv;
    // Fix aspect ratio for the scene coordinates
    let aspect = uniforms.canvasW / uniforms.canvasH;
    var p = (uv - 0.5) * vec2<f32>(aspect, 1.0) * 2.0; // Centered at 0,0

    var finalColor = vec3<f32>(0.05, 0.05, 0.08); // Dark stage background

    // --- 1. LASER SHOW (Background) ---
    // Draw beams shooting from bottom of screen based on channels
    let numCh = uniforms.numChannels;
    // Spread lasers across width [-1.5 to 1.5]
    let width = 3.0; 
    let spacing = width / f32(numCh);
    let startX = -width * 0.5 + spacing * 0.5;

    for (var i = 0u; i < numCh; i++) {
        let ch = channels[i];
        if (ch.noteAge < 1.0 && ch.isMuted == 0u) {
            let xPos = startX + f32(i) * spacing;
            
            // Laser origin (bottom) and target (angled up)
            let origin = vec2<f32>(xPos, -1.2);
            // Slight angle variation per channel
            let angle = (xPos) * -0.5; 
            let target = vec2<f32>(xPos + angle, 1.5);

            let d = sdLine(p, origin, target);
            
            // Beam width narrows with distance
            let intensity = exp(-ch.noteAge * 4.0) * ch.volume;
            let beam = 0.005 / (d + 0.001) * intensity;
            
            // Add flash on trigger
            let flash = step(0.95, 1.0 - ch.noteAge) * f32(ch.trigger) * 2.0;
            
            let col = freqToColor(ch.freq);
            finalColor += col * (beam + flash);
        }
    }

    // --- 2. THE DANCER (Hologram Plane) ---
    // Apply "Glitch" effects based on kickTrigger
    let kick = uniforms.kickTrigger;
    
    // a. Chromatic Aberration (RGB Split)
    let shift = vec2<f32>(0.02, 0.0) * kick;
    
    // b. Scanline Displacement (Horizontal Tearing)
    let scanline = sin(uv.y * 100.0 + uniforms.timeSec * 20.0);
    let displacement = vec2<f32>(scanline * 0.01 * kick, 0.0);

    // Sample texture with offsets
    // Note: Assuming texture is standard aspect. Adjust 'scale' to fit.
    let texScale = 0.8; 
    var charUV = (in.uv - 0.5) * (1.0/texScale) + 0.5; 
    
    // Mask to keep character inside 0..1 UVs
    if (charUV.x > 0.0 && charUV.x < 1.0 && charUV.y > 0.0 && charUV.y < 1.0) {
        let r = textureSample(myTexture, mySampler, charUV - shift + displacement).r;
        let g = textureSample(myTexture, mySampler, charUV + displacement).g;
        let b = textureSample(myTexture, mySampler, charUV + shift + displacement).b;
        let a = textureSample(myTexture, mySampler, charUV).a; // Use alpha if available

        var charColor = vec3<f32>(r, g, b);

        // c. "Hologram" Scanlines overlay
        let holoGrid = sin(charUV.y * 200.0 + uniforms.timeSec * 5.0) * 0.1;
        charColor += vec3<f32>(0.2, 0.5, 1.0) * holoGrid; // Blue tint

        // d. Beat Pulse Opacity
        let pulse = 0.8 + 0.2 * sin(uniforms.timeSec * 10.0);
        
        // Composite
        // Assumes premultiplied alpha or black background video
        let mask = smoothstep(0.1, 0.3, (r+g+b)/3.0); // Luma key if no alpha
        
        // Additive blending for "Hologram" feel
        finalColor += charColor * mask * pulse * (1.0 + kick);
    }

    // Vignette
    let vig = 1.0 - length(in.uv - 0.5) * 0.8;
    finalColor *= vig;

    return vec4<f32>(finalColor, 1.0);
}
