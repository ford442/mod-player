// patternv0.46.wgsl
// Circular 64-Step – Transparent Chassis Overlay + Radial Playhead Glow
//
// This shader renders TRANSPARENT cells that sit on top of the bezel.wgsl
// hardware photo background.  The cell body is alpha=0 so the bezel shows
// through everywhere.  Only the playhead glow and trailing sweep add any
// colour, as a semi-transparent wash of light across the ring at the active
// step angle.
//
// Architecture: Per-instance instanced rendering (one quad per step × channel).
// Alpha blending is enabled by PatternDisplay.tsx for this shader.

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
  @location(0) @interpolate(flat)   row:     u32,
  @location(1) @interpolate(flat)   channel: u32,
  @location(2) @interpolate(linear) uv:      vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row         = instanceIndex / numChannels;
  let channel     = instanceIndex % numChannels;

  // Cull instances outside current 64-step page
  let pageStart = u32(uniforms.playheadRow / 64.0) * 64u;
  let isVisible = row >= pageStart && row < pageStart + 64u;

  let invertedChannel = numChannels - 1u - channel;
  let ringIndex = select(invertedChannel, channel, uniforms.invertChannels == 1u);

  let center    = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let minDim    = min(uniforms.canvasW, uniforms.canvasH);
  let maxRadius = minDim * 0.45;
  let minRadius = minDim * 0.15;
  let ringDepth = (maxRadius - minRadius) / f32(numChannels);
  let radius    = minRadius + f32(ringIndex) * ringDepth;

  let totalSteps   = 64.0;
  let anglePerStep = 6.2831853 / totalSteps;
  let theta        = -1.570796 + f32(row % 64u) * anglePerStep;

  let circumference = 2.0 * 3.14159265 * radius;
  let arcLength     = circumference / totalSteps;
  let btnW          = arcLength * 0.95;
  let btnH          = ringDepth * 0.95;

  let lp       = quad[vertexIndex];
  let localPos = (lp - vec2<f32>(0.5)) * vec2<f32>(btnW, btnH);

  let rotAng = theta + 1.570796;
  let cA = cos(rotAng); let sA = sin(rotAng);
  let rotX = localPos.x * cA - localPos.y * sA;
  let rotY = localPos.x * sA + localPos.y * cA;

  let worldX = center.x + cos(theta) * radius + rotX;
  let worldY = center.y + sin(theta) * radius + rotY;

  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;

  let finalPos = select(vec4<f32>(0.0), vec4<f32>(clipX, clipY, 0.0, 1.0), isVisible);

  var out: VertexOut;
  out.position = finalPos;
  out.row      = row;
  out.channel  = channel;
  out.uv       = lp;
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p  = uv - vec2<f32>(0.5);

  if (in.channel >= uniforms.numChannels) { return vec4<f32>(0.0); }

  // NOTE: Early discard moved to after derivative computation to avoid undefined behavior in fwidth()

  // ── Playhead proximity ────────────────────────────────────────────────────
  let totalSteps   = 64.0;
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / totalSteps) * totalSteps;
  let rowF         = f32(in.row % 64u);
  let rowDistRaw   = abs(rowF - playheadStep);
  let rowDist      = min(rowDistRaw, totalSteps - rowDistRaw);
  let playheadHit  = 1.0 - smoothstep(0.0, 2.0, rowDist);

  // Clip UI strip at bottom of canvas — SAFE HERE after derivatives computed
  if (in.position.y > uniforms.canvasH * 0.88) { discard; }

  // ── Trailing sweep ────────────────────────────────────────────────────────
  let stepsBehind = fract((playheadStep - rowF) / totalSteps) * totalSteps;
  let trailGlow   = select(
    0.0,
    exp(-stepsBehind * 0.40),
    stepsBehind > 0.001 && stepsBehind < 14.0
  );

  // ── Transparent base — bezel.png shows through ────────────────────────────
  var glowColor = vec3<f32>(0.0);
  var glowAlpha = 0.0;

  // Playhead wash: soft blue ambient wash that sweeps around the ring
  let kickBoost = 1.0 + uniforms.kickTrigger * 0.5;
  let playBlue  = vec3<f32>(0.06, 0.32, 0.95);

  if (playheadHit > 0.01) {
    // Radial falloff within the cell (brighter at centre)
    let centreDist  = length(p);
    let centreBoost = exp(-centreDist * centreDist * 5.0);
    let wash        = playheadHit * (0.65 + centreBoost * 0.35) * kickBoost;
    glowColor += playBlue * wash;
    glowAlpha  = max(glowAlpha, playheadHit * 0.72);
  }

  // Trailing sweep (warm residual glow)
  if (trailGlow > 0.01) {
    glowColor += vec3<f32>(0.03, 0.16, 0.50) * trailGlow * 0.45;
    glowAlpha  = max(glowAlpha, trailGlow * 0.38);
  }

  // ── Edge accent at exact playhead position ────────────────────────────────
  if (rowDist < 0.5) {
    let rimFrac  = 1.0 - rowDist * 2.0;
    let edgeDist = length(p) - 0.44; // distance from cell boundary
    let edgeGlow = smoothstep(0.05, 0.0, abs(edgeDist)) * rimFrac * 0.5;
    glowColor += vec3<f32>(0.2, 0.55, 1.0) * edgeGlow;
    glowAlpha  = max(glowAlpha, edgeGlow * 0.6);
  }

  // Apply dimFactor
  glowColor *= uniforms.dimFactor;
  glowAlpha *= uniforms.dimFactor;

  // Completely transparent when not near playhead — bezel shows through
  return vec4<f32>(glowColor, clamp(glowAlpha, 0.0, 1.0));
}
