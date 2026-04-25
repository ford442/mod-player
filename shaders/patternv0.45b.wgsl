// patternv0.45b.wgsl
// Frosted Bloom with Note-On Cell Sustain + Exp LEDs
// - Note-on cell brightens and stays lit for the note's duration
// - Exponential LED glow on active note cells
// - Hardware choke: only the most recent note per channel sustains
// - Strict exclusive bounds (delta < duration) to prevent boundary overlap

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

  // === NEW: Exact pixel radii for perfect alignment ===
  innerRadius: f32,
  outerRadius: f32,
};

// Note constants for numeric note values
const NOTE_MIN: u32 = 1u;
const NOTE_MAX: u32 = 96u;
const NOTE_OFF: u32 = 97u;
const NOTE_CUT: u32 = 98u;
const NOTE_FADE: u32 = 99u;

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
  @location(5) @interpolate(flat) isUI: u32,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let totalInstances = uniforms.numRows * uniforms.numChannels;
  var out: VertexOut;

  // --- UI PASS (Composite) ---
  if (instanceIndex >= totalInstances) {
      var pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
        vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
      );
      out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
      out.uv = pos[vertexIndex] * vec2<f32>(0.5, -0.5) + 0.5;
      out.isUI = 1u;
      return out;
  }

  // --- DATA CELL PASS ---
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  var ringIndex = channel;
  if (uniforms.invertChannels == 0u) {
      ringIndex = numChannels - 1u - channel;
  }

  let center = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);

  // === CLEANER & MORE PRECISE RING CALCULATION ===
  let maxRadius = uniforms.outerRadius;
  let minRadius = uniforms.innerRadius;
  let ringDepth = (maxRadius - minRadius) / f32(numChannels);

  let radius = minRadius + f32(ringIndex) * ringDepth;

  let totalSteps = f32(uniforms.numRows);
  let anglePerStep = 6.2831853 / totalSteps;
  let theta = -1.570796 + f32(row % uniforms.numRows) * anglePerStep;

  let circumference = 2.0 * 3.14159265 * radius;
  let cellArc = circumference / totalSteps;

  let cellWidth = cellArc * 0.88;
  let cellHeight = ringDepth * 0.92;

  let localPos = quad[vertexIndex] * vec2<f32>(cellWidth, cellHeight) - vec2<f32>(cellWidth * 0.5, cellHeight * 0.5);

  let rotAng = theta + 1.570796;
  let cA = cos(rotAng);
  let sA = sin(rotAng);
  let rotX = localPos.x * cA - localPos.y * sA;
  let rotY = localPos.x * sA + localPos.y * cA;

  let worldPos = center + vec2<f32>(
    cos(theta) * radius + rotX,
    sin(theta) * radius + rotY
  );

  let ndc = vec2<f32>(
    (worldPos.x / uniforms.canvasW) * 2.0 - 1.0,
    1.0 - (worldPos.y / uniforms.canvasH) * 2.0
  );

  out.position = vec4<f32>(ndc, 0.0, 1.0);
  out.row = row;
  out.channel = channel;
  out.uv = quad[vertexIndex];
  out.packedA = cells[instanceIndex * 2u];
  out.packedB = cells[instanceIndex * 2u + 1u];
  out.isUI = 0u;

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
  }
  // Default palette 0: Rainbow
  return a + b * cos(6.28318 * (c * t + vec3<f32>(0.0, 0.33, 0.67)));
}

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

fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

fn sdTriangle(p: vec2<f32>, r: f32) -> f32 {
    let k = sqrt(3.0);
    var p2 = p;
    p2.x = abs(p2.x) - r;
    p2.y = p2.y + r / k;
    if (p2.x + k * p2.y > 0.0) {
        p2 = vec2<f32>(p2.x - k * p2.y, -k * p2.x - p2.y) / 2.0;
    }
    p2.x -= clamp(p2.x, -2.0 * r, 0.0);
    return -length(p2) * sign(p2.y);
}

fn toUpperAscii(code: u32) -> u32 {
  return select(code, code - 32u, (code >= 97u) & (code <= 122u));
}

fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u) { return 0.0; }
  let semi = (note - 1u) % 12u;
  return f32(semi) / 12.0;
}

// Duration info unpacked from high-precision cell packing
struct NoteDurationInfo {
  duration: u32,
  rowOffset: u32,
  isNoteOff: bool,
}

fn unpackDurationInfo(packedA: u32, packedB: u32) -> NoteDurationInfo {
  var info: NoteDurationInfo;
  info.duration = (packedA >> 8) & 0xFFu;
  if (info.duration == 0u) { info.duration = 1u; }
  let durationFlags = (packedB >> 8) & 0x7Fu;
  info.rowOffset = durationFlags >> 1u;
  info.isNoteOff = (durationFlags & 1u) != 0u;
  return info;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  if (in.channel >= uniforms.numChannels) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }

  let dimFactor = uniforms.dimFactor;
  let bloom = uniforms.bloomIntensity;
  let isPlaying = (uniforms.isPlaying == 1u);
  let uv = in.uv;

  // === UI PASS (unchanged) ===
  if (in.isUI == 1u) {
      let gridBottom = 0.85;
      if (uv.y <= gridBottom) { discard; }

      var col = vec3<f32>(0.0);
      let aspect = uniforms.canvasW / uniforms.canvasH;
      let ctrlH = 1.0 - gridBottom;
      let ctrlUV = vec2<f32>(uv.x, (uv.y - gridBottom) / ctrlH);
      let btnY = 0.5;

      // Play
      var pPlay = ctrlUV - vec2<f32>(0.5, btnY);
      pPlay.x *= aspect * (ctrlH / 1.0);
      let dPlay = sdTriangle(pPlay * 4.0, 0.3);
      let playCol = select(vec3<f32>(0.0, 0.4, 0.0), vec3<f32>(0.2, 1.0, 0.2), isPlaying);
      col = mix(col, playCol, 1.0 - smoothstep(0.0, 0.05, dPlay));

      // Stop
      var pStop = ctrlUV - vec2<f32>(0.6, btnY);
      pStop.x *= aspect * (ctrlH / 1.0);
      let dStop = sdBox(pStop * 4.0, vec2<f32>(0.25));
      col = mix(col, vec3<f32>(0.8, 0.1, 0.1), 1.0 - smoothstep(0.0, 0.05, dStop));

      // Loop
      var pLoop = ctrlUV - vec2<f32>(0.4, btnY);
      pLoop.x *= aspect * (ctrlH / 1.0);
      let dLoop = abs(sdCircle(pLoop * 4.0, 0.25)) - 0.05;
      col = mix(col, vec3<f32>(0.9, 0.6, 0.0), 1.0 - smoothstep(0.0, 0.05, dLoop));
      return vec4<f32>(col * dimFactor, 1.0);
  }

  // === FROSTED CAP ===
  let dBox = sdRoundedBox(uv - 0.5, vec2<f32>(0.42), 0.1);
  if (dBox > 0.0) { discard; }

  var capColor = vec3<f32>(0.11, 0.12, 0.14);
  var glow = 0.0;

  // === UNPACK ===
  let note = (in.packedA >> 24) & 255u;
  let instByte = (in.packedA >> 16) & 255u;
  let hasNote = (note >= NOTE_MIN && note <= NOTE_MAX);
  let isExpressionOnly = (instByte & 128u) != 0u;

  let maxRows = f32(uniforms.numRows);
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / maxRows) * maxRows;
  var delta = playheadStep - f32(in.row);
  if (delta < -maxRows * 0.5) { delta += maxRows; }
  else if (delta > maxRows * 0.5) { delta -= maxRows; }

  if (hasNote) {
      let pitchHue = pitchClassFromIndex(note);
      let baseCol = neonPalette(pitchHue);

      capColor = mix(capColor, baseCol, 0.36);

      let dInfo = unpackDurationInfo(in.packedA, in.packedB);
      let isNoteOffCmd = note == NOTE_OFF || note == NOTE_CUT || note == NOTE_FADE;
      let isNoteOnCell = dInfo.rowOffset == 0u && !dInfo.isNoteOff && !isNoteOffCmd;

      let ch = channels[in.channel];
      let durationF = f32(dInfo.duration);
      var sustainGlow = 0.0;

      // Hardware choke: only the most recent active note on this channel may sustain
      let isCurrentNote = abs(delta - ch.noteAge) < 1.0;
      if (isNoteOnCell && durationF > 0.0 && delta >= 0.0 && delta < durationF && isCurrentNote) {
          sustainGlow = 1.0;
      }

      // === SUSTAIN + FADE OUT (last 10%) ===
      if (sustainGlow > 0.0) {
          glow = max(glow, sustainGlow * 0.92);

          // Brighter own-color mix
          let brightSustain = clamp(baseCol * 1.68, vec3<f32>(0.0), vec3<f32>(1.0));
          capColor = mix(capColor, brightSustain, 0.87);

          // Gentle shimmer
          let shimmer = sin(uniforms.timeSec * 5.5 + f32(in.row) * 0.65) * 0.07 + 0.93;
          capColor *= shimmer;

          // Fade out in final 10% of duration
          if (delta > durationF * 0.9) {
              let fadeT = (delta - durationF * 0.9) / (durationF * 0.1);
              let fade = smoothstep(1.0, 0.0, fadeT);
              capColor *= fade;
          }
      }

      // === TRIGGER FLASH (bright own color) ===
      if (ch.trigger > 0u && isNoteOnCell) {
          glow += 1.4;
          let brightFlash = clamp(baseCol * 2.15, vec3<f32>(0.0), vec3<f32>(1.0));
          capColor = mix(capColor, brightFlash, 0.96);
      }

      // === ORGANIC LED BLOOM (tunable radius) ===
      if (sustainGlow > 0.0) {
          let p = uv - 0.5;
          let dist = length(p);
          let expGlow = exp2(-dist * 3.6) * sustainGlow;
          capColor += baseCol * expGlow * 0.58;
          glow += expGlow * 0.48;
      }

      // Rim light on active notes
      if (sustainGlow > 0.0 || (ch.trigger > 0u && isNoteOnCell)) {
          let rim = pow(1.0 - abs(dBox) * 7.5, 2.2) * 0.22;
          capColor += baseCol * rim;
      }
  }
  // === EXPRESSION-ONLY ===
  else if (isExpressionOnly) {
      let expressionCol = vec3<f32>(0.88, 0.47, 0.09);
      if (abs(delta) < 0.5) {
          glow = 0.48;
          capColor = mix(capColor, expressionCol, 0.68);
      } else {
          capColor = mix(capColor, expressionCol, 0.17);
      }
  }

  // === RHYTHMIC KICK PULSE ===
  let p = uv - 0.5;
  let kickPulse = max(0.0, sin(3.14159 * uniforms.timeSec * 1.8)) * uniforms.kickTrigger;
  capColor += vec3<f32>(0.92, 0.22, 0.42) * kickPulse * bloom * 0.9;

  // === FROSTED MATERIAL + LIGHTING ===
  let edge = smoothstep(0.0, 0.022, -dBox);
  let lightDir = normalize(vec3<f32>(0.35, -0.85, 0.65));
  let n = normalize(vec3<f32>(uv.x - 0.5, uv.y - 0.5, 0.55));
  let diff = max(0.0, dot(n, lightDir));
  let fresnel = pow(1.0 - max(0.0, dot(n, vec3<f32>(0.0, 0.0, 1.0))), 2.8) * 0.32;

  capColor = capColor * (0.52 + 0.48 * diff) + fresnel * 0.11;
  capColor += vec3<f32>(glow * 0.58);

  if (glow > 0.0) {
      capColor *= (1.0 + bloom * 0.75);
  }

  // Light dither
  let noise = fract(sin(dot(in.uv * uniforms.timeSec * 0.7, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  capColor += (noise - 0.5) * 0.007;

  return vec4<f32>(capColor * dimFactor, edge);
}
