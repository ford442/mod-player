// Spiral Vortex Visualization Shader
// V0.18: Abstract "Cloud" Spiral + Neon Particle Splashes
// Layout: Extended (requires channel state)

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

@group(0) @binding(0) var<storage, read> cells: array<u32>; // Unused but required by binding layout
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var<storage, read> rowFlags: array<u32>; // Unused

struct ChannelState { volume: f32, pan: f32, freq: f32, trigger: u32, noteAge: f32, activeEffect: u32, effectValue: f32, isMuted: u32 };
@group(0) @binding(3) var<storage, read> channels: array<ChannelState>;
@group(0) @binding(4) var buttonsSampler: sampler; // Unused
@group(0) @binding(5) var buttonsTexture: texture_2d<f32>; // Unused

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

// --- VERTEX SHADER ---
@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  // Optimization: Only use instance 0 to draw a single full-screen quad.
  // Discard other instances by outputting degenerate vertices.
  var out: VertexOut;

  if (instanceIndex > 0u) {
    out.position = vec4<f32>(0.0);
    out.uv = vec2<f32>(0.0);
    return out;
  }

  // Standard full-screen quad from 6 vertices
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
  );

  let pos = quad[vertexIndex];
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5; // 0..1 range
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

fn fbm(p: vec2<f32>) -> f32 {
    var v = 0.0;
    var a = 0.5;
    var shift = vec2<f32>(100.0);
    // Rotate to reduce axial bias
    let rot = mat2x2<f32>(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    var p2 = p;
    for (var i = 0; i < 5; i++) {
        v += a * noise(p2);
        p2 = rot * p2 * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

fn palette(t: f32) -> vec3<f32> {
    // Rainbow-ish neon palette
    let a = vec3<f32>(0.5, 0.5, 0.5);
    let b = vec3<f32>(0.5, 0.5, 0.5);
    let c = vec3<f32>(1.0, 1.0, 1.0);
    let d = vec3<f32>(0.00, 0.33, 0.67);
    return a + b * cos(6.28318 * (c * t + d));
}

// Map frequency to color hue
fn freqToColor(freq: f32) -> vec3<f32> {
    // Freq is typically 0..~20000+?
    // Map log freq to 0..1
    let logF = log2(max(freq, 50.0)) - 5.0; // ~50Hz base
    let hue = fract(logF * 0.15);
    return palette(hue);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
    // Normalize coordinates centered at 0
    let uv = (in.uv - 0.5) * 2.0;

    // Polar coordinates
    let r = length(uv);
    let a = atan2(uv.y, uv.x);

    // --- BACKGROUND VORTEX ---
    // Swirling cloud
    let speed = max(uniforms.bpm, 60.0) / 60.0; // Rotations per minute-ish scale
    let time = uniforms.timeSec;

    // Twist factor increases with radius
    let twist = a + 2.0 * log(r + 0.001);
    // Animation
    let cloudMove = time * speed * 0.5;

    // FBM Cloud
    let cloudUV = vec2<f32>(r * 3.0 - cloudMove, twist * 1.0);
    let density = fbm(cloudUV);

    // Darken center, vignetting
    let vignette = smoothstep(1.5, 0.2, r);

    var col = vec3<f32>(0.05, 0.0, 0.1) * density * vignette; // Deep purple/black base

    // Add some subtle spiral arms
    let arms = sin(twist * 3.0 + time) * 0.5 + 0.5;
    col += vec3<f32>(0.1, 0.05, 0.2) * arms * vignette;

    // --- CHANNEL SPLASHES ---
    let numCh = uniforms.numChannels;
    for (var i = 0u; i < numCh; i++) {
        let ch = channels[i];

        // Only process active channels (trigger > 0 or young note)
        // noteAge is in seconds.
        if (ch.noteAge < 2.0 && ch.isMuted == 0u) {

            // Channel Position: Distributed around the circle
            let angle = (f32(i) / f32(numCh)) * 6.28318 - 1.57; // Start at top (-PI/2)

            // Distance from center could be fixed or move out with age?
            // "Splash at one point". Let's put it at a fixed radius, e.g., 0.6
            let radius = 0.6;

            let pos = vec2<f32>(cos(angle), sin(angle)) * radius;

            // Vector from pixel to splash center
            let d = uv - pos;
            let dist = length(d);

            // 1. Core Glow (Exponential decay)
            // Intensity based on noteAge (0 is fresh)
            let ageFactor = exp(-ch.noteAge * 4.0);
            let triggerBoost = f32(ch.trigger) * 0.5; // Flash on exact trigger frame
            let intensity = (ageFactor + triggerBoost) * ch.volume;

            let glow = 0.15 / (dist + 0.05) * intensity;

            // 2. "Fireworks" Particles / Sparkle
            // Use noise based on angle and time to simulate sparks
            let sparkAngle = atan2(d.y, d.x);
            let sparkRad = dist;
            // Expansion: sparks move out over time
            let sparkTime = ch.noteAge * 2.0;
            let sparkNoise = hash12(vec2<f32>(floor(sparkAngle * 10.0), floor(sparkRad * 20.0 - sparkTime * 5.0)));
            let sparks = smoothstep(0.9, 1.0, sparkNoise) * intensity * smoothstep(0.5, 0.0, dist);

            // Color
            var noteColor = freqToColor(ch.freq);
            // Boost brightness for sparks
            let finalSplash = noteColor * (glow + sparks * 3.0);

            // Additive blending
            col += finalSplash;
        }
    }

    return vec4<f32>(col, 1.0);
}
