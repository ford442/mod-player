// patternv0.50b.wgsl
// Hybrid variant of v0.50 — WGSL chassis + housing only; three-emitter frosted lens
// caps are drawn by the WebGL2 overlay (webglHybrid: true in shaderRegistry.ts).
// Use patternv0.50.wgsl for native all-in-WGSL LEDs (single GPU context, no overlay).
// Top: Blue Note-On | Middle: Steady Note Color | Bottom: Amber Control (WebGL layer)
// Note: Requires padTopChannel=true in PatternDisplay to shift music channels 1-32.

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
  _r0: f32,
  _r1: f32,
  _r2: f32,
  _r3: f32,
  colorPalette: u32,
};

// DURA: Note duration constants
const NOTE_MIN: u32 = 1u;
const NOTE_MAX: u32 = 119u;
const NOTE_OFF_MIN: u32 = 120u;

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

  let invertedChannel = numChannels - 1u - channel;
  let ringIndex = select(invertedChannel, channel, (uniforms.invertChannels == 1u));

  let center = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let minDim = min(uniforms.canvasW, uniforms.canvasH);

  let maxRadius = minDim * 0.45;
  let minRadius = minDim * 0.15;
  let ringDepth = (maxRadius - minRadius) / f32(numChannels);

  let radius = minRadius + f32(ringIndex) * ringDepth;

  let totalSteps = f32(uniforms.numRows);
  let anglePerStep = 6.2831853 / totalSteps;
  let theta = -1.570796 + f32(row % uniforms.numRows) * anglePerStep;

  let circumference = 2.0 * 3.14159265 * radius;
  let arcLength = circumference / totalSteps;

  let btnW = arcLength * 0.95;
  let btnH = ringDepth * 0.95;

  let lp = quad[vertexIndex];
  let localPos = (lp - 0.5) * vec2<f32>(btnW, btnH);

  let rotAng = theta + 1.570796;
  let cA = cos(rotAng);
  let sA = sin(rotAng);

  let rotX = localPos.x * cA - localPos.y * sA;
  let rotY = localPos.x * sA + localPos.y * cA;

  let worldX = center.x + cos(theta) * radius + rotX;
  let worldY = center.y + sin(theta) * radius + rotY;

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

fn selectPalette(id: u32, t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  if (id == 1u) {
    // Warm: reds, oranges, yellows
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.0, 0.1, 0.2)));
  } else if (id == 2u) {
    // Cool: blues, cyans, purples
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.5, 0.7, 0.9)));
  } else if (id == 3u) {
    // Neon: pink, cyan, green
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.0, 0.5, 1.0)));
  } else if (id == 4u) {
    // Acid: green, yellow, chartreuse
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.3, 0.0, 0.7)));
  } else if (id == 5u) {
    // Circle of Fifths: fully-saturated HSV wheel — use t directly as hue.
    // HSV(t, 1, 1) → RGB via standard sextet formula.
    let h6  = t * 6.0;
    let hi  = u32(h6) % 6u;
    let f   = h6 - floor(h6);
    let q   = 1.0 - f;
    if      (hi == 0u) { return vec3<f32>(1.0, f,   0.0); }
    else if (hi == 1u) { return vec3<f32>(q,   1.0, 0.0); }
    else if (hi == 2u) { return vec3<f32>(0.0, 1.0, f  ); }
    else if (hi == 3u) { return vec3<f32>(0.0, q,   1.0); }
    else if (hi == 4u) { return vec3<f32>(f,   0.0, 1.0); }
    else               { return vec3<f32>(1.0, 0.0, q  ); }
  }
  // Default palette 0: Rainbow
  return a + b * cos(6.28318 * (c * t + vec3<f32>(0.0, 0.33, 0.67)));
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

fn sdEllipse(p: vec2<f32>, ab: vec2<f32>) -> f32 {
  let k = length(p / ab);
  return (k - 1.0) * min(ab.x, ab.y);
}

// ACES Filmic Tone Mapping (approximation by Narkowicz 2015).
// Maps HDR values to [0,1] while preserving hue far better than a simple clamp.
fn acesToneMap(color: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp(
    (color * (a * color + b)) / (color * (c * color + d) + e),
    vec3<f32>(0.0), vec3<f32>(1.0)
  );
}

fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u || note > NOTE_MAX) { return 0.0; }
  let semi = (note - 1u) % 12u;
  return f32(semi) / 12.0;
}

// Circle-of-fifths hue: notes a perfect fifth apart (7 semitones) are adjacent
// in color space, so harmonically related notes cluster visually.
// Mapping: semitone s → index (s*7) mod 12, spread evenly around hue [0,1).
fn fifthsHue(note: u32) -> f32 {
  if (note == 0u || note > NOTE_MAX) { return 0.0; }
  let semi = (note - 1u) % 12u;
  let cof  = (semi * 7u) % 12u;
  return f32(cof) / 12.0;
}

// Octave brightness multiplier: higher octaves glow brighter (0.65 at C-0, 1.0 at B-9).
fn octaveBrightness(note: u32) -> f32 {
  if (note == 0u || note > NOTE_MAX) { return 1.0; }
  let oct = (note - 1u) / 12u; // 0..9
  return 0.65 + 0.35 * f32(oct) / 9.0;
}

// Returns the hue parameter for selectPalette, choosing circle-of-fifths mapping
// when palette id == 5 and linear semitone mapping otherwise.
fn pitchHueForPalette(note: u32, paletteId: u32) -> f32 {
  if (paletteId == 5u) { return fifthsHue(note); }
  return pitchClassFromIndex(note);
}

fn neonPalette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.0, 0.33, 0.67);
  return a + b * cos(6.28318 * (c * t + d));
}

// DURA: Structure to hold unpacked note duration info
struct NoteDurationInfo {
  duration: u32,      // Total note duration in rows
  rowOffset: u32,     // How many rows from note start (0 = note-on)
  isNoteOff: bool,    // Whether this cell is the note-off row
  isTrigger: bool,    // TRIG-001: explicit note-on trigger row
}

// DURA: Unpack duration info from packed cell data
fn unpackDurationInfo(packedA: u32, packedB: u32) -> NoteDurationInfo {
  var info: NoteDurationInfo;

  // Duration is in bits 8-15 of packedA (where volCmd used to be)
  info.duration = (packedA >> 8) & 0xFFu;
  if (info.duration == 0u) { info.duration = 1u; }

  // rowOffset and isNoteOff are packed into bits 8-14 of packedB
  let durationFlags = (packedB >> 8) & 0x7Fu;
  info.rowOffset = durationFlags >> 1u;
  info.isNoteOff = (durationFlags & 1u) != 0u;
  info.isTrigger = ((packedB & 0x8000u) != 0u) || (info.rowOffset == 0u && !info.isNoteOff);

  return info;
}

struct FragmentConstants {
  bgColor: vec3<f32>,
  ledOnColor: vec3<f32>,
  ledOffColor: vec3<f32>,
  borderColor: vec3<f32>,
  housingSize: vec2<f32>,
};

fn getFragmentConstants() -> FragmentConstants {
  var c: FragmentConstants;
  c.bgColor = vec3<f32>(0.04, 0.04, 0.05);
  // Blue/Orange trap palette: primary indicator is warm orange
  c.ledOnColor = vec3<f32>(1.0, 0.55, 0.1);
  c.ledOffColor = vec3<f32>(0.06, 0.06, 0.08);
  c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
  c.housingSize = vec2<f32>(0.92, 0.92);
  return c;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.33;

  if (in.channel >= uniforms.numChannels) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }
  let fs = getFragmentConstants();
  let bloom = uniforms.bloomIntensity;
  let kick = uniforms.kickTrigger;

  // Hardware Layering: Discard pixels over UI
  if (in.position.y > uniforms.canvasH * 0.88) {
    discard;
  }

  // Smooth playhead position
  let maxRows = f32(uniforms.numRows);
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / maxRows) * maxRows;
  let rowDistRaw = abs(f32(in.row % uniforms.numRows) - playheadStep);
  let rowDist = min(rowDistRaw, maxRows - rowDistRaw);
  let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);

  // CHANNEL 0 — frosted plastic pad; playhead lens drawn by WebGL2 overlay
  if (in.channel == 0u) {
    var capColor = vec3<f32>(0.13, 0.14, 0.17);
    capColor = mix(capColor, fs.ledOnColor * 0.55, playheadActivation * 0.65);
    let dBox = sdRoundedBox(p, vec2<f32>(0.3), 0.08);
    let edge = smoothstep(0.0, aa * 1.5, -dBox);
    let nrm = normalize(vec3<f32>(p.x, p.y, 0.5));
    let diffuse = max(0.0, dot(nrm, normalize(vec3<f32>(0.4, -0.7, 0.6))));
    capColor *= (0.55 + 0.45 * diffuse);
    return vec4<f32>(capColor * edge, 1.0);
  }

  // --- MUSIC CHANNELS (1-32) — chassis/housing only; LEDs via WebGL2 overlay ---
  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = fs.bgColor;

  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var inButton = 0.0;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    inButton = 1.0;
  }

  if (inButton > 0.5) {
    let note = (in.packedA >> 24) & 255u;
    let instRaw = (in.packedA >> 16) & 255u;
    let volPacked = in.packedA & 255u;
    let effCmd = (in.packedB >> 24) & 255u;
    let volCmdFull = in.packedB & 255u;
    let isExpressionOnly = (instRaw & 128u) != 0u;
    let volCmd = (volPacked >> 4) << 4;

    let dInfo = unpackDurationInfo(in.packedA, in.packedB);
    let isNoteOn   = (note > 0u && note < NOTE_OFF_MIN && dInfo.isTrigger);
    let isNoteOff  = (note >= NOTE_OFF_MIN);
    let isExprOnly = (!isNoteOn && !isNoteOff && isExpressionOnly);
    let isSustain  = (note > 0u && note < NOTE_OFF_MIN && !dInfo.isTrigger && dInfo.duration > 0u && dInfo.rowOffset > 0u && !dInfo.isNoteOff);
    let hasNote = isNoteOn || isSustain;

    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);
    let hasExpression = (volCmd > 0u) || (effCmd > 0u) || (volCmdFull > 0u);

    var capColor = vec3<f32>(0.13, 0.14, 0.17);
    var glow = 0.0;

    if (!isMuted) {
      if (hasNote || isExprOnly) {
        let pitchHue = pitchHueForPalette(note, uniforms.colorPalette);
        let baseCol = selectPalette(uniforms.colorPalette, pitchHue);
        capColor = mix(capColor, baseCol * 0.55, 0.6);
        if (playheadActivation > 0.0) {
          glow = playheadActivation * 0.45;
          capColor = mix(capColor, baseCol, playheadActivation * 0.35);
        }
        if (ch.trigger > 0u && isNoteOn && playheadActivation > 0.5) {
          glow += 0.35;
          capColor = mix(capColor, baseCol * 1.15, 0.4);
        }
        // Three-emitter frosted lens caps — WebGL2 overlay (webglHybrid)
      } else if (isNoteOff) {
        capColor = mix(capColor, vec3<f32>(0.35, 0.35, 0.40), 0.5);
      }

      if ((hasExpression) && !hasNote && !isExprOnly) {
        capColor += vec3<f32>(0.0, 0.04, 0.08);
      }

      if (playheadActivation > 0.0) {
        finalColor += vec3<f32>(0.04, 0.05, 0.08) * playheadActivation;
      }
    } else {
      capColor *= 0.3;
    }

    let capUV = btnUV - vec2<f32>(0.5, 0.5);
    let dCap = sdRoundedBox(capUV, fs.housingSize * 0.45, 0.08);
    let edge = smoothstep(0.0, aa * 1.5, -dCap);
    let nrm = normalize(vec3<f32>(capUV.x, capUV.y, 0.5));
    let diffuse = max(0.0, dot(nrm, normalize(vec3<f32>(0.4, -0.7, 0.6))));
    capColor *= (0.55 + 0.45 * diffuse);
    capColor += vec3<f32>(glow * 0.35);
    if (glow > 0.0) { capColor *= (1.0 + bloom * 0.35); }

    finalColor = mix(finalColor, capColor, edge);
  }

  // Kick reactive glow
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.3;
  finalColor += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * uniforms.bloomIntensity;

  // Dithering for night mode
  let noise = fract(sin(dot(in.uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  finalColor += (noise - 0.5) * 0.01;

  // Idle cells: thin outer stroke instead of invisible
  if (housingMask < 0.5) {
    if (dHousing < 0.02) {
      return vec4<f32>(fs.ledOffColor, 1.0);
    }
    return vec4<f32>(fs.borderColor, 0.0);
  }
  return vec4<f32>(acesToneMap(finalColor), 1.0);
}
