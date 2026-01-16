// patternv0.23.wgsl
// Mode: "The Hologram Stage"
// Features: Audio-reactive video glitch, Laser light show, Volumetric Haze, Digital Decay

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
  var vertexOut: VertexOut;
  if (instanceIndex > 0u) {
    vertexOut.position = vec4<f32>(0.0);
    vertexOut.uv = vec2<f32>(0.0);
    return vertexOut;
  }
  
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
  );
  let pos = quad[vertexIndex];
  vertexOut.position = vec4<f32>(pos, 0.0, 1.0);
  vertexOut.uv = pos * 0.5 + 0.5;
  return vertexOut;
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

// Simple 2D noise function for haze
fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    return fract(sin(dot(i, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

// Simple hash for block_slide
fn hash1(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

// Digital decay glitch function
fn block_slide(uv: vec2<f32>, strength: f32, block_size: f32) -> vec2<f32> {
    let blocks = vec2<f32>(block_size, block_size * (uniforms.canvasH / uniforms.canvasW));
    let block_uv = floor(uv * blocks);
    let slide_amount = (hash1(block_uv) - 0.5) * 2.0; // Centered hash
    return vec2<f32>(uv.x + slide_amount * strength, uv.y);
}


@fragment
fn fs(fragIn: VertexOut) -> @location(0) vec4<f32> {
    var uv = fragIn.uv;
    // Fix aspect ratio for the scene coordinates
    let aspect = uniforms.canvasW / uniforms.canvasH;
    var p = (uv - 0.5) * vec2<f32>(aspect, 1.0) * 2.0; // Centered at 0,0

    var finalColor = vec3<f32>(0.05, 0.05, 0.08); // Dark stage background

    // --- 1. LASER SHOW (Background) ---
    let numCh = uniforms.numChannels;
    let width = 3.0; 
    let spacing = width / f32(numCh);
    let startX = -width * 0.5 + spacing * 0.5;

    for (var i = 0u; i < numCh; i++) {
        let ch = channels[i];
        if (ch.noteAge < 1.0 && ch.isMuted == 0u) {
            let xPos = startX + f32(i) * spacing;
            
            let origin = vec2<f32>(xPos, -1.2);
            let angle = (xPos) * -0.5; 
            let laserTarget = vec2<f32>(xPos + angle, 1.5);

            let d = sdLine(p, origin, laserTarget);
            
            // Use smoothstep for a softer, wider beam falloff
            let intensity = pow(1.0 - ch.noteAge, 2.0) * ch.volume;
            let beam = smoothstep(0.05, 0.0, d) * intensity;
            
            let flash = step(0.95, 1.0 - ch.noteAge) * f32(ch.trigger) * 0.5;
            
            // Add Haze
            let haze = noise(p * 30.0 + uniforms.timeSec) * 0.2;
            let finalBeam = beam + flash + (haze * beam * 2.0);

            let col = freqToColor(ch.freq);
            finalColor += col * finalBeam;
        }
    }

    // --- 2. THE DANCER (Hologram Plane) ---
    let kick = uniforms.kickTrigger;
    
    let texScale = 0.8; 
    var charUV = (fragIn.uv - 0.5) * (1.0/texScale) + 0.5; 
    charUV.y = 1.0 - charUV.y; // Flip Y-coordinate

    // --- DIGITAL DECAY GLITCH ---
    let block_size = mix(200.0, 40.0, kick);
    let slide_strength = kick * kick;
    let glitchUV = block_slide(charUV, slide_strength, block_size);

    // --- UNCONDITIONAL SAMPLING ---
    let r = textureSample(myTexture, mySampler, glitchUV).r;
    let g = textureSample(myTexture, mySampler, glitchUV).g;
    let b = textureSample(myTexture, mySampler, glitchUV).b;

    // --- MASKING & COMPOSITING ---
    let uvMask = step(0.0, charUV.x) * step(charUV.x, 1.0) * step(0.0, charUV.y) * step(charUV.y, 1.0);

    if (uvMask > 0.5) {
        var charColor = vec3<f32>(r, g, b);

        let holoGrid = sin(charUV.y * 200.0 + uniforms.timeSec * 5.0) * 0.1;
        charColor += vec3<f32>(0.2, 0.5, 1.0) * holoGrid;

        let pulse = 0.8 + 0.2 * sin(uniforms.timeSec * 10.0);
        
        let lumaMask = smoothstep(0.1, 0.3, (r+g+b)/3.0);
        
        finalColor += charColor * lumaMask * pulse * (0.8 + kick * 0.5);
    }

    // Vignette
    let vig = 1.0 - length(fragIn.uv - 0.5) * 0.8;
    finalColor *= vig;

    return vec4<f32>(finalColor, 1.0);
}
