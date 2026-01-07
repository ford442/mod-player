
// patternv0.39.wgsl
// Horizontal Paged Grid Shader (Time = X, Channels = Y)
// Base: v0.21 (Precision Interface)
// Adapted for WebGL2 Glass Overlay + Square Bezel Layout (1024x1024)

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
  bloomIntensity: f32,
  bloomThreshold: f32,
  invertChannels: u32,
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
  @location(3) @interpolate(flat) packedA: u32,
  @location(4) @interpolate(flat) packedB: u32,
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

  // Horizontal Layout: X = Row (Time), Y = Channel
  // Static Paged Grid: We only render active page of 32 steps.

  let stepsPerPage = 32.0;
  let pageStart = floor(f32(uniforms.playheadRow) / stepsPerPage) * stepsPerPage;

  // Calculate row local to current page (0..31)
  let localRow = f32(row) - pageStart;

  // X Position based on local row
  let px = localRow * uniforms.cellW;
  let py = f32(channel) * uniforms.cellH;

  // If this instance is NOT in the current page, we move it off-screen to clip it
  var isVisible = 1.0;
  if (localRow < 0.0 || localRow >= stepsPerPage) {
      isVisible = 0.0;
  }

  // Standard quad expansion
  // Note: if invisible, we can just collapse quad or move off screen
  let worldX = px + quad[vertexIndex].x * uniforms.cellW;
  let worldY = py + quad[vertexIndex].y * uniforms.cellH;

  // Use top-left origin for logic, but clip space is -1..1
  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;

  // Collapse if not visible
  let finalPos = select(vec4<f32>(0.0), vec4<f32>(clipX, clipY, 0.0, 1.0), isVisible > 0.5);

  let idx = instanceIndex * 2u;
  let a = cells[idx];
  let b = cells[idx + 1u];

  var out: VertexOut;
  out.position = finalPos;
  out.row = row;
  out.channel = channel;
  out.uv = quad[vertexIndex];
  out.packedA = a;
  out.packedB = b;
  return out;
}

// --- FRAGMENT SHADER (Precision Interface) ---

fn neonPalette(t: f32) -> vec3<f32> {
    let a = vec3<f32>(0.5, 0.5, 0.5);
    let b = vec3<f32>(0.5, 0.5, 0.5);
    let c = vec3<f32>(1.0, 1.0, 1.0);
    let d = vec3<f32>(0.0, 0.33, 0.67);
    return a + b * cos(6.28318 * (c * t + d));
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

struct FragmentConstants {
  bgColor: vec3<f32>,
  ledOnColor: vec3<f32>,
  ledOffColor: vec3<f32>,
  borderColor: vec3<f32>,
};

fn getFragmentConstants() -> FragmentConstants {
    var c: FragmentConstants;
    c.bgColor = vec3<f32>(0.10, 0.11, 0.13);
    c.ledOnColor = vec3<f32>(0.0, 0.85, 0.95);
    c.ledOffColor = vec3<f32>(0.08, 0.12, 0.15);
    c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
    return c;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.75;

  // --- HEADER ROW (Channel 0) ---
  if (in.channel == 0u) {
      // Header for channel indices or status
      var col = fs.bgColor * 0.8;
      return vec4<f32>(col, 1.0);
  }

  // --- PATTERN GRID ---
  // Simple machine slots
  let dBox = sdRoundedBox(p, vec2<f32>(0.45, 0.40), 0.05);
  var col = fs.bgColor;

  // Inset shadow
  col *= smoothstep(0.0, 0.1, dBox + 0.5);

  let onPlayhead = (in.row == uniforms.playheadRow);

  // Active Note
  let note = (in.packedA >> 24) & 255u;
  let hasNote = note > 0u;

  if (hasNote) {
      let noteCol = neonPalette(f32(note % 12u) / 12.0);
      let dist = length(p);
      let glow = exp(-dist * 4.0);
      col += noteCol * glow * 1.5;
  }

  // Playhead Highlight (Vertical Line across active column)
  if (onPlayhead) {
      // Additive highlight
      col += vec3<f32>(0.2, 0.2, 0.25) * 0.8;
  }

  // Border
  col = mix(col, fs.borderColor, smoothstep(0.0, aa, dBox));

  return vec4<f32>(col, 1.0);
}
