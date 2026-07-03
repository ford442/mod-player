// patternv0.30b.wgsl
// v0.30 chrome disc aesthetic + trigger-only note-on indicators with persistent glow (DURA/TRIG-001)

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
};

// Note constants — must match TypeScript NOTE_MIN/NOTE_MAX/NOTE_OFF_MIN in gpuPacking.ts
const NOTE_MIN: u32     = 1u;
const NOTE_MAX: u32     = 119u;
const NOTE_OFF_MIN: u32 = 120u;

// Note-on lighting — trigger cells only; instant on, fade-out at end
const IDLE_NOTE_GLOW: f32      = 0.22;
const ACTIVE_NOTE_GLOW: f32      = 0.88;
const NOTE_AGE_TOLERANCE: f32    = 1.25;
const MIN_FADE_ROWS: f32         = 2.0;
const MAX_FADE_ROWS: f32         = 6.0;
const FADE_WINDOW_PCT: f32       = 0.30;

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

  let btnW = arcLength * 0.92;
  let btnH = ringDepth * 0.92;

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

fn toUpperAscii(code: u32) -> u32 {
  return select(code, code - 32u, (code >= 97u) & (code <= 122u));
}

fn pitchClassFromNote(note: u32) -> f32 {
  if (note < NOTE_MIN || note > NOTE_MAX) { return 0.0; }
  return f32((note - 1u) % 12u) / 12.0;
}

fn effectColorFromCode(code: u32, fallback: vec3<f32>) -> vec3<f32> {
  let c = toUpperAscii(code & 255u);
  switch c {
    case 49u: { return mix(fallback, vec3<f32>(0.2, 0.85, 0.4), 0.75); }
    case 50u: { return mix(fallback, vec3<f32>(0.85, 0.3, 0.3), 0.75); }
    case 52u: { return mix(fallback, vec3<f32>(0.4, 0.7, 1.0), 0.6); }
    case 55u: { return mix(fallback, vec3<f32>(0.9, 0.6, 0.2), 0.6); }
    case 65u: { return mix(fallback, vec3<f32>(0.95, 0.9, 0.25), 0.7); }
    default: { return fallback; }
  }
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
  c.bgColor = vec3<f32>(0.15, 0.16, 0.18);
  c.ledOnColor = vec3<f32>(0.0, 0.85, 0.95);
  c.ledOffColor = vec3<f32>(0.08, 0.08, 0.10);
  c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
  c.housingSize = vec2<f32>(0.92, 0.92);
  return c;
}

// TRIG-001 / DURA-001 duration metadata
struct NoteDurationInfo {
  duration: u32,
  rowOffset: u32,
  isNoteOff: bool,
  isTrigger: bool,
}

fn unpackDurationInfo(packedA: u32, packedB: u32) -> NoteDurationInfo {
  var info: NoteDurationInfo;
  info.duration = (packedA >> 8) & 0xFFu;
  if (info.duration == 0u) { info.duration = 1u; }
  let durationFlags = (packedB >> 8) & 0x7Fu;
  info.rowOffset = durationFlags >> 1u;
  info.isNoteOff = (durationFlags & 1u) != 0u;
  info.isTrigger = ((packedB & 0x8000u) != 0u) || (info.rowOffset == 0u && !info.isNoteOff);
  return info;
}

fn drawChromeIndicator(
    uv: vec2<f32>,
    size: vec2<f32>,
    color: vec3<f32>,
    isOn: bool,
    aa: f32
) -> vec4<f32> {
    let uv01 = (uv / size) + vec2<f32>(0.5);
    let lensR = 0.7;
    let bezelR = 0.9;
    let center = vec2<f32>(0.5, 0.5);
    let dist = length(uv01 - center) * 2.0;

    var col = vec3<f32>(0.0);
    var alpha = 0.0;
    let offLens = vec3<f32>(0.06, 0.07, 0.09);
    let lensColor = select(offLens, color, isOn);

    if (dist < bezelR) {
        if (dist > lensR) {
            let angle = atan2(uv01.y - center.y, uv01.x - center.x);
            let rim = 0.2 + 0.8 * abs(sin(angle * 10.0));
            col = vec3<f32>(0.25, 0.28, 0.30) * rim;
            alpha = 1.0;
        } else {
            let lensNormR = dist / lensR;
            let z = sqrt(max(0.0, 1.0 - lensNormR * lensNormR));
            let localXY = (uv01 - center) / lensR;
            let normal = normalize(vec3<f32>(localXY.x, localXY.y, z));
            let lightDir = normalize(vec3<f32>(-0.5, 0.5, 1.0));
            let diffuse = max(0.0, dot(normal, lightDir));
            let reflectDir = reflect(-lightDir, normal);
            let specular = pow(max(0.0, dot(reflectDir, vec3<f32>(0.0, 0.0, 1.0))), 10.0);

            let baseColor = lensColor;
            col = baseColor * (0.5 + 0.8 * diffuse);
            col += vec3<f32>(1.0) * specular * select(0.12, 0.5, isOn);

            let rimGlow = exp(-pow(lensNormR, 2.0) * 6.0);
            col += baseColor * rimGlow * select(0.04, 0.25, isOn);
            alpha = 1.0;
        }
    } else {
        return vec4<f32>(vec3<f32>(0.0), 0.0);
    }

    let vignette = smoothstep(bezelR * 0.95, bezelR, dist);
    col = mix(col * (1.0 - 0.08 * vignette), vec3<f32>(0.02), vignette);

    return vec4<f32>(col, alpha);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.5;

  let maxRows = f32(uniforms.numRows);
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / maxRows) * maxRows;
  var delta = playheadStep - f32(in.row);
  if (delta < -maxRows * 0.5) { delta += maxRows; }
  else if (delta > maxRows * 0.5) { delta -= maxRows; }
  let onPlayhead = abs(delta) < 0.5;

  // --- INDICATOR RING (Channel 0 / Outer Ring) ---
  if (in.channel == 0u) {
    let indSize = vec2(0.3, 0.3);
    let indColor = select(vec3(0.2), fs.ledOnColor, onPlayhead);
    let indLed = drawChromeIndicator(p, indSize, indColor, onPlayhead, aa);

    var col = indLed.rgb;
    var alpha = indLed.a;
    if (onPlayhead) {
      let glow = fs.ledOnColor * 0.5 * exp(-length(p) * 5.0);
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.1, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // --- PATTERN ROWS ---
  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = fs.bgColor;
  finalColor += vec3(0.04) * (0.5 - uv.y);

  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var inButton = 0.0;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    let texColor = textureSampleLevel(buttonsTexture, buttonsSampler, btnUV, 0.0).rgb;
    finalColor = mix(finalColor, texColor, 0.7);
    inButton = 1.0;
  }

  // --- CHROME HARDWARE INDICATORS ---
  if (inButton > 0.5) {
    let note = (in.packedA >> 24) & 255u;
    let inst = (in.packedA >> 16) & 255u;
    let effCode = (in.packedB >> 8) & 255u;
    let effParam = in.packedB & 255u;

    let hasNote = (note >= NOTE_MIN && note <= NOTE_MAX);
    let hasEffect = (effParam > 0u);
    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);

    // Note activity: trigger + sustain rows track the full sounding arc until note-off
    var isTrigger = false;
    var isSustain = false;
    var isInSoundingArc = false;
    var isSounding = false;
    var noteFadeOut = 1.0;

    if (hasNote) {
      let dInfo = unpackDurationInfo(in.packedA, in.packedB);
      let isRealNoteOff = dInfo.isNoteOff || note >= NOTE_OFF_MIN;
      isTrigger = dInfo.isTrigger && !isRealNoteOff;
      isSustain = dInfo.rowOffset > 0u && !isRealNoteOff && !dInfo.isTrigger;

      if (isTrigger || isSustain) {
        let durationF = f32(dInfo.duration);
        let noteRelativeAge = delta + f32(dInfo.rowOffset);
        let cellOffset = f32(dInfo.rowOffset);

        let isCurrentNote = abs(noteRelativeAge - ch.noteAge) < NOTE_AGE_TOLERANCE;
        let channelLive = ch.noteAge < 999.0;
        let noteStillLive = ch.noteAge < durationF;
        let cellInArc = cellOffset < durationF;

        // Full arc (trigger + sustain) stays active from note-on through note-off
        isInSoundingArc = (uniforms.isPlaying == 1u) && channelLive && noteStillLive &&
                          cellInArc && isCurrentNote;
        isSounding = isTrigger && isInSoundingArc;

        // Fade-out only near note end — no fade-in
        if (isInSoundingArc && durationF > 0.0) {
          let fadeWindow = clamp(durationF * FADE_WINDOW_PCT, MIN_FADE_ROWS, MAX_FADE_ROWS);
          let fadeStart = durationF - fadeWindow;
          if (noteRelativeAge > fadeStart) {
            let fadeT = (noteRelativeAge - fadeStart) / fadeWindow;
            noteFadeOut = smoothstep(1.0, 0.0, fadeT);
          }
        }
      }
    }

    // COMPONENT 1: ACTIVITY LIGHT — cyan on trigger + sustain for full note, fade-out at end
    if (isTrigger || isSustain) {
      let topUV = btnUV - vec2(0.5, 0.16);
      let topSize = vec2(0.20, 0.20);
      let topActive = isInSoundingArc && !isMuted && (noteFadeOut > 0.02);
      let topColor = vec3(0.0, 0.9, 1.0) * noteFadeOut;

      let topLed = drawChromeIndicator(topUV, topSize, topColor, topActive, aa);
      finalColor = mix(finalColor, topLed.rgb, topLed.a);
      if (topActive) {
        finalColor += topColor * topLed.a * 0.5;
      }
    }

    // COMPONENT 2: MAIN NOTE LIGHT — dim pitch preview on all triggers, bright when sounding
    let mainUV = btnUV - vec2(0.5, 0.5);
    let mainSize = vec2(0.55, 0.45);

    var noteColor = vec3(0.2);
    var lightAmount = 0.0;

    if (isTrigger) {
      let pitchHue = pitchClassFromNote(note);
      let baseColor = neonPalette(pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.8 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.2;
      noteColor = baseColor * instBright;

      if (isSounding) {
        // Snap to full brightness at note-on; only fade-out near note end
        lightAmount = ACTIVE_NOTE_GLOW * noteFadeOut;
      } else {
        lightAmount = IDLE_NOTE_GLOW;
      }

      if (isMuted) { lightAmount *= 0.35; }
    } else if (note >= NOTE_OFF_MIN) {
      // Brief neutral pulse on note-off row at playhead
      if (abs(delta) < 0.5) {
        let cutPulse = (0.5 - abs(delta)) * 2.0;
        noteColor = vec3(0.35, 0.35, 0.45);
        lightAmount = cutPulse * 0.25;
      }
    }

    let displayColor = noteColor * lightAmount;
    let isLit = (lightAmount > 0.05);
    let mainPad = drawChromeIndicator(mainUV, mainSize, displayColor, isLit, aa);
    finalColor = mix(finalColor, mainPad.rgb, mainPad.a);

    // COMPONENT 3: EFFECT LIGHT
    let botUV = btnUV - vec2(0.5, 0.85);
    let botSize = vec2(0.25, 0.12);

    var effColor = vec3(0.0);
    var isEffOn = false;

    if (hasEffect) {
      effColor = effectColorFromCode(effCode, vec3(0.9, 0.8, 0.2));
      let strength = clamp(f32(effParam) / 255.0, 0.2, 1.0);
      if (!isMuted) {
        effColor *= strength;
        isEffOn = true;
      }
    }

    let botLed = drawChromeIndicator(botUV, botSize, effColor, isEffOn, aa);
    finalColor = mix(finalColor, botLed.rgb, botLed.a);
  }

  if (housingMask < 0.5) {
    return vec4(fs.borderColor, 0.0);
  }

  return vec4(finalColor, 1.0);
}
