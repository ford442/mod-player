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

// Returns a pixelated UV coordinate
fn pixelate_uv(uv: vec2<f32>, blocks: f32) -> vec2<f32> {
    let dx = 1.0 / blocks;
    let dy = 1.0 / blocks;
    return vec2<f32>(
        floor(uv.x / dx) * dx,
        floor(uv.y / dy) * dy
    );
}

// Sobel-style edge detection. Returns a value from 0.0 (flat) to ~1.0+ (sharp edge)
fn get_edge_intensity(uv: vec2<f32>, tex: texture_2d<f32>, samp: sampler) -> f32 {
    let w = 1.0 / uniforms.canvasW;
    let h = 1.0 / uniforms.canvasH;

    // Sample surrounding pixels and get their brightness (luma)
    let tl = dot(textureSample(tex, samp, uv + vec2<f32>(-w, -h)).rgb, vec3(0.299, 0.587, 0.114));
    let t  = dot(textureSample(tex, samp, uv + vec2<f32>( 0.0, -h)).rgb, vec3(0.299, 0.587, 0.114));
    let tr = dot(textureSample(tex, samp, uv + vec2<f32>( w, -h)).rgb, vec3(0.299, 0.587, 0.114));
    let l  = dot(textureSample(tex, samp, uv + vec2<f32>(-w, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    let r  = dot(textureSample(tex, samp, uv + vec2<f32>( w, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    let bl = dot(textureSample(tex, samp, uv + vec2<f32>(-w,  h)).rgb, vec3(0.299, 0.587, 0.114));
    let b  = dot(textureSample(tex, samp, uv + vec2<f32>( 0.0,  h)).rgb, vec3(0.299, 0.587, 0.114));
    let br = dot(textureSample(tex, samp, uv + vec2<f32>( w,  h)).rgb, vec3(0.299, 0.587, 0.114));

    // Sobel operator
    let gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
    let gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
    
    // Calculate gradient magnitude and clamp for stability
    return clamp(sqrt(gx * gx + gy * gy), 0.0, 1.0);
}

@fragment
fn fs(fragIn: VertexOut) -> @location(0) vec4<f32> {
    var uv = fragIn.uv;
    // Fix aspect ratio for the scene coordinates
    let aspect = uniforms.canvasW / uniforms.canvasH;
    var p = (uv - 0.5) * vec2<f32>(aspect, 1.0) * 2.0; // Centered at 0,0

    var finalColor = vec3<f32>(0.02, 0.02, 0.03); 

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
            let laserTarget = vec2<f32>(xPos + angle, 1.5);

            let d = sdLine(p, origin, laserTarget);
            
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
    let kick = uniforms.kickTrigger;
    
    let texScale = 0.8; 
    var charUV = (fragIn.uv - 0.5) * (1.0/texScale) + 0.5; 
    charUV.y = 1.0 - charUV.y; // Flip Y-coordinate

    // Mask logic
    let uvMask = step(0.0, charUV.x) * step(charUV.x, 1.0) * step(0.0, charUV.y) * step(charUV.y, 1.0);

    if (uvMask > 0.5) {
        // --- NEW: ARTIFACT CONTOUR LOGIC ---
        
        // 1. Calculate edge strength, amplified by the kick.
        var edge_strength = get_edge_intensity(charUV, myTexture, mySampler);
        edge_strength *= (1.0 + kick * 15.0);

        // 2. Create the "Aura Artifact" mix factor.
        // This fades the blockiness in around the edges.
        let mix_factor = smoothstep(0.1, 0.6, edge_strength);
        // For the "Hard Edge Glitch", you would use this instead:
        // let mix_factor = step(0.4, edge_strength);

        // 3. Make block size dependent on the kick.
        // No kick = tiny blocks (high-res). Full kick = huge blocks (low-res).
        let block_count = mix(200.0, 35.0, kick * kick);
        let coarseUV = pixelate_uv(charUV, block_count);

        // 4. Mix the clean and coarse UVs based on the edge aura.
        let artifactUV = mix(charUV, coarseUV, mix_factor);

        // --- END OF NEW LOGIC ---

        // Original glitch effect, now using the `artifactUV`.
        let shift = vec2<f32>(0.015, 0.0) * kick;
        let scanline = sin(uv.y * 120.0 + uniforms.timeSec * 15.0);
        let displacement = vec2<f32>(scanline * 0.005 * kick, 0.0);

        // Sample the texture using the final mixed UV and existing glitch.
        // This cleanly combines both effects.
        let r = textureSample(myTexture, mySampler, artifactUV - shift + displacement).r;
        let g = textureSample(myTexture, mySampler, artifactUV + displacement).g;
        let b = textureSample(myTexture, mySampler, artifactUV + shift + displacement).b;
        
        var charColor = vec3<f32>(r, g, b);

        // Darken the dancer and add hologram scanlines (no change here)
        charColor *= 0.6; 
        let holoGrid = sin(charUV.y * 300.0 + uniforms.timeSec * 5.0) * 0.5 + 0.5;
        charColor *= (0.8 + 0.2 * holoGrid);

        // Luma Key and Flash (no change here)
        let luma = dot(charColor, vec3<f32>(0.299, 0.587, 0.114));
        let lumaMask = smoothstep(0.05, 0.2, luma);
        let flash = 0.8 + (kick * 0.3); 
        
        finalColor += charColor * lumaMask * flash;
    }

    // Vignette
    let vig = 1.0 - length(fragIn.uv - 0.5) * 0.7;
    finalColor *= vig;

    return vec4<f32>(finalColor, 1.0);
}
