// patternv0.43.wgsl
// Horizontal 32-Step – Chassis Background + Column Playhead Wash
//
// This shader draws ONLY the background chassis grid and the playhead
// highlight wash (ambient LED glow leaking up through the chassis tracks).
// Frosted glass caps and note data are rendered by the WebGL2 overlay.
//
// Playhead = a vertical column stripe that advances through the 32 steps.
// Trailing glow fades exponentially behind the active column.

struct Uniforms {
  numRows: u32,
  numChannels: u32,
  playheadRow: f32,
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
  dimFactor: f32,
  // Grid bounds (must match WebGL overlay for pixel-perfect alignment)
  gridInsetX: f32,
  gridInsetY: f32,
  gridWidth: f32,
  gridHeight: f32,
};

// Bindings kept for interface compatibility; not read in this shader.
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var<storage, read> rowFlags: array<u32>;

struct ChannelState {
  volume: f32, pan: f32, freq: f32, trigger: u32,
  noteAge: f32, activeEffect: u32, effectValue: f32, isMuted: u32
};
@group(0) @binding(3) var<storage, read> channels: array<ChannelState>;
@group(0) @binding(4) var buttonsSampler: sampler;
@group(0) @binding(5) var buttonsTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vIdx: u32, @builtin(instance_index) iIdx: u32) -> VertexOut {
  // Full-screen quad; discard extra instances
  if (iIdx > 0u) {
    return VertexOut(vec4<f32>(0.0), vec2<f32>(0.0));
  }
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
  );
  var out: VertexOut;
  out.position = vec4<f32>(pos[vIdx], 0.0, 1.0);
  out.uv = pos[vIdx] * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv        = in.uv;
  let dimFactor = uniforms.dimFactor;

  // ── Chassis base colour ───────────────────────────────────────────────────
  // Dark panel, slightly lighter than pure black so grid lines read against it
  var col = vec3<f32>(0.042, 0.046, 0.058);

  let gridLeft   = uniforms.gridInsetX;
  let gridTop    = uniforms.gridInsetY;
  let gridRight  = uniforms.gridInsetX + uniforms.gridWidth;
  let gridBottom = uniforms.gridInsetY + uniforms.gridHeight;

  let nCols = 32.0;

  if (uv.x > gridLeft && uv.x < gridRight && uv.y > gridTop && uv.y < gridBottom) {
    // Normalise to [0,1] within the grid rectangle
    let localUV = vec2<f32>(
      (uv.x - gridLeft) / uniforms.gridWidth,
      (uv.y - gridTop)  / uniforms.gridHeight
    );

    let stepF    = localUV.x * nCols;
    let stepId   = floor(stepF);

    // Active column: integer part of playheadRow, wrapped to page length
    let activeStep = floor(uniforms.playheadRow) - floor(uniforms.playheadRow / nCols) * nCols;

    // ── Playhead Column Highlight ─────────────────────────────────────────
    // Smooth step-distance check; colHighlight peaks at 1.0 on the active column.
    let stepDist     = abs(stepId - activeStep);
    let colHighlight = 1.0 - smoothstep(0.0, 1.2, stepDist);

    // ── Trailing Glow ─────────────────────────────────────────────────────
    // Columns recently passed by the playhead emit a residual blue glow that
    // fades exponentially with distance (like phosphor persistence).
    // stepsBehind = how many steps BEHIND the playhead this column is (0..nCols-1).
    let stepsBehind = fract((activeStep - stepId) / nCols) * nCols;
    let trailGlow   = select(
      0.0,
      exp(-stepsBehind * 0.55),
      stepsBehind > 0.001 && stepsBehind < 10.0
    );

    // ── Cell Separator Grid Lines ─────────────────────────────────────────
    let nRows   = f32(uniforms.numChannels);
    let cellUV  = fract(localUV * vec2<f32>(nCols, nRows));
    let lineX   = 1.0 - smoothstep(0.0, 0.04, cellUV.x);
    let lineY   = 1.0 - smoothstep(0.0, 0.04, cellUV.y);
    let gridLine = max(lineX, lineY);

    // Panel interior (slightly brighter than chassis edge)
    col = vec3<f32>(0.055, 0.060, 0.078);

    // Carve grid lines into the panel surface (subtract light)
    col -= vec3<f32>(0.028) * gridLine;

    // ── Ambient LED leak – playhead column ───────────────────────────────
    // Simulate light leaking up from beneath the chassis at the playhead track.
    // Uses smoothstep-based soft wash as per the art direction.
    let kickBoost   = 1.0 + uniforms.kickTrigger * 0.45;
    let playBlue    = vec3<f32>(0.06, 0.30, 0.90);
    col += playBlue * colHighlight * 0.60 * kickBoost;

    // Beat-sync brighten on the exact active column center (tighter hotspot)
    let columnCentreDist = abs(stepF - activeStep - 0.5);
    let centrePeak = exp(-columnCentreDist * columnCentreDist * 8.0);
    col += playBlue * centrePeak * colHighlight * 0.30 * kickBoost;

    // ── Trailing sweep (warm-to-cool residual glow) ───────────────────────
    col += vec3<f32>(0.03, 0.14, 0.45) * trailGlow * 0.35;

    // ── Inner vignette at grid edges ──────────────────────────────────────
    let vignX = smoothstep(0.0, 0.04, localUV.x) * smoothstep(0.0, 0.04, 1.0 - localUV.x);
    let vignY = smoothstep(0.0, 0.04, localUV.y) * smoothstep(0.0, 0.04, 1.0 - localUV.y);
    col *= 0.82 + 0.18 * vignX * vignY;
  }

  // ── Noise / dither ────────────────────────────────────────────────────────
  let noise = fract(sin(dot(in.uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  col += (noise - 0.5) * 0.008;

  return vec4<f32>(col * dimFactor, 1.0);
}
