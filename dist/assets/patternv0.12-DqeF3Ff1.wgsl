// Horizontal Pattern Grid Shader (Time = X, Channels = Y)
// V2: Refactored by "Custom Coding partner" to use fwidth() for AA
// and a constants struct for easier tweaking.

struct Uniforms {
  numRows: u32,
  numChannels: u32,
  playheadRow: u32,
  pad: u32,
  cellW: f32,
  cellH: f32,
  canvasW: f32,
  canvasH: f32,
};

@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) row: u32,
  @location(1) @interpolate(flat) channel: u32,

  // --- FIX ---
  // Added @interpolate(linear).
  // All floating-point values passed from vertex to fragment
  // MUST specify an interpolation type (e.g., linear, flat, perspective).
  @location(2) @interpolate(linear) uv: vec2<f32>,
  // -----------

  @location(3) @interpolate(flat) packedA: u32, // Note/Inst
  @location(4) @interpolate(flat) packedB: u32, // Vol/Effect/Param
};

// --- VERTEX SHADER (Unchanged) ---
// This was already solid. No changes needed.
@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  // --- ORIENTATION FLIP ---
  // Horizontal Layout: Row increases X, Channel increases Y
  let px = f32(row) * uniforms.cellW;
  let py = f32(channel) * uniforms.cellH;

  let lp = quad[vertexIndex];
  let worldX = px + lp.x * uniforms.cellW;
  let worldY = py + lp.y * uniforms.cellH;

  // Convert to clip space
  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;

  // Read packed data (2 u32s per cell)
  let idx = instanceIndex * 2u;
  let a = cells[idx];      // Note/Instrument
  let b = cells[idx + 1u]; // Effects

  var out: VertexOut;
  out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
  out.row = row;
  out.channel = channel;
  out.uv = lp;
  out.packedA = a;
  out.packedB = b;
  return out;
}

// --- FRAGMENT SHADER ---

// "Cosine based palette" for rich, neon colors
// https://iquilezles.org/articles/palettes/
fn neonPalette(t: f32) -> vec3<f32> {
    let a = vec3<f32>(0.5, 0.5, 0.5);
    let b = vec3<f32>(0.5, 0.5, 0.5);
    let c = vec3<f32>(1.0, 1.0, 1.0);
    let d = vec3<f32>(0.263, 0.416, 0.557); // Technicolor phase
    return a + b * cos(6.28318 * (c * t + d));
}

// SDF for a Rounded Box
fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// --- CHANGE ---
// We've moved all the "magic numbers" for styling into this one
// struct. Now you can tweak the appearance from one central place!
struct FragmentConstants {
  // Background
  bgColorA: vec3<f32>,
  bgColorB: vec3<f32>,
  playheadBeamColor: vec3<f32>,
  playheadBeamIntensity: f32,

  // Note Pill
  pillSize: vec2<f32>,
  pillRadius: f32,
  noteIntensity: f32,
  glowFalloff: f32,
  glowIntensity: f32,
  hueMagic: f32,

  // Effect Dot
  effectPos: vec2<f32>,
  effectRadius: f32,
  effectColor: vec3<f32>,
  effectIntensity: f32,

  // Borders
  borderColor: vec3<f32>,
  playheadBorderColor: vec3<f32>,
  playheadBorderIntensity: f32,
  borderThickness: f32, // --- NOTE: This is now a 1.0-pixel-based thickness
};

// --- CHANGE ---
// Initialize all our styling constants.
// This function acts like a "constructor" for the struct.
fn getFragmentConstants() -> FragmentConstants {
    var c: FragmentConstants;

    // Background
    c.bgColorA = vec3<f32>(0.05, 0.05, 0.07);
    c.bgColorB = vec3<f32>(0.04, 0.04, 0.056); // 0.8 * bgColorA
    c.playheadBeamColor = vec3<f32>(0.2, 0.25, 0.3);
    c.playheadBeamIntensity = 0.5;

    // Note Pill
    c.pillSize = vec2<f32>(0.35, 0.25); // (width, height) in UV space
    c.pillRadius = 0.1;
    c.noteIntensity = 1.2;
    c.glowFalloff = 8.0;   // For exp() glow
    c.glowIntensity = 0.6;
    c.hueMagic = 0.123;  // Magic number for instrument hue separation

    // Effect Dot
    c.effectPos = vec2<f32>(0.5, 0.85); // UV position
    c.effectRadius = 0.05;
    c.effectColor = vec3<f32>(0.8, 0.8, 0.8);
    c.effectIntensity = 0.8;

    // Borders
    c.borderColor = vec3<f32>(0.15, 0.15, 0.2);
    c.playheadBorderColor = vec3<f32>(1.0, 0.8, 0.0);
    c.playheadBorderIntensity = 0.8;
    c.borderThickness = 1.0; // Draw a 1.0 pixel thick border

    return c;
}


@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  // --- CHANGE ---
  // Get all our styling constants
  let fs = getFragmentConstants();

  // Decode
  let noteChar = (in.packedA >> 24) & 255u;
  let inst = in.packedA & 255u;
  let hasNote = (noteChar > 0u);
  let hasEffect = (in.packedB > 0u);

  // 1. Background
  var color = fs.bgColorA;

  // Alternating channel stripes
  if (in.channel % 2u == 0u) {
      color = fs.bgColorB;
  }

  // 2. Playhead Highlight
  if (in.row == uniforms.playheadRow) {
      color = mix(color, fs.playheadBeamColor, fs.playheadBeamIntensity);
  }

  // Precompute SDFs and AA for all elements unconditionally
  let center = in.uv - 0.5;
  let pillSDF = sdRoundedBox(center, fs.pillSize, fs.pillRadius);
  let pill_aa = fwidth(pillSDF) * 0.5;

  let effectSDF = distance(in.uv, fs.effectPos) - fs.effectRadius;
  let effect_aa = fwidth(effectSDF) * 0.5;

  // 3. Render Note (The "Pill")
  if (hasNote) {
      let hue = f32(inst) * fs.hueMagic;
      let noteColor = neonPalette(hue);

      // Use precomputed pill_aa
      let pillShape = 1.0 - smoothstep(-pill_aa, pill_aa, pillSDF);

      // Your original glow logic, just using constants
      let glow = exp(-pillSDF * fs.glowFalloff) * fs.glowIntensity;

      // Combine
      color = mix(color, noteColor * fs.noteIntensity, clamp(pillShape + glow, 0.0, 1.0));
  }

  // 4. Render Effect Indicator
  if (hasEffect) {
     // Use precomputed effect_aa
     let effectShape = 1.0 - smoothstep(-effect_aa, effect_aa, effectSDF);

     color = mix(color, fs.effectColor, effectShape * fs.effectIntensity);
  }

  // 5. Grid/Border

  // --- CHANGE ---
  // Get screen-space derivatives of UVs.
  // This tells us how much one pixel changes the UV.
  // We use this to draw a perfect 1-pixel border.
  let uv_aa = vec2<f32>(fwidth(in.uv.x), fwidth(in.uv.y));

  // --- CHANGE ---
  // Use smoothstep to draw the 1px antialiased border.
  // We subtract our desired thickness (in pixels) * the derivative
  let borderX = smoothstep(1.0 - (fs.borderThickness * uv_aa.x), 1.0, in.uv.x);
  let borderY = smoothstep(1.0 - (fs.borderThickness * uv_aa.y), 1.0, in.uv.y);
  let borderAlpha = max(borderX, borderY);

  // Highlight the playhead column border
  if (in.row == uniforms.playheadRow) {
      let playheadBorder = borderX * fs.playheadBorderIntensity; // Only highlight vertical border
      color = mix(color, fs.playheadBorderColor, playheadBorder);
      color = mix(color, fs.borderColor, borderY); // Draw normal horizontal border
  } else {
      color = mix(color, fs.borderColor, borderAlpha);
  }

  return vec4<f32>(color, 1.0);
}