// patternv0.25_clean.wgsl
// [Cleaned] Circular Ring Configuration
// V0.25-Clean: 128-step ring with v0.29 "physical component" styling

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

// --- VERTEX SHADER (CIRCULAR MAPPING - Unchanged from v0.25) ---
@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  // --- Circular Configuration ---
  let center = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let minDim = min(uniforms.canvasW, uniforms.canvasH);

  // Layout Dimensions
  let maxRadius = minDim * 0.45; // Keep away from edges
  let minRadius = minDim * 0.15; // Inner hole size
  let ringDepth = (maxRadius - minRadius) / f32(numChannels);

  // 1. Calculate Radius (Channel Index)
  let radius = minRadius + f32(channel) * ringDepth;

  // 2. Calculate Angle (Row Index)
  let totalSteps = 128.0;
  let anglePerStep = 6.2831853 / totalSteps;
  let theta = -1.570796 + f32(row % 128u) * anglePerStep;

  // 3. Calculate Cell Size (Dynamic based on circumference)
  let circumference = 2.0 * 3.14159265 * radius;
  let arcLength = circumference / totalSteps;

  let btnW = arcLength * 0.92;
  let btnH = ringDepth * 0.92;

  // 4. Transform Local Quad to World Space
  let lp = quad[vertexIndex];
  let localPos = (lp - 0.5) * vec2<f32>(btnW, btnH);

  let rotAng = theta + 1.570796;
  let cA = cos(rotAng);
  let sA = sin(rotAng);

  let rotX = localPos.x * cA - localPos.y * sA;
  let rotY = localPos.x * sA + localPos.y * cA;

  let worldX = center.x + cos(theta) * radius + rotX;
  let worldY = center.y + sin(theta) * radius + rotY;

  // 5. Convert to Clip Space
  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;

  // Fetch Data
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

// --- FRAGMENT SHADER (Ported from v0.29) ---

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
  c.bgColor = vec3<f32>(0.12, 0.13, 0.15); // Darker technical grey
  c.ledOnColor = vec3<f32>(0.0, 0.90, 1.0); // Bright cyan
  c.ledOffColor = vec3<f32>(0.06, 0.08, 0.10);
  c.housingSize = vec2<f32>(0.92, 0.92); // Physical size of the 'chip'
  return c;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fc = getFragmentConstants();
  let uv = in.uv;
  let p = uv - 0.5;

  // More stable AA calculation from v0.29
  let aa = max(fwidth(p.x), fwidth(p.y)) * 0.85;

  // --- INDICATOR RING (Channel 0) ---
  if (in.channel == 0u) {
    var col = fc.bgColor;

    // 1. Physical Housing (Rounded Rect)
    let dHousing = sdRoundedBox(p, vec2<f32>(0.86, 0.72) * 0.5, 0.08);
    let housingMask = 1.0 - smoothstep(0.0, aa * 2.0, dHousing);

    // 2. Bevel Highlight (Top Edge)
    if (dHousing < 0.0 && dHousing > -0.08) {
      col += vec3<f32>(0.06) * smoothstep(0.0, -0.20, p.y);
    }

    col = mix(vec3<f32>(0.01), col, housingMask);

    let onPlayhead = ((in.row % 128u) == (uniforms.playheadRow % 128u));
    let isBeatMarker = ((in.row % 4u) == 0u);

    // 3. LED Bulb (Inner Shape)
    let ledP = p - vec2<f32>(0.0, 0.14);
    let dLed = sdRoundedBox(ledP, vec2<f32>(0.30, 0.10) * 0.5, 0.03);
    let ledMask = 1.0 - smoothstep(-aa, aa, dLed);

    col = mix(col, fc.ledOffColor, ledMask);

    // 4. Sharp Bloom
    if (onPlayhead) {
      let bloom = exp(-max(dLed, 0.0) * 35.0);
      col += fc.ledOnColor * ledMask * 1.7;
      col += fc.ledOnColor * bloom * 0.32;
    } else if (isBeatMarker) {
      col += vec3<f32>(0.10, 0.18, 0.20) * ledMask;
    }

    // 5. Transparency Cutout
    if (housingMask < 0.15) {
      discard;
    }

    return vec4<f32>(col, 1.0);
  }

  // --- PATTERN CELLS (Other Channels) ---

  // 1. Physical Housing
  let dHousing = sdRoundedBox(p, fc.housingSize * 0.5, 0.08);
  let housingMask = 1.0 - smoothstep(0.0, aa * 2.0, dHousing);

  var finalColor = fc.bgColor;

  // Chiclet gradient
  finalColor += vec3<f32>(0.02) * (0.5 - uv.y);

  // 2. Bevel Highlight
  if (dHousing < 0.0 && dHousing > -0.10) {
    finalColor += vec3<f32>(0.10) * smoothstep(0.0, -0.18, p.y);
  }

  // Texture overlay
  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    let btnColor = textureSampleLevel(buttonsTexture, buttonsSampler, btnUV, 0.0).rgb;
    finalColor = mix(finalColor, btnColor * 0.65, 0.9);
  }

  // Data visualization
  let x = btnUV.x;
  let y = btnUV.y;

  let noteChar = (in.packedA >> 24) & 255u;
  let inst = in.packedA & 255u;
  let effCode = (in.packedB >> 8) & 255u;
  let effParam = in.packedB & 255u;
  let hasNote = (noteChar >= 65u && noteChar <= 71u);
  let hasEffect = (effParam > 0u);
  let ch = channels[in.channel];

  let indicatorXMask = smoothstep(0.4, 0.41, x) - smoothstep(0.6, 0.61, x);
  let topLightMask = (smoothstep(0.05, 0.06, y) - smoothstep(0.15, 0.16, y)) * indicatorXMask;

  let mainButtonYMask = smoothstep(0.23, 0.24, y) - smoothstep(0.80, 0.81, y);
  let mainButtonXMask = smoothstep(0.13, 0.14, x) - smoothstep(0.86, 0.87, x);
  let mainButtonMask = mainButtonYMask * mainButtonXMask;

  let bottomLightMask = (smoothstep(0.90, 0.91, y) - smoothstep(0.95, 0.96, y)) * indicatorXMask;

  if (ch.isMuted == 1u) {
    finalColor *= 0.3;
  }

  // Activity hint
  if (step(0.1, exp(-ch.noteAge * 2.0)) > 0.5) {
    finalColor += vec3<f32>(0.0, 0.9, 1.0) * topLightMask * 1.2;
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

    finalColor += noteColor * mainButtonMask * lightAmount * 2.0;
    finalColor += noteColor * housingMask * lightAmount * 0.12;
  }

  if (hasEffect) {
    let effectColor = effectColorFromCode(effCode, vec3<f32>(0.9, 0.8, 0.2));
    let strength = clamp(f32(effParam) / 255.0, 0.2, 1.0);
    finalColor += effectColor * bottomLightMask * strength * 2.0;
    finalColor += effectColor * housingMask * strength * 0.05;
  }

  // Playhead blink (128-step wrap)
  let rA = i32(in.row % 128u);
  let rB = i32(uniforms.playheadRow % 128u);
  let distDirect = abs(rA - rB);
  let distWrap = 128 - distDirect;
  let rowDist = min(distDirect, distWrap);
  if (rowDist == 0 && !hasNote) {
    finalColor += vec3<f32>(0.15, 0.2, 0.25) * mainButtonMask;
  }

  // 3. Transparency Cutout
  if (housingMask < 0.5) {
    discard;
  }

  return vec4<f32>(finalColor, 1.0);
}
