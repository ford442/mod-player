// patternv0.27.wgsl
// Circular Ring Configuration (64 steps)
// V0.27: "White Hardware 64" - 64-step full circle + polished indicator ring

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

  let center = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let minDim = min(uniforms.canvasW, uniforms.canvasH);

  let maxRadius = minDim * 0.45;
  let minRadius = minDim * 0.15;
  let ringDepth = (maxRadius - minRadius) / f32(numChannels);

  let radius = minRadius + f32(channel) * ringDepth;

  // 64 steps around the full circle
  let totalSteps = 64.0;
  let anglePerStep = 6.2831853 / totalSteps;
  let theta = -1.570796 + f32(row % 64u) * anglePerStep;

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
  borderColor: vec3<f32>,
  housingSize: vec2<f32>,
};

fn getFragmentConstants() -> FragmentConstants {
  var c: FragmentConstants;
  // Dark chiclet keys to contrast with the white chassis pass
  c.bgColor = vec3<f32>(0.15, 0.16, 0.18);
  c.ledOnColor = vec3<f32>(0.0, 0.85, 0.95);
  c.ledOffColor = vec3<f32>(0.08, 0.08, 0.10);
  c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
  c.housingSize = vec2<f32>(0.92, 0.92);
  return c;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();
  let uv = in.uv;
  let p = uv - 0.5;

  // More stable AA under rotation/minification than fwidth(p.y) alone
  let aa = max(fwidth(p.x), fwidth(p.y)) * 0.85;

  let row64 = in.row % 64u;
  let play64 = uniforms.playheadRow % 64u;

  // --- INDICATOR RING (channel 0) ---
  if (in.channel == 0u) {
    var col = vec3<f32>(0.08, 0.09, 0.11);

    // Housing
    let housingSize = vec2<f32>(0.80, 0.60);
    let dHousing = sdRoundedBox(p, housingSize * 0.5, 0.06);
    let housingMask = 1.0 - smoothstep(0.0, aa, dHousing);

    // Subtle top bevel
    if (dHousing < 0.0 && dHousing > -0.06) {
      col += vec3<f32>(0.06) * smoothstep(0.0, -0.20, p.y);
    }
    col = mix(vec3<f32>(0.01), col, housingMask);

    let onPlayhead = (row64 == play64);
    let isBeatMarker = (row64 % 4u == 0u);

    // LED window
    let ledP = p - vec2<f32>(0.0, 0.15);
    let ledSize = vec2<f32>(0.22, 0.06);
    let dLed = sdRoundedBox(ledP, ledSize * 0.5, 0.02);
    let ledMask = 1.0 - smoothstep(-aa, aa, dLed);

    if (onPlayhead) {
      let ledColor = vec3<f32>(0.40, 0.90, 1.00);
      let bloom = exp(-max(dLed, 0.0) * 45.0);
      col += ledColor * ledMask * 1.8;
      col += ledColor * bloom * 0.28;
    } else if (isBeatMarker) {
      let markerColor = vec3<f32>(0.10, 0.25, 0.30);
      col += markerColor * ledMask;
    } else {
      col = mix(col, vec3<f32>(0.02), ledMask * 0.8);
    }

    if (housingMask < 0.15) {
      discard;
    }

    return vec4<f32>(col, 1.0);
  }

  // --- PATTERN ROWS ---
  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingAA = max(fwidth(dHousing), aa);
  let housingMask = 1.0 - smoothstep(0.0, housingAA * 2.0, dHousing);

  var finalColor = fs.bgColor;

  // Gentle chiclet gradient
  finalColor += vec3<f32>(0.02) * (0.5 - uv.y);

  // Small bevel highlight
  if (dHousing < 0.0 && dHousing > -0.06) {
    finalColor += vec3<f32>(0.10) * smoothstep(0.0, -0.12, p.y);
  }

  // --- BUTTON TEXTURE OVERLAY ---
  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var btnColor = vec3<f32>(0.0);
  var inButton = 0.0;

  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    btnColor = textureSampleLevel(buttonsTexture, buttonsSampler, btnUV, 0.0).rgb;
    inButton = 1.0;
  }
  if (inButton > 0.5) {
    finalColor = mix(finalColor, btnColor * 0.65, 0.9);
  }

  // --- DATA VISUALIZATION ---
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
    let topLightMask = (smoothstep(0.05, 0.06, y) - smoothstep(0.15, 0.16, y)) * indicatorXMask;

    let mainButtonYMask = smoothstep(0.23, 0.24, y) - smoothstep(0.80, 0.81, y);
    let mainButtonXMask = smoothstep(0.13, 0.14, x) - smoothstep(0.86, 0.87, x);

    let mainButtonMask = mainButtonYMask * mainButtonXMask;
    let bottomLightMask = (smoothstep(0.90, 0.91, y) - smoothstep(0.95, 0.96, y)) * indicatorXMask;

    if (ch.isMuted == 1u) {
      finalColor *= 0.3;
    }

    // TOP LIGHT: Activity
    if (step(0.1, exp(-ch.noteAge * 2.0)) > 0.5) {
      let topGlow = vec3<f32>(0.0, 0.9, 1.0);
      finalColor += topGlow * topLightMask * 1.2;
    }

    // MAIN LIGHT: Note
    if (hasNote) {
      let pitchHue = pitchClassFromPacked(in.packedA);
      let base_note_color = neonPalette(pitchHue);
      let instBand = inst & 15u;
      let instBrightness = 0.8 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.2;

      var noteColor = base_note_color * instBrightness;
      let flash = f32(ch.trigger) * 0.8;
      let activeLevel = exp(-ch.noteAge * 3.0);
      let lightAmount = (activeLevel * 0.8 + flash) * clamp(ch.volume, 0.0, 1.2);

      finalColor += noteColor * mainButtonMask * lightAmount * 2.0;
      finalColor += noteColor * housingMask * lightAmount * 0.12;
    }

    // BOTTOM LIGHT: Effect
    if (hasEffect) {
      let effectColor = effectColorFromCode(effCode, vec3<f32>(0.9, 0.8, 0.2));
      let strength = clamp(f32(effParam) / 255.0, 0.2, 1.0);
      finalColor += effectColor * bottomLightMask * strength * 2.0;
      finalColor += effectColor * housingMask * strength * 0.05;
    }

    // Playhead blink with 64-step wrap
    let rA = i32(row64);
    let rB = i32(play64);
    let distDirect = abs(rA - rB);
    let distWrap = 64 - distDirect;
    let rowDist = min(distDirect, distWrap);

    if (rowDist == 0 && !hasNote) {
      finalColor += vec3<f32>(0.15, 0.2, 0.25) * mainButtonMask;
    }
  }

  // Border gap
  if (housingMask < 0.5) {
    discard;
  }

  return vec4<f32>(finalColor, 1.0);
}
