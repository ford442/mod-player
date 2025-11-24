// Cloud Video Backlight Visualization
// V0.20: Video Texture + Rainbow Lights
// Layout: Extended

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
@group(0) @binding(4) var buttonsSampler: sampler;
@group(0) @binding(5) var buttonsTexture: texture_2d<f32>; // Used for Video

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
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

// --- FRAGMENT SHADER HELPERS ---

fn palette(t: f32) -> vec3<f32> {
    // Vibrant Rainbow
    let a = vec3<f32>(0.5, 0.5, 0.5);
    let b = vec3<f32>(0.5, 0.5, 0.5);
    let c = vec3<f32>(1.0, 1.0, 1.0);
    let d = vec3<f32>(0.0, 0.33, 0.67);
    return a + b * cos(6.28318 * (c * t + d));
}

fn freqToColor(freq: f32) -> vec3<f32> {
    let logF = log2(max(freq, 50.0)) - 5.0;
    let hue = fract(logF * 0.15);
    return palette(hue);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
    let uv = in.uv;
    // Fix Y if video is flipped? Usually WebGPU textures are Y-down, same as UV?
    // If clouds look upside down, we flip.

    let p = (uv - 0.5) * 2.0;

    // Sample the video texture
    let cloud = textureSampleLevel(buttonsTexture, buttonsSampler, uv, 0.0).rgb;

    // Accumulate Light
    var lightAccum = vec3<f32>(0.1, 0.1, 0.1); // Ambient

    let numCh = uniforms.numChannels;
    for (var i = 0u; i < numCh; i++) {
        let ch = channels[i];
        if (ch.noteAge < 3.0 && ch.isMuted == 0u) {
            // Random-ish position based on channel index
            let seed = f32(i) * 17.0;
            // Drifting motion
            let drift = uniforms.timeSec * 0.15;
            let pos = vec2<f32>(
                cos(seed + drift) * 0.7,
                sin(seed * 1.5 + drift * 0.8) * 0.6
            );

            let dist = length(p - pos);

            // Large soft bloom
            let intensity = exp(-ch.noteAge * 1.0) * ch.volume;
            let glow = smoothstep(0.6, 0.0, dist) * intensity;

            // Burst
            let burst = smoothstep(0.1, 0.0, dist) * f32(ch.trigger);

            let col = freqToColor(ch.freq);

            lightAccum += col * (glow * 2.5 + burst * 5.0);
        }
    }

    // Multiply: Light colors the clouds
    let finalCol = cloud * lightAccum;

    // Add a bit of the original cloud back so it's not pitch black where no light
    // or clamp lightAccum?

    return vec4<f32>(finalCol, 1.0);
}
