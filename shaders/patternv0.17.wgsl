// Horizontal Pattern Grid Shader (Time = X, Channels = Y)
// V4: Hardware Rack Style + Top Indicators
// - Added visual row 0 as playhead indicators
// - Increased spacing between steps
// - Lighter "plastic" background
// - Removed old playhead column highlight

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
  @location(3) @interpolate(flat) packedA: u32, // Note/Inst
  @location(4) @interpolate(flat) packedB: u32, // Vol/Effect/Param
};

// --- VERTEX SHADER ---
@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels; // This is now N+1
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  let px = f32(row) * uniforms.cellW;
  let py = f32(channel) * uniforms.cellH;

  let lp = quad[vertexIndex];
  let worldX = px + lp.x * uniforms.cellW;
  let worldY = py + lp.y * uniforms.cellH;

  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;

  // Data access: Assumes buffer is padded/interleaved correctly by CPU
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
    let a = vec3<f32>(0.5, 0.5, 0.5);
    let b = vec3<f32>(0.5, 0.5, 0.5);
    let c = vec3<f32>(1.0, 1.0, 1.0);
    let d = vec3<f32>(0.263, 0.416, 0.557);
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
  borderThickness: f32,
  borderColor: vec3<f32>,
};

fn getFragmentConstants() -> FragmentConstants {
    var c: FragmentConstants;
    c.bgColor = vec3<f32>(0.12, 0.12, 0.14); // Lighter dark plastic
    c.ledOnColor = vec3<f32>(1.0, 0.3, 0.2); // Orange/Red glow
    c.ledOffColor = vec3<f32>(0.15, 0.05, 0.05); // Dark red
    c.borderThickness = 2.0; // Thicker spacing
    c.borderColor = vec3<f32>(0.05, 0.05, 0.07); // Gap color
    return c;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();
  let uv = in.uv;
  let p = uv - 0.5;

  // --- TOP ROW: INDICATORS ---
  if (in.channel == 0u) {
      // Background for header
      var col = fs.bgColor * 0.8;

      // Draw LED
      // Small circle or box
      let onPlayhead = (in.row == uniforms.playheadRow);
      let ledSize = vec2<f32>(0.25, 0.25);
      let dLed = sdRoundedBox(p, ledSize, 0.1);

      var ledCol = fs.ledOffColor;
      if (onPlayhead) {
          ledCol = fs.ledOnColor * 1.5;
          // Add pulse
          ledCol += sin(uniforms.timeSec * 20.0) * 0.2;
      } else {
         // Beat markers (every 4th)
         if (in.row % 4u == 0u) {
             ledCol = vec3<f32>(0.2, 0.2, 0.25);
         }
      }

      let ledMask = smoothstep(0.01, -0.01, dLed);
      col = mix(col, ledCol, ledMask);

      // Glow for active LED
      if (onPlayhead) {
         let glow = exp(-dLed * 4.0) * fs.ledOnColor * 0.5;
         col += glow;
      }

      return vec4<f32>(col, 1.0);
  }

  // --- PATTERN ROWS ---
  // Channel 1..N correspond to data channels 0..N-1
  // We use in.channel directly because the buffer is padded (channels[0] is dummy)
  // But for logic relying on 'channel index', we might want (in.channel - 1)

  // Housing (Cell Body)
  // Make it smaller to increase gaps
  let housingSize = vec2<f32>(0.85, 0.85); // Previously 0.92
  let dHousing = sdRoundedBox(p, housingSize * 0.5, 0.08);

  var finalColor = fs.bgColor;

  // Bevel/3D effect for the button hole
  let bevel = smoothstep(0.05, 0.0, dHousing) * smoothstep(-0.1, 0.0, dHousing);
  if (dHousing < 0.0) {
      finalColor += vec3<f32>(0.05) * (0.5 - uv.y); // Gradient
  }
  // Highlight edge
  if (dHousing < 0.02 && dHousing > -0.02) {
      let angle = atan2(p.y, p.x);
      let light = cos(angle + 2.0);
      finalColor += vec3<f32>(0.1) * light;
  }

  // --- BUTTON TEXTURE ---
  let btnScale = 1.1; // Slightly smaller button
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var btnColor = vec3<f32>(0.0);
  var inButton = 0.0;

  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
      btnColor = textureSampleLevel(buttonsTexture, buttonsSampler, btnUV, 0.0).rgb;
      inButton = 1.0;
  }

  if (inButton > 0.5) {
      finalColor = mix(finalColor, btnColor, 1.0);
  }

  // Use btnUV for inner lights
  let tiledUV = btnUV;
  let x = tiledUV.x;
  let y = tiledUV.y;

  // --- UNPACK DATA ---
  let noteChar = (in.packedA >> 24) & 255u;
  let inst = in.packedA & 255u;
  let effCode = (in.packedB >> 8) & 255u;
  let effParam = in.packedB & 255u;
  let hasNote = (noteChar >= 65u && noteChar <= 71u);
  let hasEffect = (effParam > 0u);
  let ch = channels[in.channel]; // Using padded channel buffer

  if (inButton > 0.5) {
      // Masks for lights (same as v0.14 but maybe tweaked)
      let indicatorXMask = smoothstep(0.4, 0.41, x) - smoothstep(0.6, 0.61, x);
      let topLightMask    = (smoothstep(0.10, 0.11, y) - smoothstep(0.20, 0.21, y)) * indicatorXMask;
      let mainButtonYMask  = smoothstep(0.23, 0.24, y) - smoothstep(0.82, 0.83, y);
      let mainButtonXMask = smoothstep(0.1, 0.11, x) - smoothstep(0.9, 0.91, x);
      let mainButtonMask = mainButtonYMask * mainButtonXMask;
      let bottomLightMask = (smoothstep(0.90, 0.91, y) - smoothstep(0.95, 0.96, y)) * indicatorXMask;

      // ** Muted Channel Dimming **
      if (ch.isMuted == 1u) {
          finalColor *= 0.3;
      }

      // ** "Channel Active" -> Top Light **
      let noteTrail = exp(-ch.noteAge * 2.0);
      let channelActive = step(0.1, noteTrail);
      if (channelActive > 0.5) {
          let topGlow = vec3<f32>(0.5, 0.8, 1.0);
          finalColor = mix(finalColor, finalColor + topGlow, topLightMask);
      }

      // ** "Has Note" -> Main Button **
      if (hasNote) {
          let pitchHue = pitchClassFromPacked(in.packedA);
          let base_note_color = neonPalette(pitchHue);
          let instBand = inst & 15u;
          let instBrightness = 0.7 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.3;
          let octaveChar = (in.packedA >> 8) & 255u;
          let octaveF = f32(octaveChar) - 48.0;
          let octaveDelta = clamp(octaveF, 1.0, 8.0) - 4.0;
          let octaveLightness = 1.0 + octaveDelta * 0.15;

          var noteColor = base_note_color * instBrightness * octaveLightness;
          let triggerFlash = noteColor * 1.5 + 0.5;
          noteColor = mix(noteColor, triggerFlash, f32(ch.trigger) * 0.8);

          let volAlpha = clamp(ch.volume, 0.05, 1.0);
          let mixAmount = mainButtonMask * volAlpha * noteTrail;
          finalColor = mix(finalColor, noteColor, mixAmount);
      }

      // ** "Has Effect" -> Bottom Light **
      if (hasEffect) {
          let effectColor = effectColorFromCode(effCode, vec3<f32>(0.8, 0.8, 0.8));
          let strength = clamp(f32(effParam) / 255.0, 0.2, 1.0);
          let effectPulse = 1.0 + 0.5 * sin(uniforms.timeSec * 15.0);
          let bottomGlow = (effectColor * strength * effectPulse) * 1.5;
          finalColor = mix(finalColor, finalColor + bottomGlow, bottomLightMask);
      }

      // Removed Playhead Dimming/Highlight logic on the cells
  }

  // --- GAP / BORDER ---
  // Using background color for gaps
  // No need to draw black, just let the housing define the shape
  // But we want a "gap" color (darker plastic/metal) outside the housing

  // Calculate alpha for housing vs gap
  // Actually, sdRoundedBox is centered. Outside of it is the gap.
  // We can just return finalColor. The areas outside dHousing < 0.08 were not touched much except by "bevel"
  // Let's ensure the background outside the cell is dark
  if (dHousing > 0.05) {
      return vec4<f32>(fs.borderColor, 1.0);
  }

  return vec4<f32>(finalColor, 1.0);
}
