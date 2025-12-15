// filepath: g:\github\react-dom\shaders\patternv0.14.wgsl
// Horizontal Pattern Grid Shader (Time = X, Channels = Y)
// V2: Refactored by "Custom Coding partner" to use fwidth() for AA
// and a constants struct for easier tweaking.

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

// --- VERTEX SHADER (Unchanged) ---
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
    if (!valid) {
        return 0.0;
    }
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
  bgColorA: vec3<f32>,
  bgColorB: vec3<f32>,
  playheadBeamColor: vec3<f32>,
  playheadBeamIntensity: f32,
  pillSize: vec2<f32>,
  pillRadius: f32,
  noteIntensity: f32,
  glowFalloff: f32,
  glowIntensity: f32,
  hueMagic: f32,
  effectPos: vec2<f32>,
  effectRadius: f32,
  effectColor: vec3<f32>,
  effectIntensity: f32,
  buttonTexScale: vec2<f32>,
  buttonTexMix: f32,
  borderColor: vec3<f32>,
  playheadBorderColor: vec3<f32>,
  playheadBorderIntensity: f32,
  borderThickness: f32,
};

fn getFragmentConstants() -> FragmentConstants {
    var c: FragmentConstants;
    c.bgColorA = vec3<f32>(0.05, 0.05, 0.07);
    c.bgColorB = vec3<f32>(0.04, 0.04, 0.056);
    c.playheadBeamColor = vec3<f32>(0.2, 0.25, 0.3);
    c.playheadBeamIntensity = 0.5;
    c.pillSize = vec2<f32>(0.35, 0.25);
    c.pillRadius = 0.1;
    c.noteIntensity = 1.2;
    c.glowFalloff = 8.0;
    c.glowIntensity = 0.6;
    c.hueMagic = 0.123;
    c.effectPos = vec2<f32>(0.5, 0.85);
    c.effectRadius = 0.05;
    c.effectColor = vec3<f32>(0.8, 0.8, 0.8);
    c.effectIntensity = 0.8;
    c.buttonTexScale = vec2<f32>(3.5, 3.5);
    c.buttonTexMix = 0.55;
    c.borderColor = vec3<f32>(0.15, 0.15, 0.2);
    c.playheadBorderColor = vec3<f32>(1.0, 0.8, 0.0);
    c.playheadBorderIntensity = 0.8;
    c.borderThickness = 1.0;
    return c;
}

fn hash21(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();

  // --- HARDWARE BACKDROP ---
  // Define a housing area
  let p = in.uv - 0.5;
  let housingSize = vec2<f32>(0.92, 0.92);
  let dHousing = sdRoundedBox(p, housingSize * 0.5, 0.1);
  let aa = fwidth(dHousing);

  var finalColor = vec3<f32>(0.1, 0.1, 0.12); // Base dark color

  // Plate highlight/shadow (Bevel)
  let bevel = smoothstep(0.02, 0.0, dHousing) * smoothstep(-0.05, 0.0, dHousing);
  if (dHousing < 0.0) {
      // Inner plate gradient
      finalColor += vec3<f32>(0.05) * (0.5 - in.uv.y);
      // Top highlight
      finalColor += vec3<f32>(0.15) * smoothstep(-0.45, -0.5, p.y) * smoothstep(0.0, -0.1, dHousing);
  }
  // Bevel edge
  if (dHousing < 0.0 && dHousing > -0.05) {
      let angle = atan2(p.y, p.x);
      let light = cos(angle + 2.0); // Top-left light
      finalColor += vec3<f32>(0.15) * light;
  }

  // --- BUTTON TEXTURE ---
  // Scale button to fit inside housing
  // We want the button to take up ~80% of the cell
  let btnScale = 1.25;
  let btnUV = (in.uv - 0.5) * btnScale + 0.5;

  var btnColor = vec3<f32>(0.0);
  var inButton = 0.0;

  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
      btnColor = textureSample(buttonsTexture, buttonsSampler, btnUV).rgb;
      inButton = 1.0;
  }

  // Blend button onto plate
  // We assume the texture has its own borders, but let's soft-mask it to be safe
  if (inButton > 0.5) {
      finalColor = mix(finalColor, btnColor, 1.0);
  }

  // Use btnUV for all light masks so they align with the shrunk button
  let tiledUV = btnUV;

  // --- 0. STARTUP / IDLE ANIMATION ---
  if (uniforms.isModuleLoaded == 0u) {
      let t = uniforms.timeSec;
      let r = f32(in.row);
      let c = f32(in.channel);

      // Define regions using scaled UVs
      let x = tiledUV.x;
      let y = tiledUV.y;

      // Only apply lights if we are inside the button
      if (inButton > 0.5) {
           let indicatorXMask = smoothstep(0.4, 0.41, x) - smoothstep(0.6, 0.61, x);
  let topLightMask    = (smoothstep(0.10, 0.11, y) - smoothstep(0.20, 0.21, y)) * indicatorXMask;

let mainButtonYMask  = smoothstep(0.23, 0.24, y) - smoothstep(0.82, 0.83, y);

  let mainButtonXMask = smoothstep(0.08, 0.09, x) - smoothstep(0.91, 0.92, x);
  let mainButtonMask = mainButtonYMask * mainButtonXMask;

  let bottomLightMask = (smoothstep(0.90, 0.91, y) - smoothstep(0.95, 0.96, y)) * indicatorXMask;
          let mainButtonMask = mainButtonYMask * mainButtonXMask;

          var glow = vec3<f32>(0.0);

          // Phase 1: Startup Dance (0 - 3 seconds)
          if (t < 3.0) {
              let wavePos = t * 20.0;
              let gridPos = r + c * 2.0;
              let dist = abs(gridPos - wavePos);
              let intensity = smoothstep(5.0, 0.0, dist);
              let color = neonPalette(t * 0.5 + c * 0.1);
              glow = color * intensity;

              finalColor = mix(finalColor, finalColor + glow, mainButtonMask);
              finalColor = mix(finalColor, finalColor + glow * 2.0, topLightMask);
          } else {
              // Phase 2: Waiting Blinking
              let seed = floor(t * 2.0);
              let rnd = hash21(vec2<f32>(r, c + seed));
              if (rnd > 0.9) {
                 let blinkColor = neonPalette(rnd);
                 let fade = 1.0 - fract(t * 2.0);
                 glow = blinkColor * fade * 1.5;
                 finalColor = mix(finalColor, finalColor + glow, mainButtonMask);
                 finalColor = mix(finalColor, finalColor + glow * 2.0, topLightMask);
              }
          }
      }

      // Border for cell (outermost)
      let borderX = smoothstep(1.0 - (fs.borderThickness * fwidth(in.uv.x)), 1.0, abs(in.uv.x * 2.0 - 1.0)); // Edge of cell
      // actually using standard UV borders
      let uv_aa = vec2<f32>(fwidth(in.uv.x), fwidth(in.uv.y));
      let bX = smoothstep(1.0 - (fs.borderThickness * uv_aa.x), 1.0, in.uv.x);
      let bY = smoothstep(1.0 - (fs.borderThickness * uv_aa.y), 1.0, in.uv.y);
      let borderAlpha = max(bX, bY);

      // Don't draw border on top of everything, maybe blend?
      // actually borders help separation
      finalColor = mix(finalColor, vec3<f32>(0.0), borderAlpha); // Black gap

      return vec4<f32>(finalColor, 1.0);
  }

  // --- 2. UNPACK DATA ---
  let noteChar = (in.packedA >> 24) & 255u;
  let inst = in.packedA & 255u;
  let effCode = (in.packedB >> 8) & 255u;
  let effParam = in.packedB & 255u;
  let hasNote = (noteChar >= 65u && noteChar <= 71u);
  let hasEffect = (effParam > 0u);
  let ch = channels[in.channel];

  // --- 3. IDENTIFY BUTTON REGIONS (Using Scaled UVs) ---
  let y = tiledUV.y;
  let x = tiledUV.x;

  if (inButton > 0.5) {
      let indicatorXMask = smoothstep(0.4, 0.41, x) - smoothstep(0.6, 0.61, x);
      let topLightMask    = (smoothstep(0.10, 0.11, y) - smoothstep(0.20, 0.21, y)) * indicatorXMask;

      let mainButtonYMask  = smoothstep(0.23, 0.24, y) - smoothstep(0.82, 0.83, y);
      let mainButtonXMask = smoothstep(0.1, 0.11, x) - smoothstep(0.9, 0.91, x);
      let mainButtonMask = mainButtonYMask * mainButtonXMask;

      let bottomLightMask = (smoothstep(0.90, 0.91, y) - smoothstep(0.95, 0.96, y)) * indicatorXMask;

      // --- 5. NEW PLAYHEAD PROXIMITY ---
      let rowDistance = abs(i32(in.row) - i32(uniforms.playheadRow));
      var proximityGlow: f32 = 0.0;
      switch rowDistance {
          case 0: { proximityGlow = 0.0; }
          case 1: { proximityGlow = 1.0; }
          default: {}
      }

      // --- 4. APPLY STATES TO REGIONS ---

      // ** Muted Channel Dimming **
      if (ch.isMuted == 1u) {
          finalColor *= 0.2;
      }

      // ** "Channel Active" -> Top Light **
      let noteTrail = exp(-ch.noteAge * 2.0);
      let channelActive = step(0.1, noteTrail);

      if (channelActive > 0.5) {
          let topPulse = 0.7 + 0.3 * sin(uniforms.timeSec * 10.0);
          let topGlow = vec3<f32>(0.5, 0.8, 1.0) * (topPulse + proximityGlow);
          finalColor = mix(finalColor, finalColor + topGlow, topLightMask);
      }

      // ** "Has Note" -> Main Button **
      var noteColor = vec3<f32>(0.0);
      if (hasNote) {
          let pitchHue = pitchClassFromPacked(in.packedA);
          let base_note_color = neonPalette(pitchHue);
          let instBand = inst & 15u;
          let instBrightness = 0.7 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.3;

          let octaveChar = (in.packedA >> 8) & 255u;
          let octaveF = f32(octaveChar) - 48.0;
          let octaveDelta = clamp(octaveF, 1.0, 8.0) - 4.0;
          let octaveLightness = 1.0 + octaveDelta * 0.15;

          noteColor = base_note_color * instBrightness * octaveLightness;

          let triggerFlash = noteColor * 1.5 + 0.5;
          noteColor = mix(noteColor, triggerFlash, f32(ch.trigger) * 0.8);

          let volAlpha = clamp(ch.volume, 0.05, 1.0);
          let mixAmount = mainButtonMask * volAlpha * noteTrail;
          finalColor = mix(finalColor, noteColor, mixAmount);
      }

      // ** "Has Effect" -> Bottom Light **
      var bottomGlow = vec3<f32>(0.0);

      if (hasEffect) {
          let effectColor = effectColorFromCode(effCode, fs.effectColor);
          let strength = clamp(f32(effParam) / 255.0, 0.2, 1.0);
          let effectPulse = 1.0 + 0.5 * sin(uniforms.timeSec * 15.0);
          bottomGlow += (effectColor * strength * effectPulse) * 1.5;
      }

      if (proximityGlow > 0.0) {
          let baseEffectColor = vec3<f32>(0.8, 0.7, 0.3);
          bottomGlow += (baseEffectColor * proximityGlow) * 1.5;
      }
      finalColor = mix(finalColor, finalColor + bottomGlow, bottomLightMask);

      // --- 6. "BLINK OFF" LOGIC ---
      if (rowDistance == 0 && !hasNote) {
          finalColor = mix(finalColor, finalColor * 0.2, mainButtonMask);
      }
  }

  // --- 7. CELL BORDERS ---
  // Always draw dark border for separation (Backdrop Gap)
  let uv_aa = vec2<f32>(fwidth(in.uv.x), fwidth(in.uv.y));
  let borderX = smoothstep(1.0 - (fs.borderThickness * uv_aa.x * 2.0), 1.0, in.uv.x);
  let borderY = smoothstep(1.0 - (fs.borderThickness * uv_aa.y * 2.0), 1.0, in.uv.y);
  let borderAlpha = max(borderX, borderY);

  finalColor = mix(finalColor, vec3<f32>(0.0), borderAlpha); // Black gap

  return vec4<f32>(finalColor, 1.0);
}
