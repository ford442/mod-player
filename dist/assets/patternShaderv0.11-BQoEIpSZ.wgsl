// Horizontal Pattern Grid Shader (Time = X, Channels = Y)

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

// "Cosine based palette" for rich, neon colors
// https://iquilezles.org/articles/palettes/
fn neonPalette(t: f32) -> vec3<f32> {
    let a = vec3<f32>(0.5, 0.5, 0.5);
    let b = vec3<f32>(0.5, 0.5, 0.5);
    let c = vec3<f32>(1.0, 1.0, 1.0);
    let d = vec3<f32>(0.263, 0.416, 0.557); // Technicolor phase
    return a + b * cos(6.28318 * (c * t + d));
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  // Decode
  let noteChar = (in.packedA >> 24) & 255u;
  let inst = in.packedA & 255u;
  let hasNote = (noteChar > 0u);
  let hasEffect = (in.packedB > 0u);

  // 1. Background - Darker, cooler "Tech" grey
  var color = vec3<f32>(0.05, 0.05, 0.07);

  // Alternating channel stripes for readability (horizontal bands)
  if (in.channel % 2u == 0u) {
      color = color * 0.8;
  }

  // 2. Playhead Highlight (Vertical Beam)
  if (in.row == uniforms.playheadRow) {
      // Add a subtle vertical gradient beam
      color = mix(color, vec3<f32>(0.2, 0.25, 0.3), 0.5);
  }

  // 3. Render Note (The "Pill" or "LED")
  if (hasNote) {
      // Generate Neon Color based on Instrument ID
      // We add a bit of time/position variation to make it feel "alive" if you want,
      // but keeping it static per instrument is better for recognition.
      let hue = f32(inst) * 0.123;
      let noteColor = neonPalette(hue);

      // Shape: Rounded box centered in UV space (0.5, 0.5)
      let center = in.uv - 0.5;
      // Make box width vary by note presence? Or just fixed.
      let boxDist = sdRoundedBox(center, vec2<f32>(0.35, 0.25), 0.1);

      // Soft glow edge
      let alpha = 1.0 - smoothstep(0.0, 0.05, boxDist);
      let glow = exp(-boxDist * 8.0) * 0.6; // Outer glow halo

      // Combine
      let intensity = 1.2; // Overdrive for "HDR" look
      color = mix(color, noteColor * intensity, clamp(alpha + glow, 0.0, 1.0));
  }

  // 4. Render Effect Indicator (Small dot or underline)
  if (hasEffect) {
     // Draw a small indicator at the bottom of the cell
     let effectDist = distance(in.uv, vec2<f32>(0.5, 0.85));
     let effectAlpha = 1.0 - smoothstep(0.05, 0.06, effectDist);
     color = mix(color, vec3<f32>(0.8, 0.8, 0.8), effectAlpha * 0.8);
  }

  // 5. Grid/Border
  // Use UVs for a thin, sharp border
  let borderThick = 0.02;
  let borderX = step(1.0 - borderThick, in.uv.x); // Right edge
  let borderY = step(1.0 - borderThick, in.uv.y); // Bottom edge
  let borderColor = vec3<f32>(0.15, 0.15, 0.2);

  // Highlight the playhead column border brightly
  if (in.row == uniforms.playheadRow) {
      color = mix(color, vec3<f32>(1.0, 0.8, 0.0), borderX * 0.8); // Gold line
  } else {
      color = mix(color, borderColor, max(borderX, borderY));
  }

  return vec4<f32>(color, 1.0);
}