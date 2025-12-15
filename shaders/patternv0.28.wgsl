// patternv0.28.wgsl
// [gemini3propreview] Chassis + Buttons (alpha blended)
// V0.28: grid buttons with soft drop shadows; relies on background pass behind

// Horizontal Pattern Grid Shader (Time = X, Channels = Y)

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

  let px = f32(row) * uniforms.cellW;
  let py = f32(channel) * uniforms.cellH;

  let lp = quad[vertexIndex];
  let worldX = px + lp.x * uniforms.cellW;
  let worldY = py + lp.y * uniforms.cellH;

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

fn pitchClassFromPacked(packed: u32) -> f32 {
  let c0 = toUpperAscii((packed >> 24) & 255u);
  var semitone: i32 = 0;
  var valid = true;
  switch (c0) {
    case 65u: { semitone = 9; }
    case 66u: { semitone = 11; }
    case 67u: { semitone = 0; }
    case 68u: { semitone = 2; }
    case 69u: { semitone = 4; }
    case 70u: { semitone = 5; }
    case 71u: { semitone = 7; }
    default: { valid = false; }
  }
  if (!valid) { return 0.0; }
  let c1 = toUpperAscii((packed >> 16) & 255u);
  if ((c1 == 35u) || (c1 == 43u)) {
    semitone = (semitone + 1) % 12;
  } else if (c1 == 66u) {
    semitone = (semitone + 11) % 12;
  }
  return f32(semitone) / 12.0;
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
  housingSize: vec2<f32>,
};

fn getFragmentConstants() -> FragmentConstants {
  var c: FragmentConstants;
  // Dark chiclet keys against a white chassis background pass
  c.bgColor = vec3<f32>(0.16, 0.17, 0.19);
  c.ledOnColor = vec3<f32>(0.0, 0.85, 0.95);
  c.ledOffColor = vec3<f32>(0.05, 0.07, 0.09);
  c.housingSize = vec2<f32>(0.92, 0.92);
  return c;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fc = getFragmentConstants();
  let uv = in.uv;
  let p = uv - 0.5;

  // Stable AA at small sizes
  let aa = max(fwidth(p.x), fwidth(p.y)) * 0.9;

  // --- Top row: indicator LEDs (alpha blended over chassis) ---
  if (in.channel == 0u) {
    // Small housing + shadow so the indicator row reads as hardware
    let dHousing = sdRoundedBox(p, vec2<f32>(0.86, 0.72) * 0.5, 0.08);
    let housingMask = 1.0 - smoothstep(0.0, aa * 2.0, dHousing);

    let shadowOffset = vec2<f32>(0.06, 0.06);
    let dShadow = sdRoundedBox(p - shadowOffset, vec2<f32>(0.86, 0.72) * 0.5, 0.10);
    let shadowMask = 1.0 - smoothstep(0.0, 0.18, dShadow);
    let shadowAlpha = clamp(shadowMask * (1.0 - housingMask) * 0.28, 0.0, 1.0);

    if (housingMask < 0.02) {
      return vec4<f32>(vec3<f32>(0.0), shadowAlpha);
    }

    var col = fc.bgColor;

    // Soft bevel
    if (dHousing < 0.0 && dHousing > -0.08) {
      col += vec3<f32>(0.05) * smoothstep(0.0, -0.20, p.y);
    }

    // LED window
    let onPlayhead = (in.row == uniforms.playheadRow);
    let isBeatMarker = (in.row % 4u == 0u);

    let ledP = p - vec2<f32>(0.0, 0.14);
    let dLed = sdRoundedBox(ledP, vec2<f32>(0.30, 0.10) * 0.5, 0.03);
    let ledMask = 1.0 - smoothstep(-aa, aa, dLed);

    // Base off-state
    col = mix(col, fc.ledOffColor, ledMask);

    if (onPlayhead) {
      let bloom = exp(-max(dLed, 0.0) * 35.0);
      col += fc.ledOnColor * ledMask * 1.6;
      col += fc.ledOnColor * bloom * 0.35;
    } else if (isBeatMarker) {
      col += vec3<f32>(0.12, 0.14, 0.16) * ledMask;
    }

    return vec4<f32>(col, 1.0);
  }

  // --- Pattern rows: chiclet button + alpha shadow ---
  let dHousing = sdRoundedBox(p, fc.housingSize * 0.5, 0.08);
  let housingMask = 1.0 - smoothstep(0.0, aa * 2.0, dHousing);

  // Shadow is drawn outside housing via alpha blending
  let shadowOffset = vec2<f32>(0.06, 0.07);
  let dShadow = sdRoundedBox(p - shadowOffset, fc.housingSize * 0.5, 0.10);
  let shadowMask = 1.0 - smoothstep(0.0, 0.22, dShadow);
  let shadowAlpha = clamp(shadowMask * (1.0 - housingMask) * 0.30, 0.0, 1.0);

  if (housingMask < 0.02) {
    return vec4<f32>(vec3<f32>(0.0), shadowAlpha);
  }

  var finalColor = fc.bgColor;

  // Gentle chiclet gradient
  finalColor += vec3<f32>(0.02) * (0.5 - uv.y);

  // Top bevel highlight
  if (dHousing < 0.0 && dHousing > -0.10) {
    finalColor += vec3<f32>(0.08) * smoothstep(0.0, -0.18, p.y);
  }

  // --- Button texture overlay ---
  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var btnColor = vec3<f32>(0.0);
  var inButton = 0.0;

  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    btnColor = textureSampleLevel(buttonsTexture, buttonsSampler, btnUV, 0.0).rgb;
    inButton = 1.0;
  }
  if (inButton > 0.5) {
    finalColor = mix(finalColor, btnColor * 0.70, 0.85);
  }

  // --- Data visualization (same semantics as other extended shaders) ---
  let x = btnUV.x;
  let y = btnUV.y;

  let noteChar = (in.packedA >> 24) & 255u;
  let inst = in.packedA & 255u;
  let effCode = (in.packedB >> 8) & 255u;
  let effParam = in.packedB & 255u;
  let hasNote = (noteChar >= 65u && noteChar <= 71u);
  let hasEffect = (effParam > 0u);
  let ch = channels[in.channel];

  if (inButton > 0.5) {
    let indicatorXMask = smoothstep(0.4, 0.41, x) - smoothstep(0.6, 0.61, x);
    let topLightMask = (smoothstep(0.05, 0.06, y) - smoothstep(0.16, 0.17, y)) * indicatorXMask;

    let mainButtonYMask = smoothstep(0.23, 0.24, y) - smoothstep(0.80, 0.81, y);
    let mainButtonXMask = smoothstep(0.13, 0.14, x) - smoothstep(0.86, 0.87, x);

    let mainButtonMask = mainButtonYMask * mainButtonXMask;
    let bottomLightMask = (smoothstep(0.90, 0.91, y) - smoothstep(0.95, 0.96, y)) * indicatorXMask;

    if (ch.isMuted == 1u) {
      finalColor *= 0.35;
    }

    // Activity hint
    if (step(0.1, exp(-ch.noteAge * 2.0)) > 0.5) {
      finalColor += fc.ledOnColor * topLightMask * 1.2;
    }

    if (hasNote) {
      let pitchHue = pitchClassFromPacked(in.packedA);
      let base_note_color = neonPalette(pitchHue);
      let instBand = inst & 15u;
      let instBrightness = 0.8 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.2;

      let noteColor = base_note_color * instBrightness;
      let flash = f32(ch.trigger) * 0.8;
      let activeLevel = exp(-ch.noteAge * 3.0);
      let lightAmount = (activeLevel * 0.8 + flash) * clamp(ch.volume, 0.0, 1.2);

      finalColor += noteColor * mainButtonMask * lightAmount * 1.9;
      finalColor += noteColor * housingMask * lightAmount * 0.12;
    }

    if (hasEffect) {
      let effectColor = effectColorFromCode(effCode, vec3<f32>(0.9, 0.8, 0.2));
      let strength = clamp(f32(effParam) / 255.0, 0.2, 1.0);
      finalColor += effectColor * bottomLightMask * strength * 2.0;
      finalColor += effectColor * housingMask * strength * 0.05;
    }

    // Playhead blink on empty active cell
    let rowDist = abs(i32(in.row) - i32(uniforms.playheadRow));
    if (rowDist == 0 && !hasNote) {
      finalColor += vec3<f32>(0.12, 0.14, 0.16) * mainButtonMask;
    }
  }

  return vec4<f32>(finalColor, 1.0);
}
