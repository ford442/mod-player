// patternv0.42.wgsl
// Circular Ring Layout — Single-pass composite
// - Channel = ring (innermost = ch0), Row = angular step (64 steps)
// - instanceIndex < numRows*numChannels → per-cell quads in ring arcs
// - instanceIndex == totalInstances → full-screen ring-grid background pass
// Note encoding: raw OpenMPT numeric values (0=empty, 1-120=notes, 121=OFF, 122=CUT, 123=FADE)

struct Uniforms {
  numRows:       u32,   // [0]
  numChannels:   u32,   // [1]
  playheadRow:   f32,   // [2] float for smooth motion
  isPlaying:     u32,   // [3]
  cellW:         f32,   // [4]
  cellH:         f32,   // [5]
  canvasW:       f32,   // [6]
  canvasH:       f32,   // [7]
  tickOffset:    f32,   // [8]
  bpm:           f32,   // [9]
  timeSec:       f32,   // [10]
  beatPhase:     f32,   // [11]
  groove:        f32,   // [12]
  kickTrigger:   f32,   // [13]
  activeChannels: u32,  // [14]
  isModuleLoaded: u32,  // [15]
  bloomIntensity: f32,  // [16]
  bloomThreshold: f32,  // [17]
  invertChannels: u32,  // [18]
  dimFactor:      f32,  // [19]
  colorPalette:   u32,  // [20]
};

@group(0) @binding(0) var<storage, read> cells:    array<u32>;
@group(0) @binding(1) var<uniform>       uniforms: Uniforms;
@group(0) @binding(2) var<storage, read> rowFlags: array<u32>;

struct ChannelState {
  volume: f32, pan: f32, freq: f32, trigger: u32,
  noteAge: f32, activeEffect: u32, effectValue: f32, isMuted: u32
};
@group(0) @binding(3) var<storage, read> channels: array<ChannelState>;
@group(0) @binding(4) var buttonsSampler: sampler;
@group(0) @binding(5) var buttonsTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position)               position: vec4<f32>,
  @location(0) @interpolate(flat)  row:      u32,
  @location(1) @interpolate(flat)  channel:  u32,
  @location(2) @interpolate(linear) uv:      vec2<f32>,
  @location(3) @interpolate(flat)  packedA:  u32,
  @location(4) @interpolate(flat)  packedB:  u32,
  @location(5) @interpolate(flat)  isBackground: u32,
};

// Ring geometry constants
const TOTAL_STEPS: f32 = 64.0;
const TWO_PI:      f32 = 6.2831853;
const HALF_PI:     f32 = 1.5707963;

@vertex
fn vs(
  @builtin(vertex_index)   vertexIndex:   u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOut {
  var out: VertexOut;
  let numChannels = uniforms.numChannels;
  let totalCells  = uniforms.numRows * numChannels;

  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  // ── Background pass: render full-screen quad for ring-grid overlay ──
  if (instanceIndex >= totalCells) {
    var fs_pos = array<vec2<f32>, 6>(
      vec2<f32>(-1.0,-1.0), vec2<f32>(1.0,-1.0), vec2<f32>(-1.0,1.0),
      vec2<f32>(-1.0,1.0),  vec2<f32>(1.0,-1.0),  vec2<f32>(1.0, 1.0)
    );
    out.position     = vec4<f32>(fs_pos[vertexIndex], 0.0, 1.0);
    out.uv           = fs_pos[vertexIndex] * 0.5 + 0.5;
    out.isBackground = 1u;
    out.row          = 0u;
    out.channel      = 0u;
    out.packedA      = 0u;
    out.packedB      = 0u;
    return out;
  }

  // ── Per-cell pass ──
  let row     = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  var ringIndex = channel;
  if (uniforms.invertChannels == 0u) {
    ringIndex = numChannels - 1u - channel;
  }

  let center = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let minDim  = min(uniforms.canvasW, uniforms.canvasH);

  let maxRadius = minDim * 0.45;
  let minRadius = minDim * 0.15;
  let ringDepth = (maxRadius - minRadius) / f32(numChannels);
  let radius    = minRadius + f32(ringIndex) * ringDepth + ringDepth * 0.5;

  let anglePerStep = TWO_PI / TOTAL_STEPS;
  let theta        = -HALF_PI + f32(row % 64u) * anglePerStep;

  let circumference = TWO_PI * radius;
  let arcLength     = circumference / TOTAL_STEPS;

  let btnW = arcLength * 0.90;
  let btnH = ringDepth * 0.88;

  let lp       = quad[vertexIndex];
  let localPos = (lp - 0.5) * vec2<f32>(btnW, btnH);

  let rotAng = theta + HALF_PI;
  let cA = cos(rotAng);
  let sA = sin(rotAng);

  let rotX = localPos.x * cA - localPos.y * sA;
  let rotY = localPos.x * sA + localPos.y * cA;

  let worldX = center.x + cos(theta) * radius + rotX;
  let worldY = center.y + sin(theta) * radius + rotY;

  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;

  let idx = instanceIndex * 2u;
  var a = 0u;
  var b = 0u;
  if (idx + 1u < arrayLength(&cells)) {
    a = cells[idx];
    b = cells[idx + 1u];
  }

  out.position     = vec4<f32>(clipX, clipY, 0.0, 1.0);
  out.row          = row;
  out.channel      = channel;
  out.uv           = lp;
  out.packedA      = a;
  out.packedB      = b;
  out.isBackground = 0u;
  return out;
}

// ── Colour helpers ──────────────────────────────────────────────────────────

// Neon palette driven by beat phase
fn neonPalette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.0, 0.33, 0.67);
  let drift = uniforms.beatPhase * 0.08;
  return a + b * cos(TWO_PI * (c * (t + drift) + d));
}

// Correct pitch class from raw OpenMPT note value (1–120)
// Returns 0.0–1.0 fraction around the colour wheel (C=0, C#=1/12 … B=11/12)
fn pitchClass(note: u32) -> f32 {
  return f32((note - 1u) % 12u) / 12.0;
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// ── Fragment ────────────────────────────────────────────────────────────────

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let dim  = uniforms.dimFactor;
  let bloom = uniforms.bloomIntensity;

  // ── Background ring-grid pass ──────────────────────────────────────────
  if (in.isBackground == 1u) {
    let uv = in.uv;          // 0..1
    let p  = uv - 0.5;      // -0.5..0.5
    let r  = length(p) * 2.0;

    let minDim    = min(uniforms.canvasW, uniforms.canvasH);
    let maxRadius = 0.45 * 2.0;
    let minRadius = 0.15 * 2.0;

    if (r < minRadius || r > maxRadius) { return vec4<f32>(0.0); }

    let numTracks = f32(uniforms.numChannels);
    let normR     = (r - minRadius) / (maxRadius - minRadius);
    let trackVal  = normR * numTracks;

    // Track ring dividers
    let trackLine = 1.0 - smoothstep(0.0, 0.08, abs(fract(trackVal) - 0.5));

    // Angular spoke dividers
    let a        = atan2(p.y, p.x);
    let angNorm  = fract(a / (TWO_PI / TOTAL_STEPS));
    let spokeLine = 1.0 - smoothstep(0.35, 0.5, abs(angNorm - 0.5));

    var col = vec3<f32>(0.12, 0.13, 0.16);
    col += vec3<f32>(0.10) * trackLine;
    col += vec3<f32>(0.04) * spokeLine;

    // Playhead spoke highlight
    let stepAngle    = TWO_PI / TOTAL_STEPS;
    let exactRow     = uniforms.playheadRow - floor(uniforms.playheadRow / TOTAL_STEPS) * TOTAL_STEPS;
    let currentAngle = -HALF_PI + exactRow * stepAngle;
    let diff         = abs(atan2(sin(a - currentAngle), cos(a - currentAngle)));
    let highlight    = 1.0 - smoothstep(0.0, stepAngle * 1.5, diff);
    col += vec3<f32>(0.15, 0.35, 0.45) * highlight;
    col += vec3<f32>(0.0,  0.20, 0.28) * exp(-max(0.0, diff - stepAngle) * 5.0);

    // Fade at page boundaries
    let pageProgress = fract(uniforms.playheadRow / TOTAL_STEPS);
    var fade = 1.0;
    if (pageProgress < 0.05)       { fade = smoothstep(0.0, 0.05, pageProgress); }
    else if (pageProgress > 0.95)  { fade = 1.0 - smoothstep(0.95, 1.0, pageProgress); }

    return vec4<f32>(col * fade * dim, 0.55);
  }

  // ── Per-cell pass ──────────────────────────────────────────────────────
  if (in.channel >= uniforms.numChannels) { discard; }

  let uv  = in.uv;
  let p   = uv - 0.5;

  // Rounded-box clipping
  let dBox = sdRoundedBox(p, vec2<f32>(0.44), 0.10);
  if (dBox > 0.0) { discard; }

  // Unpack fields
  let note   = (in.packedA >> 24) & 255u;
  let inst   = (in.packedA >> 16) & 255u;
  let volCmd = (in.packedA >>  8) & 255u;
  // volVal  = in.packedA & 255u  (available if needed)
  let effCmd = (in.packedB >>  8) & 255u;

  // Note classification (OpenMPT numeric encoding)
  let hasNote    = (note > 0u) && (note <= 120u);
  let isNoteOff  = (note == 121u);
  let isNoteCut  = (note == 122u) || (note == 123u);
  let hasVol     = (volCmd > 0u);
  let hasEffect  = (effCmd > 0u);

  // Playhead proximity
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / TOTAL_STEPS) * TOTAL_STEPS;
  let rowInPage    = f32(in.row % 64u);
  let rowDistRaw   = abs(rowInPage - playheadStep);
  let rowDist      = min(rowDistRaw, TOTAL_STEPS - rowDistRaw);
  let onPlayhead   = rowDist < 1.5;
  let nearPlayhead = 1.0 - smoothstep(0.0, 2.0, rowDist);

  // Base plastic colour
  var capColor = vec3<f32>(0.13, 0.14, 0.17);
  var alpha    = 1.0;
  var glow     = 0.0;

  // ── Channel state ─────────────────────────────────────────────────────
  var chActive = false;
  var chTrigger = false;
  var chNoteAge = 0.0;
  if (in.channel < arrayLength(&channels)) {
    let ch    = channels[in.channel];
    chNoteAge = ch.noteAge;
    chTrigger = (ch.trigger > 0u) && onPlayhead;
    chActive  = (ch.volume > 0.01) && onPlayhead;
  }

  // ── Render note data ─────────────────────────────────────────────────
  if (hasNote) {
    let pc       = pitchClass(note);
    let baseCol  = neonPalette(pc);
    capColor = mix(capColor, baseCol * 0.55, 0.6);

    // Playhead highlight
    if (nearPlayhead > 0.0) {
      glow     = nearPlayhead * 0.8;
      capColor = mix(capColor, baseCol, nearPlayhead * 0.65);
    }

    // ── Blue note-on indicator — now drawn by WebGL2 overlay ──────────

    // Trigger flash
    if (chTrigger) {
      glow    += 1.2;
      capColor = mix(capColor, baseCol * 1.4 + 0.3, 0.5);
    }
  } else if (isNoteOff) {
    // Dim red stripe for note-off
    capColor = mix(capColor, vec3<f32>(0.45, 0.05, 0.05), 0.6);
    alpha    = 0.75;
  } else if (isNoteCut) {
    // Orange-red for note-cut/fade
    capColor = mix(capColor, vec3<f32>(0.60, 0.20, 0.02), 0.5);
    alpha    = 0.75;
  }

  // ── Volume/Expression indicator ──────────────────────────────────────
  if ((hasVol || hasEffect) && !chActive) {
    capColor += vec3<f32>(0.0, 0.04, 0.08);
  }
  if (hasVol || hasEffect) {
    let exprCenter = vec2<f32>(0.0, -0.32);
    let exprDist = length(p - exprCenter);
    let exprMask = 1.0 - smoothstep(0.04, 0.07, exprDist);
    let exprCol = vec3<f32>(0.0, 0.75, 1.0) * (0.8 + bloom * 0.5);
    capColor = mix(capColor, exprCol, exprMask * 0.85);
  }

  // ── Frosted surface shading ──────────────────────────────────────────
  let edge   = smoothstep(0.0, 0.08, -dBox);
  let nrm    = normalize(vec3<f32>(p.x, p.y, 0.5));
  let light  = normalize(vec3<f32>(0.5, -0.7, 1.0));
  let diffuse = max(0.0, dot(nrm, light));
  capColor   *= (0.55 + 0.45 * diffuse);
  capColor   += vec3<f32>(glow * 0.4);

  // Playhead glow
  if (onPlayhead) {
    capColor += vec3<f32>(0.06, 0.08, 0.12) * nearPlayhead;
  }

  if (glow > 0.0) { capColor *= (1.0 + bloom * 0.6); }

  // Kick pulse
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.25;
  capColor += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * bloom;

  // Subtle dither
  let noise = fract(sin(dot(uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  capColor += (noise - 0.5) * 0.008;

  return vec4<f32>(capColor * dim, edge * alpha);
}
