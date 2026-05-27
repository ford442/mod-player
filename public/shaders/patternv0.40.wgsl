// patternv0.40.wgsl
// Horizontal Paged Grid Shader (Time = X, Channels = Y)
// Note sustain/duration logic backported from patternv0.45b.wgsl

struct Uniforms {
  numRows: u32,
  numChannels: u32,
  playheadRow: f32, // CRITICAL FIX: Changed from u32 to f32
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
  gridRect: vec4<f32>,
  stepsLength: u32,     // 32 or 64 steps visible per page
};

// Note constants — must match TypeScript NOTE_MIN/NOTE_MAX/NOTE_OFF_MIN in gpuPacking.ts
const NOTE_MIN: u32     = 1u;
const NOTE_MAX: u32     = 119u;   // Full range: covers MOD/XM/IT notes (C-0 to B-9)
const NOTE_OFF_MIN: u32 = 120u;   // Any note value >= this is note-off/cut/fade

// === SUSTAIN TUNING CONSTANTS ===
// Tuned slightly for square-grid aesthetics (vs the circular shader defaults).
const SUSTAIN_GLOW: f32        = 0.42;  // Glow strength for sustain tail rows (0–1)
const TRIGGER_FLASH_BOOST: f32 = 1.4;  // Extra glow added on the trigger row
const LED_BLOOM_EXP: f32       = 4.0;  // LED bloom falloff exponent (higher = tighter spot)
const BASE_GLOW_EXP: f32       = 4.0;  // Base falloff exponent for non-sustain / fallback glow
const NOTE_AGE_TOLERANCE: f32  = 0.5;  // Max row-age diff for hardware-choke isCurrentNote check
const MIN_FADE_ROWS: f32       = 2.0;  // Minimum rows for the fade-out window
const MAX_FADE_ROWS: f32       = 6.0;  // Maximum rows for the fade-out window
const FADE_WINDOW_PCT: f32     = 0.30; // Fraction of duration used as the fade-out window

@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var<storage, read> rowFlags: array<u32>;

struct ChannelState { volume: f32, pan: f32, freq: f32, trigger: u32, noteAge: f32, activeEffect: u32, effectValue: f32, isMuted: u32 };
@group(0) @binding(3) var<storage, read> channels: array<ChannelState>;
@group(0) @binding(4) var buttonsSampler: sampler;
@group(0) @binding(5) var buttonsTexture: texture_2d<f32>;

// Duration info unpacked from high-precision cell packing (DURA-001 in gpuPacking.ts)
struct NoteDurationInfo {
  duration: u32,
  rowOffset: u32,
  isNoteOff: bool,
}

fn unpackDurationInfo(packedA: u32, packedB: u32) -> NoteDurationInfo {
  var info: NoteDurationInfo;
  // Duration is in bits 8-15 of packedA (where volCmd used to be in the high-prec path)
  info.duration = (packedA >> 8) & 0xFFu;
  if (info.duration == 0u) { info.duration = 1u; }
  // rowOffset and isNoteOff are packed into bits 8-14 of packedB
  let durationFlags = (packedB >> 8) & 0x7Fu;
  info.rowOffset = durationFlags >> 1u;
  info.isNoteOff = (durationFlags & 1u) != 0u;
  return info;
}

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

  let stepsPerPage = select(32.0, f32(uniforms.stepsLength), uniforms.stepsLength >= 32u);
  // Use floor on the float, then multiply to get the page start
  let pageStart = floor(uniforms.playheadRow / stepsPerPage) * stepsPerPage;
  let localRow = f32(row) - pageStart;

  let px = localRow * uniforms.cellW;
  let py = f32(channel) * uniforms.cellH;

  var isVisible = 1.0;
  if (localRow < 0.0 || localRow >= stepsPerPage) {
      isVisible = 0.0;
  }

  let effectiveChannel = f32(channel);
  let hasHeader = uniforms.numChannels > 1u && uniforms.gridRect.y > 0.15;
  let dataChannels = f32(uniforms.numChannels) - select(0.0, 1.0, hasHeader);
  let channelIndex = select(effectiveChannel, effectiveChannel - 1.0, hasHeader && effectiveChannel > 0.0);

  let gridX = uniforms.gridRect.x + (localRow / stepsPerPage) * uniforms.gridRect.z;
  let gridY = uniforms.gridRect.y + (channelIndex / max(1.0, dataChannels)) * uniforms.gridRect.w;

  let cellWidth = uniforms.gridRect.z / stepsPerPage;
  let cellHeight = uniforms.gridRect.w / max(1.0, dataChannels);

  let clipX = gridX * 2.0 - 1.0 + quad[vertexIndex].x * cellWidth * 2.0;
  let clipY = 1.0 - (gridY * 2.0) - quad[vertexIndex].y * cellHeight * 2.0;

  let finalPos = select(vec4<f32>(0.0, 0.0, 0.0, 0.0), vec4<f32>(clipX, clipY, 0.0, 1.0), isVisible > 0.5);

  let idx = instanceIndex * 2u;
  var a = 0u;
  var b = 0u;
  // Bounds check safety
  if (idx + 1u < arrayLength(&cells)) {
      a = cells[idx];
      b = cells[idx + 1u];
  }

  var out: VertexOut;
  out.position = finalPos;
  out.row = row;
  out.channel = channel;
  out.uv = quad[vertexIndex];
  out.packedA = a;
  out.packedB = b;
  return out;
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
    return length(max(q, vec2<f32>(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
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
  // Compute derivatives in uniform control flow (before any early returns)
  let uv = in.uv;
  let p = uv - vec2<f32>(0.5, 0.5);
  let aa = fwidth(p.y) * 0.75;

  if (in.channel >= uniforms.numChannels) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }
  let fragmentConstants = getFragmentConstants();

  if (in.channel == 0u) {
      var col = fragmentConstants.bgColor * 0.8;
      return vec4<f32>(col, 1.0);
  }

  let dBox = sdRoundedBox(p, vec2<f32>(0.45, 0.40), 0.05);
  var col = fragmentConstants.bgColor;

  col += smoothstep(0.0, 0.1, dBox + 0.5) * 0.02;

  // === UNPACK NOTE DATA ===
  let note     = (in.packedA >> 24) & 255u;
  let instByte = (in.packedA >> 16) & 255u;
  let hasNote  = (note >= NOTE_MIN && note <= NOTE_MAX);
  let isExpressionOnly = (instByte & 128u) != 0u;

  // Expression indicator — kept for vol/effect-only cells (using original byte fields)
  let volCmdRaw = (in.packedA >> 8) & 255u;
  let effCmdRaw = (in.packedB >> 8) & 255u;
  let hasExpression = (volCmdRaw > 0u) || (effCmdRaw > 0u);

  let ch = channels[in.channel];

  // === MODULAR PLAYHEAD DELTA (with wrap-around for circular/page seams) ===
  let maxRows = f32(uniforms.numRows);
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / maxRows) * maxRows;
  var delta = playheadStep - f32(in.row);
  if (delta < -maxRows * 0.5) { delta += maxRows; }
  else if (delta > maxRows * 0.5) { delta -= maxRows; }

  let onPlayhead = (in.row == u32(uniforms.playheadRow));

  if (hasNote) {
      let noteCol = neonPalette(f32(note % 12u) / 12.0);
      let dist = length(p);

      let dInfo = unpackDurationInfo(in.packedA, in.packedB);
      let isRealNoteOff = dInfo.isNoteOff || note >= NOTE_OFF_MIN;
      let isTrigger  = (dInfo.rowOffset == 0u) && !isRealNoteOff;
      let isSustain  = (dInfo.rowOffset > 0u)  && !isRealNoteOff;
      let durationF  = f32(dInfo.duration);

      // Unified note-relative age: distance of the playhead from this note's trigger row.
      // trigger row (rowOffset=0): noteRelativeAge = delta
      // sustain row at offset k:   noteRelativeAge = delta + k  (== noteAge on the live channel)
      let noteRelativeAge = delta + f32(dInfo.rowOffset);

      // Hardware choke: only the most-recent note per channel sustains.
      let isCurrentNote = abs(noteRelativeAge - ch.noteAge) < NOTE_AGE_TOLERANCE;

      var sustainFactor = 0.0;

      let isWithinDuration  = (noteRelativeAge >= 0.0 && noteRelativeAge < durationF);
      let isValidSustainRow = (isTrigger || isSustain) && durationF > 0.0;
      if (isValidSustainRow && isWithinDuration && isCurrentNote) {
          sustainFactor = select(1.0, SUSTAIN_GLOW, isSustain);

          // === ADAPTIVE FADE-OUT ===
          // Proportional window — 30% of duration, clamped to MIN_FADE_ROWS..MAX_FADE_ROWS.
          let fadeWindow = clamp(durationF * FADE_WINDOW_PCT, MIN_FADE_ROWS, MAX_FADE_ROWS);
          let fadeStart  = durationF - fadeWindow;
          if (noteRelativeAge > fadeStart) {
              let fadeT = (noteRelativeAge - fadeStart) / fadeWindow;
              sustainFactor *= smoothstep(1.0, 0.0, fadeT);
          }
      }

      if (sustainFactor > 0.0) {
          // Modulated LED bloom: tight exp glow + sustained base
          let expGlow = exp(-dist * LED_BLOOM_EXP) * sustainFactor;
          let baseGlow = exp(-dist * BASE_GLOW_EXP) * sustainFactor;
          col += noteCol * (expGlow + baseGlow) * 1.5;

          // Playhead ripple inside active sustain
          if (onPlayhead) {
              col += noteCol * sustainFactor * 0.6;
          }
      } else {
          // Fallback: safe binary glow (no sustain data or outside window)
          if (hasNote) {
              let glow = exp(-dist * BASE_GLOW_EXP);
              col += noteCol * glow * 0.6;
          }
      }

      // === TRIGGER FLASH (bright pop on note-on row) ===
      if (ch.trigger > 0u && isTrigger) {
          col += noteCol * TRIGGER_FLASH_BOOST;
      }
  }
  // === NOTE-OFF / CUT / FADE: brief neutral pulse ===
  else if (note >= NOTE_OFF_MIN) {
      if (abs(delta) < 0.5) {
          let cutPulse = (0.5 - abs(delta)) * 2.0;
          col = mix(col, vec3<f32>(0.35, 0.35, 0.45), cutPulse * 0.3);
      }
  }
  // === EXPRESSION-ONLY: subtle amber tint ===
  else if (isExpressionOnly && ch.isMuted == 0u) {
      col += vec3<f32>(0.0, 0.04, 0.08) * uniforms.bloomIntensity;
  }

  // Legacy expression indicator (vol/effect bytes) kept as fallback
  if (hasExpression && !isExpressionOnly && ch.isMuted == 0u && !hasNote) {
      col += vec3<f32>(0.0, 0.03, 0.06) * uniforms.bloomIntensity;
  }

  if (onPlayhead) {
      col += vec3<f32>(0.2, 0.2, 0.25) * 0.8;
  }

  col = mix(col, fragmentConstants.borderColor, smoothstep(0.0, aa, dBox));
  col *= uniforms.dimFactor;

  // Kick reactive glow
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.3;
  col += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * uniforms.bloomIntensity;
  // Dithering for night mode
  let noise = fract(sin(dot(in.uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  col += (noise - 0.5) * 0.01;

  return vec4<f32>(col, 1.0);
}
