// Horizontal Pattern Grid Shader (Time = X, Channels = Y)
// V0.21: "Precision Interface" - Sharpened details, larger cells, fwidth-based AA

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

// --- VERTEX SHADER ---
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

// --- FRAGMENT SHADER ---

fn neonPalette(t: f32) -> vec3<f32> {
    // Precise, colder spectrum
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
    c.bgColor = vec3<f32>(0.10, 0.11, 0.13); // Deep technical grey
    c.ledOnColor = vec3<f32>(0.0, 0.85, 0.95); // Precision Cyan
    c.ledOffColor = vec3<f32>(0.08, 0.12, 0.15); // Dark blue-grey
    c.borderColor = vec3<f32>(0.0, 0.0, 0.0); // Pure black gap
    c.housingSize = vec2<f32>(0.96, 0.96); // Maximized cell usage (Bigger Display)
    return c;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();
  let uv = in.uv;
  let p = uv - 0.5;

  // Calculate Pixel-Perfect AA width based on derivatives
  let aa = fwidth(p.y) * 0.75;

  // --- TOP ROW: INDICATORS ---
  if (in.channel == 0u) {
      var col = fs.bgColor * 0.5;

      let onPlayhead = (in.row == uniforms.playheadRow);
      let ledSize = vec2<f32>(0.3, 0.3);
      let dLed = sdRoundedBox(p, ledSize, 0.05);

      // Dark "off" state
      var ledCol = fs.ledOffColor;

      // Sharp LED rendering (Base Plastic)
      let ledMask = 1.0 - smoothstep(-aa, aa, dLed);
      col = mix(col, ledCol, ledMask);

      // BLEND: Additive Glow for "On" state
      if (onPlayhead) {
         let glowIntensity = exp(-dLed * 5.0);
         // Add bright core + soft bloom
         col += fs.ledOnColor * ledMask * 1.5;
         col += fs.ledOnColor * glowIntensity * 0.8;
      } else if (in.row % 4u == 0u) {
         // Faint marker for beats
         col += vec3<f32>(0.2, 0.2, 0.25) * ledMask * 0.3;
      }

      return vec4<f32>(col, 1.0);
  }

  // --- PATTERN ROWS ---
  // Housing (Cell Body) - Larger and sharper
  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.04);
  let housingMask = 1.0 - smoothstep(0.0, aa * 2.0, dHousing);

  var finalColor = fs.bgColor;

  // Subtle Gradient for "machined" look
  finalColor += vec3<f32>(0.03) * (0.5 - uv.y);

  // Bevel Highlight (Top Edge)
  if (dHousing < 0.0 && dHousing > -0.04) {
      finalColor += vec3<f32>(0.15) * smoothstep(0.0, -0.1, p.y);
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
      // Darken texture for "stealth" look
      finalColor = mix(finalColor, btnColor * 0.6, 0.9);
  }

  // --- DATA VISUALIZATION ---
  let tiledUV = btnUV;
  let x = tiledUV.x;
  let y = tiledUV.y;

  let noteChar = (in.packedA >> 24) & 255u;
  let inst = in.packedA & 255u;
  let effCode = (in.packedB >> 8) & 255u;
  let effParam = in.packedB & 255u;
  let hasNote = (noteChar >= 65u && noteChar <= 71u);
  let hasEffect = (effParam > 0u);
  let ch = channels[in.channel];

  if (inButton > 0.5) {
      // Refined masks using AA sharpness
      let indicatorXMask = smoothstep(0.4, 0.41, x) - smoothstep(0.6, 0.61, x);
      let topLightMask    = (smoothstep(0.12, 0.13, y) - smoothstep(0.18, 0.19, y)) * indicatorXMask;
      let mainButtonYMask  = smoothstep(0.25, 0.26, y) - smoothstep(0.80, 0.81, y);
      let mainButtonXMask = smoothstep(0.12, 0.13, x) - smoothstep(0.88, 0.89, x);
      let mainButtonMask = mainButtonYMask * mainButtonXMask;
      let bottomLightMask = (smoothstep(0.91, 0.92, y) - smoothstep(0.95, 0.96, y)) * indicatorXMask;

      if (ch.isMuted == 1u) {
          finalColor *= 0.3;
      }

      // TOP LIGHT: Activity (Additive)
      if (step(0.1, exp(-ch.noteAge * 2.0)) > 0.5) {
          let topGlow = vec3<f32>(0.0, 0.9, 1.0);
          // Additive blend
          finalColor += topGlow * topLightMask * 1.5;
      }

      // MAIN LIGHT: Note (Additive + Subsurface)
      if (hasNote) {
          let pitchHue = pitchClassFromPacked(in.packedA);
          let base_note_color = neonPalette(pitchHue);
          let instBand = inst & 15u;
          let instBrightness = 0.8 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.2;

          var noteColor = base_note_color * instBrightness;

          // Flash intensity based on trigger
          let flash = f32(ch.trigger) * 0.8;

          // Calculate additive light amount
          let activeLevel = exp(-ch.noteAge * 3.0);
          let lightAmount = (activeLevel * 0.8 + flash) * clamp(ch.volume, 0.0, 1.2);

          // 1. Additive Core Bloom
          finalColor += noteColor * mainButtonMask * lightAmount * 2.0;

          // 2. Tasteful Subsurface Scattering (Tint the housing)
          // This makes the grey plastic look like it's glowing from inside
          let subsurface = noteColor * housingMask * lightAmount * 0.15;
          finalColor += subsurface;
      }

      // BOTTOM LIGHT: Effect (Additive)
      if (hasEffect) {
          let effectColor = effectColorFromCode(effCode, vec3<f32>(0.9, 0.8, 0.2));
          let strength = clamp(f32(effParam) / 255.0, 0.2, 1.0);
          finalColor += effectColor * bottomLightMask * strength * 2.5;
          // Slight subsurface for effect too
          finalColor += effectColor * housingMask * strength * 0.05;
      }

      // Row 0 Proximity (Playhead) Blink
      let rowDist = abs(i32(in.row) - i32(uniforms.playheadRow));
      if (rowDist == 0 && !hasNote) {
          // Additive white glance on empty active cell
          finalColor += vec3<f32>(0.15, 0.2, 0.25) * mainButtonMask;
      }
  }

  // --- 1px BORDER GAP ---
  if (housingMask < 0.5) {
      return vec4<f32>(fs.borderColor, 1.0);
  }

  return vec4<f32>(finalColor, 1.0);
}
