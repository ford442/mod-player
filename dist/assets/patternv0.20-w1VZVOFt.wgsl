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

fn freqToColor(freq: f32, time: f32) -> vec3<f32> {
    let logF = log2(max(freq, 50.0)) - 5.0;
    // Increased sensitivity (0.8) and added time drift for variety
    let hue = fract(logF * 0.8 - time * 0.1);
    return palette(hue);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
    var uv = in.uv;

    // Fix Aspect Ratio: Crop 16:9 video to 1:1 canvas (background-size: cover)
    // Scale X by 9/16 so we sample a smaller portion of the texture horizontally
    uv.x = (uv.x - 0.5) * (9.0 / 16.0) + 0.5;

    let p = (in.uv - 0.5) * 2.0; // Use original UV for geometry placement logic

    // Sample the video texture
    // WebGPU textures are often vertically flipped compared to DOM video/images
    // Flip Y only for texture sampling so geometry/layout (p) stays correct
    let sampleUv = vec2<f32>(uv.x, 1.0 - uv.y);
    let cloud = textureSampleLevel(buttonsTexture, buttonsSampler, sampleUv, 0.0).rgb;

    // Accumulate Light
    var lightAccum = vec3<f32>(0.0);

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
            let glow = smoothstep(0.8, 0.0, dist) * intensity;

            // Burst
            let burst = smoothstep(0.15, 0.0, dist) * f32(ch.trigger);

            let col = freqToColor(ch.freq, uniforms.timeSec);

            lightAccum += col * (glow * 2.0 + burst * 4.0);
        }
    }

    // Blending: Lights behind clouds
    // Calculate cloud luminance to approximate opacity/thickness
    let lum = dot(cloud, vec3<f32>(0.299, 0.587, 0.114));

    // Occlusion mask: Dark areas (sky) are transparent (0.0), Bright areas (clouds) are opaque (1.0)
    // We allow a little bit of light bleed through thick clouds (0.9 max occlusion)
    let occlusion = smoothstep(0.2, 0.8, lum) * 0.9;

    // Mask the light
    let maskedLight = lightAccum * (1.0 - occlusion);

    // Add masked light to the original cloud image
    // This preserves the white cloud details while lighting up the sky/thin parts
    let finalCol = cloud + maskedLight;

    return vec4<f32>(finalCol, 1.0);
}
