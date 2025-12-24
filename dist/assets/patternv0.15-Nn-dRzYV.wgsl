// filepath: g:\github\react-dom\shaders\patternv0.14.wgsl
// Horizontal Pattern Grid Shader (Time = X, Channels = Y)
// V3.1: "Space Diamonds" - Fixed variable mutability

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
  pad3: u32,
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
  @location(0) @interpolate(flat) row: u32,
  @location(1) @interpolate(flat) channel: u32,
  @location(2) @interpolate(linear) uv: vec2<f32>,
  @location(3) @interpolate(flat) packedA: u32, // Note/Inst
  @location(4) @interpolate(flat) packedB: u32, // Vol/Effect/Param
};

// --- VERTEX SHADER ---
@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  let px = f32(row) * uniforms.cellW;
  let py = f32(channel) * uniforms.cellH;

  let lp = quad[vertexIndex];
  let worldX = px + lp.x * uniforms.cellW;
  let worldY = py + lp.y * uniforms.cellH;

  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;

  let idx = instanceIndex * 2u;
  let a = cells[idx];
  let b = cells[idx + 1u];

  var out: VertexOut;
  out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
  out.row = row;
  out.channel = channel;
  out.uv = lp;
  out.packedA = a;
  out.packedB = b;
  return out;
}

// --- FRAGMENT SHADER HELPERS ---

fn neonPalette(t: f32) -> vec3<f32> {
    let a = vec3<f32>(0.5, 0.5, 0.5);
    let b = vec3<f32>(0.5, 0.5, 0.5);
    let c = vec3<f32>(1.0, 1.0, 1.0);
    let d = vec3<f32>(0.263, 0.416, 0.557);
    return a + b * cos(6.28318 * (c * t + d));
}

fn toUpperAscii(code: u32) -> u32 {
    return select(code, code - 32u, (code >= 97u) & (code <= 122u));
}

fn pitchClassFromPacked(packed: u32) -> f32 {
    let c0 = toUpperAscii((packed >> 24) & 255u);
    var semitone: i32 = 0;
    var valid = true;
    switch c0 {
        case 65u: { semitone = 9; }
        case 66u: { semitone = 11; }
        case 67u: { semitone = 0; }
        case 68u: { semitone = 2; }
        case 69u: { semitone = 4; }
        case 70u: { semitone = 5; }
        case 71u: { semitone = 7; }
        default: { valid = false; }
    }
    if (!valid) { return 0.0; }
    let c1 = toUpperAscii((packed >> 16) & 255u);
    if ((c1 == 35u) || (c1 == 43u)) {
        semitone = (semitone + 1) % 12;
    } else if (c1 == 66u) {
        semitone = (semitone + 11) % 12;
    }
    return f32(semitone) / 12.0;
}

// --- Lens Flare Function ---
fn diamondFlare(uv: vec2<f32>, color: vec3<f32>, intensity: f32, time: f32) -> vec3<f32> {
    // Center coordinates
    let p = uv - 0.5;

    // 1. Core Glow (Soft Sphere)
    let d = length(p);
    // Inverse falloff for very bright core, fading quickly
    let core = 0.03 / (d + 0.01);

    // 2. Diamond Rays
    // Rotate 45 degrees to get the 'X' shape of a diamond reflection
    let rot = 0.785398;
    let c = cos(rot);
    let s = sin(rot);
    let rp = vec2<f32>(p.x * c - p.y * s, p.x * s + p.y * c);

    // Create rays using hyperbolic falloff 1/(|x|*|y|)
    // Adding a small epsilon prevents division by zero
    let rays = 0.002 / (abs(rp.x * rp.y) + 0.002);

    // 3. Subtle Twinkle
    // Randomize phase based on position so they don't all blink perfectly in sync
    let twinkle = 0.9 + 0.2 * sin(time * 3.0 + p.x * 10.0);

    // Combine
    let light = (core + rays) * intensity * twinkle;

    // Apply color, but allow the center to blow out to white (Hot center)
    let finalCol = mix(color, vec3<f32>(1.0), clamp(light * 0.5 - 0.5, 0.0, 1.0));

    return finalCol * light;
}

// Effects Logic (Simplified for this version)
fn effectColorFromCode(code: u32, fallback: vec3<f32>) -> vec3<f32> {
    let c = toUpperAscii(code & 255u);
    switch c {
        case 49u: { return vec3<f32>(0.2, 0.85, 0.4); }
        case 50u: { return vec3<f32>(0.85, 0.3, 0.3); }
        case 52u: { return vec3<f32>(0.4, 0.7, 1.0); }
        case 55u: { return vec3<f32>(0.9, 0.6, 0.2); }
        case 65u: { return vec3<f32>(0.95, 0.9, 0.25); }
        default: { return fallback; }
    }
}

struct FragmentConstants {
  borderColor: vec3<f32>,
  borderThickness: f32,
};

fn getFragmentConstants() -> FragmentConstants {
    var c: FragmentConstants;
    c.borderColor = vec3<f32>(0.1, 0.1, 0.12);
    c.borderThickness = 1.0;
    return c;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();

  // --- 1. BACKGROUND (Darkness of Space) ---
  // Sample the button texture but darken it significantly to make lights pop
  let tiledUV = in.uv;
  var finalColor = textureSample(buttonsTexture, buttonsSampler, tiledUV).rgb;
  finalColor *= 0.15; // Deep dark background

  // --- 2. UNPACK DATA ---
  let noteChar = (in.packedA >> 24) & 255u;
  let inst = in.packedA & 255u;
  let effCode = (in.packedB >> 8) & 255u;
  let effParam = in.packedB & 255u;
  let hasNote = (noteChar >= 65u && noteChar <= 71u);
  let hasEffect = (effParam > 0u);
  let ch = channels[in.channel];

  // --- 3. NOTE INDICATOR (Diamond Flare) ---
  if (hasNote) {
      let pitchHue = pitchClassFromPacked(in.packedA);
      let base_note_color = neonPalette(pitchHue);

      // Octave brightness mod
      let octaveChar = (in.packedA >> 8) & 255u;
      let octaveF = f32(octaveChar) - 48.0;
      let octaveDelta = clamp(octaveF, 1.0, 8.0) - 4.0;
      let octaveBrightness = 1.0 + octaveDelta * 0.2;

      // Trigger flash (when note is played)
      let triggerFlash = f32(ch.trigger) * 2.0; // Extra burst on trigger

      // Calculate visual intensity based on volume and decay
      let noteTrail = exp(-ch.noteAge * 3.0);
      let activeGlow = noteTrail * 1.5;

      // Total Intensity
      let intensity = (0.6 * octaveBrightness) + triggerFlash + activeGlow;

      // Generate the Lens Flare
      // We use the channel volume to scale the size slightly
      let flareSize = intensity * clamp(ch.volume, 0.2, 1.2);

      let flare = diamondFlare(in.uv, base_note_color, flareSize, uniforms.timeSec);

      // Additive blending for light effect
      finalColor += flare;
  }

  // --- 4. PLAYHEAD / PROXIMITY ---
  let rowDistance = abs(i32(in.row) - i32(uniforms.playheadRow));

  // If on playhead but no note, subtle blue glow
  if (rowDistance == 0) {
      if (!hasNote) {
          // A faint "guide star" or cursor light
          let guideCol = vec3<f32>(0.2, 0.3, 0.5);
          let guideFlare = diamondFlare(in.uv, guideCol, 0.3, uniforms.timeSec);
          finalColor += guideFlare * 0.5;
      }
      // Add a vertical beam for the playhead
      let beam = smoothstep(0.45, 0.0, abs(in.uv.x - 0.5));
      finalColor += vec3<f32>(0.05, 0.08, 0.12) * beam;
  }

  // Neighbor rows (subtle hint)
  if (rowDistance == 1) {
     finalColor += vec3<f32>(0.02, 0.02, 0.03);
  }

  // --- 5. EFFECT INDICATOR (Smaller flares at bottom) ---
  if (hasEffect) {
      let effColor = effectColorFromCode(effCode, vec3<f32>(0.8, 0.8, 0.8));
      var effUV = in.uv;
      effUV.y -= 0.35; // Shift center down
      // Smaller, sharper flare for effects
      let effFlare = diamondFlare(effUV, effColor, 0.4, uniforms.timeSec + 10.0);
      finalColor += effFlare;
  }

  // --- 6. BORDERS ---
  // Very faint border to define the grid in the darkness
  let uv_aa = vec2<f32>(fwidth(in.uv.x), fwidth(in.uv.y));
  let borderX = smoothstep(1.0 - (fs.borderThickness * uv_aa.x), 1.0, in.uv.x);
  let borderY = smoothstep(1.0 - (fs.borderThickness * uv_aa.y), 1.0, in.uv.y);
  let borderAlpha = max(borderX, borderY);

  finalColor = mix(finalColor, fs.borderColor, borderAlpha * 0.3); // Transparent borders

  return vec4<f32>(finalColor, 1.0);
}