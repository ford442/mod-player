// filepath: g:\github\react-dom\shaders\patternv0.13.wgsl
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
  pad3: u32,
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

  // --- FIX ---
  // Added @interpolate(linear).
  // All floating-point values passed from vertex to fragment
  // MUST specify an interpolation type (e.g., linear, flat, perspective).
  @location(2) @interpolate(linear) uv: vec2<f32>,
  // -----------

  @location(3) @interpolate(flat) packedA: u32, // Note/Inst
  @location(4) @interpolate(flat) packedB: u32, // Vol/Effect/Param
};

// --- VERTEX SHADER (Unchanged) ---
// This was already solid. No changes needed.
@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  // --- ORIENTATION FLIP ---
  // Horizontal Layout: Row increases X, Channel increases Y
  let px = f32(row) * uniforms.cellW;
  let py = f32(channel) * uniforms.cellH;

  let lp = quad[vertexIndex];
  let worldX = px + lp.x * uniforms.cellW;
  let worldY = py + lp.y * uniforms.cellH;

  // Convert to clip space
  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;

  // Read packed data (2 u32s per cell) a,b
  let idx = instanceIndex * 2u;
  let a = cells[idx];
  let b = cells[idx + 1u]; // Effects

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

// "Cosine based palette" for rich, neon colors
// https://iquilezles.org/articles/palettes/
fn neonPalette(t: f32) -> vec3<f32> {
    let a = vec3<f32>(0.5, 0.5, 0.5);
    let b = vec3<f32>(0.5, 0.5, 0.5);
    let c = vec3<f32>(1.0, 1.0, 1.0);
    let d = vec3<f32>(0.263, 0.416, 0.557); // Technicolor phase
    return a + b * cos(6.28318 * (c * t + d));
}

// SDF for a Rounded Box
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

fn classifyEffectGlyph(code: u32) -> u32 {
    let c = toUpperAscii(code & 255u);
    switch c {
        case 49u: { return 1u; }         // '1' Porta Up
        case 50u: { return 2u; }         // '2' Porta Down
        case 51u: { return 1u; }         // '3' also Portamento style
        case 52u: { return 3u; }         // '4' Vibrato
        case 55u: { return 4u; }         // '7' Tremolo
        case 65u: { return 5u; }         // 'A' Volume slide
        default: { return 0u; }
    }
}

fn sdEquilateralTriangle(p: vec2<f32>, size: f32) -> f32 {
    const k = 1.7320508;
    var q = p;
    q.x = abs(q.x);
    q.x -= size;
    q.y += size / k;
    if (q.x + k * q.y > 0.0) {
        q = vec2<f32>(q.x - k * q.y, -k * q.y) * 0.5;
    }
    q.x -= clamp(q.x, -2.0 * size, 0.0);
    return -length(q) * sign(q.y);
}

fn sdDiamond(p: vec2<f32>, size: f32) -> f32 {
    let q = abs(p);
    return (q.x + q.y) - size;
}

fn effectGlyphSDF(kind: u32, offset: vec2<f32>, radius: f32) -> f32 {
    switch kind {
        case 1u: {
            return sdEquilateralTriangle(vec2<f32>(offset.x, offset.y + radius * 0.1), radius);
        }
        case 2u: {
            return sdEquilateralTriangle(vec2<f32>(offset.x, -offset.y + radius * 0.1), radius);
        }
        case 3u: {
            return sdRoundedBox(offset, vec2<f32>(radius * 0.9, radius * 0.35), radius * 0.35);
        }
        case 4u: {
            return sdRoundedBox(offset, vec2<f32>(radius * 0.7, radius * 0.7), radius * 0.15);
        }
        case 5u: {
            return sdDiamond(offset, radius * 0.9);
        }
        default: {
            return length(offset) - radius;
        }
    }
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

fn buttonPatternColor(fs: FragmentConstants, uv: vec2<f32>, row: u32, channel: u32) -> vec3<f32> {
    let tiled = fract(vec2<f32>(uv.x * fs.buttonTexScale.x + f32(row) * 0.17, uv.y * fs.buttonTexScale.y + f32(channel) * 0.23));
    return textureSample(buttonsTexture, buttonsSampler, tiled).rgb;
}

// --- CHANGE ---
// We've moved all the "magic numbers" for styling into this one
// struct. Now you can tweak the appearance from one central place!
struct FragmentConstants {
  // Background
  bgColorA: vec3<f32>,
  bgColorB: vec3<f32>,
  playheadBeamColor: vec3<f32>,
  playheadBeamIntensity: f32,

  // Note Pill
  pillSize: vec2<f32>,
  pillRadius: f32,
  noteIntensity: f32,
  glowFalloff: f32,
  glowIntensity: f32,
  hueMagic: f32,

  // Effect Dot
  effectPos: vec2<f32>,
  effectRadius: f32,
  effectColor: vec3<f32>,
  effectIntensity: f32,
  buttonTexScale: vec2<f32>,
  buttonTexMix: f32,

  // Borders
  borderColor: vec3<f32>,
  playheadBorderColor: vec3<f32>,
  playheadBorderIntensity: f32,
  borderThickness: f32, // --- NOTE: This is now a 1.0-pixel-based thickness
};

// --- CHANGE ---
// Initialize all our styling constants.
// This function acts like a "constructor" for the struct.
fn getFragmentConstants() -> FragmentConstants {
    var c: FragmentConstants;

    // Background
    c.bgColorA = vec3<f32>(0.05, 0.05, 0.07);
    c.bgColorB = vec3<f32>(0.04, 0.04, 0.056); // 0.8 * bgColorA
    c.playheadBeamColor = vec3<f32>(0.2, 0.25, 0.3);
    c.playheadBeamIntensity = 0.5;

    // Note Pill
    c.pillSize = vec2<f32>(0.35, 0.25); // (width, height) in UV space
    c.pillRadius = 0.1;
    c.noteIntensity = 1.2;
    c.glowFalloff = 8.0;   // For exp() glow
    c.glowIntensity = 0.6;
    c.hueMagic = 0.123;  // Magic number for instrument hue separation

    // Effect Dot
    c.effectPos = vec2<f32>(0.5, 0.85); // UV position
    c.effectRadius = 0.05;
    c.effectColor = vec3<f32>(0.8, 0.8, 0.8);
    c.effectIntensity = 0.8;
    c.buttonTexScale = vec2<f32>(3.5, 3.5);
    c.buttonTexMix = 0.55;

    // Borders
    c.borderColor = vec3<f32>(0.15, 0.15, 0.2);
    c.playheadBorderColor = vec3<f32>(1.0, 0.8, 0.0);
    c.playheadBorderIntensity = 0.8;
    c.borderThickness = 1.0; // Draw a 1.0 pixel thick border

    return c;
}


@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();

  // Unpack fields
  let noteChar = (in.packedA >> 24) & 255u;
  let inst = in.packedA & 255u;
  let volType = (in.packedB >> 24) & 255u; // 1=vol,2=pan
  let volValue = (in.packedB >> 16) & 255u; // 0..255
  let effCode = (in.packedB >> 8) & 255u;   // ASCII letter or code
  let effParam = in.packedB & 255u;         // 0..255

  let hasNote = (noteChar >= 65u && noteChar <= 71u);
  let hasEffect = (effParam > 0u);

  // Background stripes + row flags
  var color = vec3<f32>(0.0);
  let baseA = getFragmentConstants().bgColorA;
  let baseB = getFragmentConstants().bgColorB;
  color = select(baseB, baseA, (in.channel & 1u) == 1u);

  var background = color;
  if (in.row < uniforms.numRows) {
    let flags = rowFlags[in.row];
    let isMeasure = (flags & 2u) != 0u;
    let isBeat = (flags & 1u) != 0u;
    let beatPulse = 0.5 + 0.5 * sin(uniforms.beatPhase * 3.14159);
    let grooveShift = (uniforms.groove * 0.1) * select(-1.0, 1.0, (in.row & 1u) == 0u);
    let shiftedRow = f32(in.row) + grooveShift;
    if (isMeasure) {
      background = mix(background, vec3<f32>(0.02, 0.03, 0.05), 0.7 + 0.2 * beatPulse);
    } else if (isBeat) {
      background = mix(background, vec3<f32>(0.04, 0.04, 0.06), 0.4 + 0.2 * beatPulse);
    }
  }

  color = background;

  let pr = f32(uniforms.playheadRow) + clamp(uniforms.tickOffset, 0.0, 1.0);
  let playheadX = pr * uniforms.cellW / uniforms.canvasW;
  let beamDist = abs(in.uv.x + (f32(in.row) * uniforms.cellW) / uniforms.canvasW - playheadX);
  let beam = exp(-beamDist * (48.0 - uniforms.kickTrigger * 24.0));
  if (uniforms.isPlaying == 1u) {
    color += vec3<f32>(0.18, 0.20, 0.26 + uniforms.kickTrigger * 0.2) * beam;
  }

  let center = in.uv - 0.5;
  let pillSDF = sdRoundedBox(center, fs.pillSize, fs.pillRadius);
  let pill_aa = fwidth(pillSDF) * 0.5;

  let ch = channels[in.channel];

  // Muted channels dimmer
  if (ch.isMuted == 1u) {
    color *= 0.2;
  }

  if (hasNote) {
    let pitchHue = pitchClassFromPacked(in.packedA);
    let base_note_color = neonPalette(pitchHue);
    let instBand = inst & 15u;
    let instBrightness = 0.7 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.3;
    var noteColor = base_note_color * instBrightness * fs.noteIntensity;

    if (uniforms.isPlaying == 1u) {
      let pulse = 0.5 + 0.5 * sin(uniforms.timeSec * uniforms.bpm * 0.10472);
      noteColor *= mix(0.85, 1.15, pulse);
    }

    // Vibrato shake
    var uv = center;
    if (ch.activeEffect == 1u) {
      let shake = sin(uniforms.timeSec * (10.0 + ch.effectValue * 20.0)) * (0.02 + ch.effectValue * 0.05);
      uv.x += shake;
    }
    // Portamento shear
    if (ch.activeEffect == 2u) {
      let skew = clamp(ch.effectValue * 0.5, -0.3, 0.3);
      uv.x += uv.y * skew;
    }
    // Tremolo pulse
    if (ch.activeEffect == 3u) {
      let trem = 0.5 + 0.5 * sin(uniforms.timeSec * (8.0 + ch.effectValue * 16.0));
      noteColor *= mix(0.8, 1.2, trem);
    }
    // Arpeggio tint cycling
    if (ch.activeEffect == 4u) {
      let arp = fract(uniforms.timeSec * 4.0);
      noteColor = mix(noteColor, neonPalette(arp), 0.35 * ch.effectValue);
    }
    // Retrigger strobe
    if (ch.activeEffect == 5u) {
      let strobe = step(0.5, fract(ch.noteAge * (5.0 + ch.effectValue * 30.0)));
      noteColor *= mix(0.6, 1.4, strobe);
    }

    let pillShape = 1.0 - smoothstep(-pill_aa, pill_aa, sdRoundedBox(uv, fs.pillSize, fs.pillRadius));
    let glow = exp(-pillSDF * fs.glowFalloff) * fs.glowIntensity;

    let volAlpha = clamp(ch.volume, 0.05, 1.0);
    let panTint = clamp(ch.pan * 0.5 + 0.5, 0.0, 1.0);
    let panColor = mix(vec3<f32>(0.9, 0.4, 0.4), vec3<f32>(0.4, 0.4, 0.9), panTint);

    var mixColor = noteColor;
    mixColor = mix(mixColor, panColor, 0.15);
    mixColor = mix(mixColor, vec3<f32>(1.0), mix(0.0, 0.8, f32(ch.trigger)));

    let noteTrail = exp(-ch.noteAge * 2.0);
    color = mix(color, mixColor, clamp((pillShape + glow) * noteTrail, 0.0, 1.0) * volAlpha);
  }

  let effectSDF = distance(in.uv, fs.effectPos) - fs.effectRadius;
  let aa_effect = fwidth(effectSDF) * 0.5;
  let pattern = buttonPatternColor(fs, in.uv, in.row, in.channel);

  if (hasEffect) {
     let glyphKind = classifyEffectGlyph(effCode);
     let effectSDF = effectGlyphSDF(glyphKind, in.uv - fs.effectPos, fs.effectRadius);
     let effectShape = 1.0 - smoothstep(-aa_effect, aa_effect, effectSDF);
     let strength = clamp(f32(effParam) / 255.0, 0.2, 1.0);
     let tinted = effectColorFromCode(effCode, fs.effectColor);
     let effectColor = mix(tinted, pattern, fs.buttonTexMix);
     color = mix(color, effectColor, effectShape * fs.effectIntensity * strength);
  }

  let uv_aa = vec2<f32>(fwidth(in.uv.x), fwidth(in.uv.y));
  let borderX = smoothstep(1.0 - (fs.borderThickness * uv_aa.x), 1.0, in.uv.x);
  let borderY = smoothstep(1.0 - (fs.borderThickness * uv_aa.y), 1.0, in.uv.y);
  let borderAlpha = max(borderX, borderY);

  if (in.row == uniforms.playheadRow) {
      let playheadBorder = borderX * fs.playheadBorderIntensity;
      color = mix(color, fs.playheadBorderColor, playheadBorder);
      color = mix(color, fs.borderColor, borderY);
  } else {
      color = mix(color, fs.borderColor, borderAlpha);
  }

  return vec4<f32>(color, 1.0);
}
