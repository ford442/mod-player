// patternv0.23.wgsl
// Mode: "Clouds Stage"
// Features: Full-canvas clouds video, global scanlines, audio-reactive laser light show

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
@group(0) @binding(5) var myTexture: texture_2d<f32>; // Clouds video

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

fn sdLine(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    return fract(sin(dot(i, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn hash1(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn block_slide(uv: vec2<f32>, strength: f32, block_size: f32, aspect: f32) -> vec2<f32> {
    let blocks = vec2<f32>(block_size / aspect, block_size);
    let block_uv = floor(uv * blocks);
    let slide_amount = (hash1(block_uv) - 0.5) * 2.0;
    return vec2<f32>(uv.x + slide_amount * strength, uv.y);
}

// Cover-style UV: crop 16:9 video to fill square canvas (background-size: cover)
fn videoCoverUv(screenUv: vec2<f32>, canvasAspect: f32) -> vec2<f32> {
    let videoAspect = 16.0 / 9.0;
    var uv = screenUv;
    if (canvasAspect > videoAspect) {
        // Canvas wider than video — crop vertical
        let scale = canvasAspect / videoAspect;
        uv.y = (uv.y - 0.5) / scale + 0.5;
    } else {
        // Canvas taller than video — crop horizontal
        let scale = videoAspect / canvasAspect;
        uv.x = (uv.x - 0.5) / scale + 0.5;
    }
    return uv;
}

@fragment
fn fs(fragIn: VertexOut) -> @location(0) vec4<f32> {
    let aspect = uniforms.canvasW / uniforms.canvasH;
    var uv = vec2<f32>((fragIn.uv.x - 0.5) * aspect + 0.5, fragIn.uv.y);
    let p = (uv - 0.5) * 2.0;

    // --- 1. FULL-CANVAS CLOUDS VIDEO ---
    let kick = uniforms.kickTrigger;
    var videoUv = videoCoverUv(fragIn.uv, aspect);
    videoUv.y = 1.0 - videoUv.y;

    let block_size = mix(200.0, 40.0, kick);
    let slide_strength = kick * kick;
    let glitchUV = block_slide(videoUv, slide_strength, block_size, aspect);

    let cloud = textureSampleLevel(myTexture, mySampler, glitchUV, 0.0).rgb;

    // Global scanline overlay (full canvas)
    let globalScan = 0.9 + 0.1 * sin(fragIn.uv.y * 800.0 + uniforms.timeSec * 10.0);
    var finalColor = cloud * globalScan;

    // --- 2. LASER SHOW (additive, sky bleeds through clouds) ---
    let numCh = uniforms.numChannels;
    let width = 3.0;
    let spacing = width / f32(numCh);
    let startX = -width * 0.5 + spacing * 0.5;

    var lightAccum = vec3<f32>(0.0);
    for (var i = 0u; i < numCh; i++) {
        let ch = channels[i];
        if (ch.noteAge < 1.0 && ch.isMuted == 0u) {
            let xPos = startX + f32(i) * spacing;

            let origin = vec2<f32>(xPos, -1.2);
            let angle = xPos * -0.5;
            let laserTarget = vec2<f32>(xPos + angle, 1.5);

            let d = sdLine(p, origin, laserTarget);

            let intensity = pow(1.0 - ch.noteAge, 2.0) * ch.volume;
            let beam = smoothstep(0.05, 0.0, d) * intensity;

            let flash = step(0.95, 1.0 - ch.noteAge) * f32(ch.trigger) * 0.5;

            let haze = noise(p * 30.0 + uniforms.timeSec) * 0.2;
            let finalBeam = beam + flash + (haze * beam * 2.0);

            let col = freqToColor(ch.freq);
            lightAccum += col * finalBeam;
        }
    }

    // Occlusion: lasers shine through sky, attenuated by bright clouds
    let lum = dot(cloud, vec3<f32>(0.299, 0.587, 0.114));
    let occlusion = smoothstep(0.2, 0.8, lum) * 0.9;
    finalColor += lightAccum * (1.0 - occlusion);

    // Vignette
    let vig = 1.0 - length(uv - 0.5) * 0.8;
    finalColor *= vig;

    return vec4<f32>(finalColor, 1.0);
}
