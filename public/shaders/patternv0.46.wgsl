// patternv0.46.wgsl
// Circular 64-Step – Chassis Background + Radial Playhead Glow
//
// This shader draws ONLY the background chassis housing for each cell and a
// radial playhead highlight wash (ambient LED glow leaking through the chassis
// at the active step angle, with an exponential trailing sweep).
// Frosted glass caps and note data are rendered by the WebGL2 overlay.
//
// Architecture: Per-instance instanced rendering (one quad per step × channel).
// The fragment uses in.row to compute playhead proximity.

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
  // dimFactor added to match PatternDisplay.tsx uniform payload layout
  dimFactor: f32,
};

// Bindings kept for interface compatibility.
// cells/channels are read in the vertex stage only for layout; not used here.
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

  // Cull instances outside the current 64-step page to prevent z-fighting
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

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p  = uv - vec2<f32>(0.5);
  let aa = fwidth(p.y) * 0.5;

  if (in.channel >= uniforms.numChannels) { return vec4<f32>(0.0); }

  // Clip UI strip at bottom of canvas
  if (in.position.y > uniforms.canvasH * 0.88) { discard; }

  // ── Playhead proximity (smooth, wraps around 64-step page) ────────────────
  let totalSteps    = 64.0;
  let playheadStep  = uniforms.playheadRow - floor(uniforms.playheadRow / totalSteps) * totalSteps;
  let rowF          = f32(in.row % 64u);
  let rowDistRaw    = abs(rowF - playheadStep);
  let rowDist       = min(rowDistRaw, totalSteps - rowDistRaw);

  // Primary: bright band at the active step (all rings glow together → radial line)
  let playheadHit   = 1.0 - smoothstep(0.0, 2.0, rowDist);

  // ── Trailing sweep: steps recently passed emit residual glow ──────────────
  // stepsBehind = how many steps BEHIND the playhead this instance is (0..63)
  let stepsBehind   = fract((playheadStep - rowF) / totalSteps) * totalSteps;
  let trailGlow     = select(
    0.0,
    exp(-stepsBehind * 0.40),
    stepsBehind > 0.001 && stepsBehind < 14.0
  );

  // ── Housing base colour ───────────────────────────────────────────────────
  // Dark rounded housing for each cell; this is what shows between the caps.
  let bgColor = vec3<f32>(0.06, 0.07, 0.09);
  var finalColor = bgColor;

  // Subtle rounded housing mask: slightly brighter centre to suggest depth
  let dHousing = sdRoundedBox(p, vec2<f32>(0.46), 0.06);
  let housingFade = 1.0 - smoothstep(-0.08, 0.0, dHousing);
  finalColor += vec3<f32>(0.012) * housingFade;

  // ── Ambient LED leak – radial playhead wash ───────────────────────────────
  // Simulates light from the active step's LED leaking up through the chassis
  // around the ring, forming a soft radial glow arc at the playhead angle.
  let kickBoost = 1.0 + uniforms.kickTrigger * 0.5;
  let playBlue  = vec3<f32>(0.06, 0.32, 0.95);

  // Global wash: all rings at the playhead step glow uniformly
  finalColor += playBlue * playheadHit * 0.65 * kickBoost;

  // Centre hotspot: brighter at the button centre, fades toward edges
  let centreDist = length(p);
  let centreGlow = exp(-centreDist * centreDist * 6.0) * playheadHit;
  finalColor += playBlue * centreGlow * 0.50 * kickBoost;

  // ── Trailing sweep (warm-to-cool residual glow) ───────────────────────────
  finalColor += vec3<f32>(0.03, 0.16, 0.50) * trailGlow * 0.40;

  // ── Edge brightening at playhead (radial line accent) ─────────────────────
  // When directly on the playhead, the physical rim of the housing catches more
  // ambient light – gives the "radial line" a crisp bright edge.
  if (rowDist < 0.5) {
    let rimFrac = 1.0 - rowDist * 2.0;
    let edgeGlow = (1.0 - smoothstep(0.02, 0.18, -dHousing)) * rimFrac * 0.40;
    finalColor += vec3<f32>(0.2, 0.55, 1.0) * edgeGlow;
  }

  // ── Noise / dither ────────────────────────────────────────────────────────
  let noise = fract(sin(dot(in.uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  finalColor += (noise - 0.5) * 0.007;

  return vec4<f32>(clamp(finalColor, vec3<f32>(0.0), vec3<f32>(2.0)) * uniforms.dimFactor, 1.0);
}
