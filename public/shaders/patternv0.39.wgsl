// patternv0.39.wgsl
// Horizontal Paged Grid Shader (Time = X, Channels = Y)
// Base: v0.21 (Precision Interface)
// Adapted for WebGL2 Glass Overlay + Square Bezel Layout (1024x1024)

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
  bloomIntensity: f32,
  bloomThreshold: f32,
  invertChannels: u32,
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

  // Horizontal Layout: X = Row (Time), Y = Channel
  // Static Paged Grid: We only render active page of 32 steps.
  
  let stepsPerPage = 32.0;
  let pageStart = floor(f32(uniforms.playheadRow) / stepsPerPage) * stepsPerPage;
  
  // Calculate row local to current page (0..31)
  let localRow = f32(row) - pageStart;
  
  // X Position based on local row
  let px = localRow * uniforms.cellW;
  let py = f32(channel) * uniforms.cellH;
  
  // If this instance is NOT in the current page, we move it off-screen to clip it
  var isVisible = 1.0;
  if (localRow < 0.0 || localRow >= stepsPerPage) {
      isVisible = 0.0;
  }
  
  // Standard quad expansion
  // Note: if invisible, we can just collapse quad or move off screen
  let worldX = px + quad[vertexIndex].x * uniforms.cellW;
  let worldY = py + quad[vertexIndex].y * uniforms.cellH;

  // Use top-left origin for logic, but clip space is -1..1
  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;

  // Collapse if not visible
  let finalPos = select(vec4<f32>(0.0), vec4<f32>(clipX, clipY, 0.0, 1.0), isVisible > 0.5);

  let idx = instanceIndex * 2u;
  let a = cells[idx];
  let b = cells[idx + 1u];

  var out: VertexOut;
  out.position = finalPos;
  out.row = row;
  out.channel = channel;
  out.uv = quad[vertexIndex];
  out.packedA = a;
  out.packedB = b;
  return out;
}

// --- FRAGMENT SHADER (Precision Interface with Frosted Caps) ---

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
    switch c0 {
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
    c.bgColor = vec3<f32>(0.10, 0.11, 0.13);
    c.ledOnColor = vec3<f32>(0.0, 0.85, 0.95);
    c.ledOffColor = vec3<f32>(0.08, 0.12, 0.15);
    c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
    c.housingSize = vec2<f32>(0.96, 0.96);
    return c;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.75;

  // --- HEADER ROW (Channel 0) ---
  if (in.channel == 0u) {
      // Header for channel indices or status
      var col = fs.bgColor * 0.8;
      return vec4<f32>(col, 1.0);
  }

  // --- PATTERN GRID ---
  // Housing (Cell Body)
  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.04);
  let housingMask = 1.0 - smoothstep(0.0, aa * 2.0, dHousing);
  
  var col = fs.bgColor;
  
  // Inset shadow
  col *= smoothstep(0.0, 0.1, dHousing + 0.5);

  let onPlayhead = (in.row == uniforms.playheadRow);
  
  // Get note and effect data
  let note = (in.packedA >> 24) & 255u;
  let inst = in.packedA & 255u;
  let effCode = (in.packedB >> 8) & 255u;
  let effParam = in.packedB & 255u;
  let hasNote = (note >= 65u && note <= 71u);
  let hasEffect = (effParam > 0u);
  
  // Get channel state for note activity
  let ch = channels[in.channel];
  
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
      col = mix(col, btnColor * 0.6, 0.9);
  }

  // --- FROSTED CAPS (Top and Bottom Lights) ---
  if (inButton > 0.5) {
      // Refined masks using AA sharpness for perfectly symmetrical caps
      let mainButtonXMask = smoothstep(0.13 - aa, 0.13 + aa, btnUV.x) - smoothstep(0.86 - aa, 0.86 + aa, btnUV.x);

      // 1. TOP CAP: Activity/Note indicator (The "Frosted Glass" effect)
      // Widened the Y range to make it a block rather than a slit, matching button width
      let topLightMask = (smoothstep(0.05 - aa, 0.05 + aa, btnUV.y) - smoothstep(0.18 - aa, 0.18 + aa, btnUV.y)) * mainButtonXMask;

      // 2. Main Button Body (Centered with equal 0.04 gap from caps)
      let mainButtonYMask = smoothstep(0.22 - aa, 0.22 + aa, btnUV.y) - smoothstep(0.78 - aa, 0.78 + aa, btnUV.y);
      let mainButtonMask = mainButtonYMask * mainButtonXMask;

      // 3. BOTTOM CAP: Effect indicator (Symmetrical to top cap)
      let bottomLightMask = (smoothstep(0.82 - aa, 0.82 + aa, btnUV.y) - smoothstep(0.95 - aa, 0.95 + aa, btnUV.y)) * mainButtonXMask;

      if (ch.isMuted == 1u) {
          col *= 0.3;
      }

      // TOP LIGHT: Note Activity (Additive glow - the "frosted cap")
      if (hasNote || step(0.1, exp(-ch.noteAge * 2.0)) > 0.5) {
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

          // 1. Additive Core Bloom on top cap
          col += noteColor * topLightMask * lightAmount * 2.0;

          // 2. Main button body glow
          col += noteColor * mainButtonMask * lightAmount * 1.5;

          // 3. Subsurface Scattering (Tint the housing)
          let subsurface = noteColor * housingMask * lightAmount * 0.15;
          col += subsurface;
      } else {
          // Idle state - subtle frosted cap
          col += vec3<f32>(0.0, 0.3, 0.4) * topLightMask * 0.3;
      }

      // BOTTOM LIGHT: Effect (Additive)
      if (hasEffect) {
          let effectColor = effectColorFromCode(effCode, vec3<f32>(0.9, 0.8, 0.2));
          let strength = clamp(f32(effParam) / 255.0, 0.2, 1.0);
          col += effectColor * bottomLightMask * strength * 2.5;
          // Slight subsurface for effect too
          col += effectColor * housingMask * strength * 0.05;
      }

      // Row 0 Proximity (Playhead) Blink
      let rowDist = abs(i32(in.row) - i32(uniforms.playheadRow));
      if (rowDist == 0 && !hasNote) {
          // Additive white glance on empty active cell
          col += vec3<f32>(0.15, 0.2, 0.25) * mainButtonMask;
      }
  }

  // Playhead Highlight (Vertical Line across active column)
  if (onPlayhead) {
      // Additive highlight
      col += vec3<f32>(0.2, 0.2, 0.25) * 0.8;
  }

  // Border
  col = mix(col, fs.borderColor, smoothstep(0.0, aa, dHousing));

  return vec4<f32>(col, 1.0);
}
