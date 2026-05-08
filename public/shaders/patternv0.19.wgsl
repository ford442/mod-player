// Swirling Water Visualization Shader
// V0.19: Underwater Lights + Caustics
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
@group(0) @binding(5) var buttonsTexture: texture_2d<f32>;

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

fn hash12(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i + vec2<f32>(0.0,0.0)),
                   hash12(i + vec2<f32>(1.0,0.0)), u.x),
               mix(hash12(i + vec2<f32>(0.0,1.0)),
                   hash12(i + vec2<f32>(1.0,1.0)), u.x), u.y);
}

// Simple caustics pattern: layered sine waves
fn caustics(uv: vec2<f32>, time: f32) -> f32 {
    var v = 0.0;
    // Layer 1
    v += sin(uv.x * 10.0 + time) * 0.5 + 0.5;
    v += sin(uv.y * 12.0 - time * 0.8) * 0.5 + 0.5;
    // Layer 2 (rotated)
    let rot = mat2x2<f32>(0.6, -0.8, 0.8, 0.6);
    let uv2 = rot * uv * 2.5;
    v += sin(uv2.x * 8.0 + time * 1.5) * 0.3;
    v += sin(uv2.y * 9.0 - time) * 0.3;

    // Sharpen ridges
    return pow(v * 0.25, 3.0);
}

fn palette(t: f32) -> vec3<f32> {
    // Underwater light palette (Cyan/Teal/Blue/Magenta)
    let a = vec3<f32>(0.5, 0.5, 0.5);
    let b = vec3<f32>(0.5, 0.5, 0.5);
    let c = vec3<f32>(1.0, 1.0, 1.0);
    let d = vec3<f32>(0.0, 0.10, 0.20);
    return a + b * cos(6.28318 * (c * t + d));
}

fn freqToColor(freq: f32) -> vec3<f32> {
    let logF = log2(max(freq, 50.0)) - 5.0;
    let hue = fract(logF * 0.15);
    // Shift palette to be more "aquatic" but still colorful
    return palette(hue + 0.4);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
    let uv = (in.uv - 0.5) * 2.0;
    let r = length(uv);
    let a = atan2(uv.y, uv.x);
    let time = uniforms.timeSec;

    // --- WATER BACKGROUND ---
    // Deep blue gradient
    var col = mix(vec3<f32>(0.0, 0.05, 0.1), vec3<f32>(0.0, 0.2, 0.3), 1.0 - r * 0.8);

    // Swirling coordinates
    let swirlSpeed = max(uniforms.bpm, 60.0) / 120.0;
    let swirlStr = 2.0 / (r + 0.5);
    let angle = a - time * swirlSpeed * 0.5 * swirlStr;
    let swirlUV = vec2<f32>(cos(angle), sin(angle)) * r;

    // --- LIGHTS UNDER SURFACE ---
    let numCh = uniforms.numChannels;
    for (var i = 0u; i < numCh; i++) {
        let ch = channels[i];
        if (ch.noteAge < 3.0 && ch.isMuted == 0u) {
            // Position lights in a spiral
            let chAngle = (f32(i) / f32(numCh)) * 6.28318;
            // Radius oscillates slightly
            let chRad = 0.5 + 0.1 * sin(time + f32(i));

            // Adjust position based on the SAME swirl logic so they move with the water?
            // Or let water move over them?
            // Let's make lights rotate slowly, water swirls fast.
            let lightRot = chAngle + time * 0.2;
            let lightPos = vec2<f32>(cos(lightRot), sin(lightRot)) * chRad;

            let d = length(uv - lightPos);

            // Diffuse Glow (underwater scattering)
            let intensity = exp(-ch.noteAge * 2.0) * ch.volume;
            // Add a "bloom"
            let glow = 0.05 / (d * d + 0.02) * intensity;

            var lightCol = freqToColor(ch.freq);

            // Add trigger flash (bright white core)
            if (ch.trigger > 0u) {
                lightCol = mix(lightCol, vec3<f32>(1.0), 0.8);
                // Shockwave?
            }

            col += lightCol * glow;
        }
    }

    // --- CAUSTICS OVERLAY ---
    // Distort uv for caustics based on some flow
    let causVal = caustics(swirlUV * 2.0, time);

    // Add caustics primarily where there is light? Or global?
    // Global caustics from "sun surface" (unrelated to underwater lights)
    // But "lights under its surface" implies the lights illuminate the water.
    // So maybe we multiply caustics by the accumulated light?
    // Or just add them as "sunlight from above".

    let sunlight = vec3<f32>(0.8, 0.9, 1.0) * causVal * (0.2 + 0.3 * (1.0 - r));

    // Blend caustics: Additive but masked by vignettes
    col += sunlight;

    // Chromatic aberration at edges?

    return vec4<f32>(col, 1.0);
}
