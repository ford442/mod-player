// patternv0.51.wgsl
// Three-Emitter LED Indicator System with Unified Lens Cap + Playhead Arc
// Top: Blue Note-On | Middle: Steady Note Color | Bottom: Amber Control
// Based on v0.50 (circular layout with padTopChannel=true)
// Note: Requires padTopChannel=true in PatternDisplay to shift music channels 1-32.
// DURA UPDATE: Added note duration visualization with sustain tails
// ARC-001: Added animated playhead scan-line arc at current row

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
  dimFactor: f32,
  _r0: f32,
  _r1: f32,
  _r2: f32,
  _r3: f32,
  colorPalette: u32,
};

// DURA: Note duration constants
const NOTE_MIN: u32 = 1u;
const NOTE_MAX: u32 = 119u;
const NOTE_OFF_MIN: u32 = 120u;

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

  let btnW = arcLength * 0.95;
  let btnH = ringDepth * 0.95;

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

fn selectPalette(id: u32, t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  if (id == 1u) {
    // Warm: reds, oranges, yellows
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.0, 0.1, 0.2)));
  } else if (id == 2u) {
    // Cool: blues, cyans, purples
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.5, 0.7, 0.9)));
  } else if (id == 3u) {
    // Neon: pink, cyan, green
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.0, 0.5, 1.0)));
  } else if (id == 4u) {
    // Acid: green, yellow, chartreuse
    return a + b * cos(6.28318 * (c * t + vec3<f32>(0.3, 0.0, 0.7)));
  }
  // Default palette 0: Rainbow
  return a + b * cos(6.28318 * (c * t + vec3<f32>(0.0, 0.33, 0.67)));
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

fn sdEllipse(p: vec2<f32>, ab: vec2<f32>) -> f32 {
  let k = length(p / ab);
  return (k - 1.0) * min(ab.x, ab.y);
}

fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u || note > 96u) { return 0.0; }
  let semi = (note - 1u) % 12u;
  return f32(semi) / 12.0;
}

fn neonPalette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.0, 0.33, 0.67);
  return a + b * cos(6.28318 * (c * t + d));
}

// DURA: Structure to hold unpacked note duration info
struct NoteDurationInfo {
  duration: u32,      // Total note duration in rows
  rowOffset: u32,     // How many rows from note start (0 = note-on)
  isNoteOff: bool,    // Whether this cell is the note-off row
}

// DURA: Unpack duration info from packed cell data
fn unpackDurationInfo(packedA: u32, packedB: u32) -> NoteDurationInfo {
  var info: NoteDurationInfo;
  
  // Duration is in bits 8-15 of packedA (where volCmd used to be)
  info.duration = (packedA >> 8) & 0xFFu;
  if (info.duration == 0u) { info.duration = 1u; }
  
  // rowOffset and isNoteOff are packed into bits 8-14 of packedB
  let durationFlags = (packedB >> 8) & 0x7Fu;
  info.rowOffset = durationFlags >> 1u;
  info.isNoteOff = (durationFlags & 1u) != 0u;
  
  return info;
}

// DURA: Calculate sustain brightness based on position in note
fn calculateSustainBrightness(info: NoteDurationInfo, baseIntensity: f32) -> f32 {
  if (info.duration <= 1u) {
    // Short note - full brightness
    return baseIntensity;
  }
  
  let progress = f32(info.rowOffset) / f32(info.duration);
  
  // Note-on row: full brightness
  if (info.rowOffset == 0u) {
    return baseIntensity;
  }
  
  // Last 2-3 rows: fade out
  let remaining = info.duration - info.rowOffset;
  if (remaining <= 3u) {
    // Fade from 60% to 30% over last 3 rows
    let fadeFactor = f32(remaining) / 3.0;
    return baseIntensity * (0.3 + 0.3 * fadeFactor);
  }
  
  // Middle of sustain: 40-60% brightness
  return baseIntensity * (0.4 + 0.2 * (1.0 - progress));
}

// AMBER-BLUE: Calculate top-emitter intensity for note-on / expression-only / sustain
fn calculateTopIntensity(
  isNoteOn: bool,
  isExprOnly: bool,
  isSustain: bool,
  isMuted: bool,
  trigger: u32,
  bloom: f32,
  beat: f32
) -> f32 {
  var intensity = 0.0;
  if (isNoteOn) {
    intensity = 1.0 + bloom * 2.0;
    if (trigger > 0u) {
      intensity += beat * 0.3;
    }
  } else if (isExprOnly) {
    intensity = 1.0 + bloom * 2.0;
  } else if (isSustain) {
    intensity = 0.1 + bloom * 0.2;
  }
  if (isMuted) { intensity *= 0.2; }
  return intensity;
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
  c.bgColor = vec3<f32>(0.04, 0.04, 0.05);
  // Blue/Orange trap palette: primary indicator is warm orange
  c.ledOnColor = vec3<f32>(1.0, 0.55, 0.1);
  c.ledOffColor = vec3<f32>(0.06, 0.06, 0.08);
  c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
  c.housingSize = vec2<f32>(0.92, 0.92);
  return c;
}

// --- EMITTER DIODE SHAPE ---
// Draws an individual LED emitter that shows through the unified lens
fn drawEmitterDiode(uv: vec2<f32>, intensity: f32, color: vec3<f32>, isOn: bool) -> vec4<f32> {
    let diodeSize = vec2<f32>(0.28, 0.14);
    
    let p = uv;
    let dDiode = sdRoundedBox(p, diodeSize * 0.5, 0.06);
    
    // Diode has a smaller "die" inside it — tighter for distinct dot appearance
    let dieSize = vec2<f32>(0.10, 0.05);
    let dDie = sdRoundedBox(p, dieSize * 0.5, 0.02);
    
    // Base diode housing (darker)
    let diodeMask = 1.0 - smoothstep(0.0, 0.015, dDiode);
    let dieMask = 1.0 - smoothstep(0.0, 0.008, dDie);
    
    var diodeColor = vec3<f32>(0.06, 0.06, 0.08);
    
    if (isOn) {
        let dieGlow = color * (1.0 + intensity * 4.0);
        let housingGlow = color * 0.12 * intensity;
        diodeColor = mix(housingGlow, dieGlow, dieMask);
        let hotspot = exp(-length(p / vec2<f32>(0.06, 0.03)) * 2.5) * intensity;
        diodeColor += color * hotspot * 0.6;
    }
    
    return vec4<f32>(diodeColor, diodeMask);
}

// --- UNIFIED THREE-EMITTER LENS CAP ---
// Single glass surface covering three emitters (blue, note, amber)
// Creates optical effects: refraction, reflection, subsurface scattering
fn drawUnifiedLensCap(
    uv: vec2<f32>, 
    lensSize: vec2<f32>,
    topEmitter: vec4<f32>,    // rgb=color, a=intensity (Blue note-on)
    midEmitter: vec4<f32>,    // rgb=color, a=intensity (Note color)
    botEmitter: vec4<f32>,    // rgb=color, a=intensity (Amber control)
    aa: f32
) -> vec4<f32> {
    let p = uv;
    let dBox = sdRoundedBox(p, lensSize * 0.5, 0.12);
    
    if (dBox > 0.0) {
        return vec4<f32>(0.0);
    }
    
    // Emitter positions under the lens (vertical arrangement)
    let topPos = vec2<f32>(0.0, -0.28);   // Top: Blue note-on indicator
    let midPos = vec2<f32>(0.0, 0.0);      // Middle: Note color (steady)
    let botPos = vec2<f32>(0.0, 0.28);     // Bottom: Amber control indicator
    
    // Glass surface properties
    let radial = length(p / (lensSize * 0.5));
    let edgeThickness = 0.18 + radial * 0.12;
    let centerThickness = 0.06;
    let thickness = mix(centerThickness, edgeThickness, radial * radial);
    
    let n = normalize(vec3<f32>(p.x * 2.5 / lensSize.x, p.y * 2.5 / lensSize.y, 0.35));
    let viewDir = vec3<f32>(0.0, 0.0, 1.0);
    let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.5);
    
    // Draw emitters under the lens
    let topDiode = drawEmitterDiode(uv - topPos, topEmitter.a, topEmitter.rgb, topEmitter.a > 0.05);
    let midDiode = drawEmitterDiode(uv - midPos, midEmitter.a, midEmitter.rgb, midEmitter.a > 0.05);
    let botDiode = drawEmitterDiode(uv - botPos, botEmitter.a, botEmitter.rgb, botEmitter.a > 0.05);
    
    // Combine emitters
    var combinedDiode = vec3<f32>(0.06, 0.06, 0.08);
    if (botDiode.a > 0.0) {
        combinedDiode = mix(combinedDiode, botDiode.rgb, botDiode.a);
    }
    if (midDiode.a > 0.0) {
        combinedDiode = mix(combinedDiode, midDiode.rgb, midDiode.a);
    }
    if (topDiode.a > 0.0) {
        combinedDiode = mix(combinedDiode, topDiode.rgb, topDiode.a);
    }
    let diodeMask = max(max(topDiode.a, midDiode.a), botDiode.a);
    
    // Refraction effect
    let refractionStrength = (1.0 - radial * 0.6) * 0.04;
    let refractOffset = p * refractionStrength;
    
    // Subsurface scattering
    var subsurfaceGlow = vec3<f32>(0.0);
    
    // Top emitter scattering (Blue - note on) — tightened falloff
    let distTop = length(uv - topPos - refractOffset * 0.3);
    let scatterTop = exp(-distTop * 9.0) * topEmitter.a;
    subsurfaceGlow += topEmitter.rgb * scatterTop * 2.2;
    
    // Middle emitter scattering (Note color - steady) — tightened falloff
    let distMid = length(uv - midPos - refractOffset * 0.5);
    let scatterMid = exp(-distMid * 7.5) * midEmitter.a;
    subsurfaceGlow += midEmitter.rgb * scatterMid * 3.0;
    
    // Bottom emitter scattering (Amber - control) — tightened falloff
    let distBot = length(uv - botPos - refractOffset * 0.3);
    let scatterBot = exp(-distBot * 9.0) * botEmitter.a;
    subsurfaceGlow += botEmitter.rgb * scatterBot * 2.2;
    
    // Per-emitter fringe glow (replaces shared diffusion that smeared all three)
    subsurfaceGlow += topEmitter.rgb * exp(-distTop * 6.0) * topEmitter.a * 0.15;
    subsurfaceGlow += midEmitter.rgb * exp(-distMid * 6.0) * midEmitter.a * 0.15;
    subsurfaceGlow += botEmitter.rgb * exp(-distBot * 6.0) * botEmitter.a * 0.15;
    
    // Glass base color
    let bgColor = vec3<f32>(0.04, 0.04, 0.05);
    
    var activeColor = midEmitter.rgb * midEmitter.a;
    activeColor = mix(activeColor, topEmitter.rgb, topEmitter.a * 0.5);
    activeColor = mix(activeColor, botEmitter.rgb, botEmitter.a * 0.5);
    
    let totalGlow = topEmitter.a + midEmitter.a + botEmitter.a;
    let litTint = mix(vec3<f32>(0.92, 0.93, 0.98), activeColor, min(totalGlow * 0.4, 0.4));
    let glassBaseColor = mix(bgColor * 0.12, litTint, 0.88);
    
    // Edge alpha
    let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);
    
    // Glass transparency
    let diodeVisibility = diodeMask * 0.55;
    let baseAlpha = 0.72 + 0.28 * fresnel;
    let alpha = mix(baseAlpha, 0.32, diodeVisibility) * edgeAlpha;
    
    // Directional lighting
    let lightDir = vec3<f32>(0.4, -0.7, 0.6);
    let diff = max(0.0, dot(n, normalize(lightDir)));
    let spec = pow(max(0.0, dot(reflect(-normalize(lightDir), n), viewDir)), 40.0);
    
    let litGlassColor = glassBaseColor * (0.45 + 0.55 * diff) + vec3<f32>(spec * 0.25);
    
    // Final composition
    var finalColor = bgColor;
    
    let diodeBlend = diodeMask * (1.0 - alpha * 0.65);
    finalColor = mix(finalColor, combinedDiode, diodeBlend);
    finalColor = mix(finalColor, litGlassColor, alpha);
    finalColor += subsurfaceGlow * 1.8;
    
    // Concentrated glow around active emitters
    if (midEmitter.a > 0.05) {
        let midGlowDist = length(uv - midPos - refractOffset * 0.5);
        let midGlow = (1.0 - smoothstep(0.0, 0.18, midGlowDist)) * midEmitter.a * 0.5;
        finalColor += midEmitter.rgb * midGlow;
    }
    if (topEmitter.a > 0.05) {
        let topGlowDist = length(uv - topPos - refractOffset * 0.3);
        let topGlow = (1.0 - smoothstep(0.0, 0.14, topGlowDist)) * topEmitter.a * 0.3;
        finalColor += topEmitter.rgb * topGlow;
    }
    if (botEmitter.a > 0.05) {
        let botGlowDist = length(uv - botPos - refractOffset * 0.3);
        let botGlow = (1.0 - smoothstep(0.0, 0.14, botGlowDist)) * botEmitter.a * 0.3;
        finalColor += botEmitter.rgb * botGlow;
    }
    
    finalColor += fresnel * vec3<f32>(0.9, 0.95, 1.0) * 0.18 * (1.0 + radial * 0.5);
    
    // Horizontal separator shadows between the three emitter zones
    let sepShadowTop = (1.0 - smoothstep(0.0, 0.015, abs(p.y - (-0.14)))) * 0.35;
    let sepShadowBot = (1.0 - smoothstep(0.0, 0.015, abs(p.y - 0.14))) * 0.35;
    finalColor -= finalColor * (sepShadowTop + sepShadowBot);
    
    let vignette = 1.0 - radial * radial * 0.25;
    finalColor *= vignette;
    
    return vec4<f32>(finalColor, edgeAlpha);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.33;
  
  if (in.channel >= uniforms.numChannels) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }
  let fs = getFragmentConstants();
  let bloom = uniforms.bloomIntensity;
  let kick = uniforms.kickTrigger;
  let beat = uniforms.beatPhase;

  // Hardware Layering: Discard pixels over UI
  if (in.position.y > uniforms.canvasH * 0.88) {
    discard;
  }

  // --- PLAYHEAD ARC OVERLAY (ARC-001) ---
  let minDim = min(uniforms.canvasW, uniforms.canvasH);
  let rInner = minDim * 0.15;
  let rOuter = minDim * 0.45;

  let pixelPos = in.position.xy;
  let center = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let delta = pixelPos - center;
  let fragAngle = atan2(delta.y, delta.x);
  let fragRadius = length(delta);

  let totalSteps = f32(uniforms.numRows);
  let rowAngle = -1.5707963 + (uniforms.playheadRow / totalSteps) * 6.2831853;

  var angleDelta = fragAngle - rowAngle;
  angleDelta = atan2(sin(angleDelta), cos(angleDelta));

  let angularMask = smoothstep(0.018, 0.002, abs(angleDelta));
  let radialMask = smoothstep(rInner - 4.0, rInner + 4.0, fragRadius) *
                   smoothstep(rOuter + 4.0, rOuter - 4.0, fragRadius);

  let pulse = 1.0 + 0.02 * sin(uniforms.timeSec * 6.0);
  let arcIntensity = 0.7 * pulse;
  let arcColor = vec3<f32>(1.0, 0.85, 0.3);
  let arcContrib = arcColor * angularMask * radialMask * arcIntensity;

  // Smooth playhead position
  let maxRows = f32(uniforms.numRows);
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / maxRows) * maxRows;
  let rowDistRaw = abs(f32(in.row % uniforms.numRows) - playheadStep);
  let rowDist = min(rowDistRaw, maxRows - rowDistRaw);
  let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);

  // CHANNEL 0 is the Indicator Ring
  if (in.channel == 0u) {
    let onPlayhead = playheadActivation > 0.5;
    let indSize = vec2<f32>(0.3, 0.3);
    let indColor = mix(vec3<f32>(0.15), fs.ledOnColor * 1.3, playheadActivation);
    let indLed = drawUnifiedLensCap(
        p, indSize,
        vec4<f32>(indColor, playheadActivation),
        vec4<f32>(indColor, playheadActivation),
        vec4<f32>(indColor, playheadActivation),
        aa
    );
    var col = indLed.rgb;
    var alpha = indLed.a;
    if (playheadActivation > 0.0) {
      let beatPulse = 1.0 + kick * 0.6 + (0.5 + 0.5 * sin(beat * 6.2832)) * 0.2;
      let glow = fs.ledOnColor * (bloom * 5.0) * exp(-length(p) * 3.5) * playheadActivation * beatPulse;
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.25, length(glow)));
    }
    col += arcContrib;
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // --- MUSIC CHANNELS (1-32) with THREE-EMITTER LED SYSTEM ---
  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = fs.bgColor;

  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var inButton = 0.0;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    inButton = 1.0;
  }

  if (inButton > 0.5) {
    // DURA: Unpack note and duration info from new packed format
    let note = (in.packedA >> 24) & 255u;
    let instRaw = (in.packedA >> 16) & 255u;
    let durationRaw = (in.packedA >> 8) & 255u;        // DURA: duration in rows
    let volPacked = in.packedA & 255u;                // DURA: packed volCmd/volVal
    
    let effCmd = (in.packedB >> 24) & 255u;           // DURA: effect command
    let effVal = (in.packedB >> 16) & 255u;           // DURA: effect value  
    let durationFlags = (in.packedB >> 8) & 0x7Fu;    // DURA: rowOffset + isNoteOff
    let volCmdFull = in.packedB & 255u;               // DURA: full volume command

    // Unpack expression-only flag from bit 7 of inst field (EXPR-001)
    let isExpressionOnly = (instRaw & 128u) != 0u;
    let inst = instRaw & 127u;
    
    // DURA: Reconstruct volume command from packed nibble
    let volCmd = (volPacked >> 4) << 4;
    let volVal = (volPacked & 0x0Fu) << 4;

    // DURA: Build duration info struct
    var dInfo: NoteDurationInfo;
    dInfo.duration = durationRaw;
    if (dInfo.duration == 0u) { dInfo.duration = 1u; }
    dInfo.rowOffset = durationFlags >> 1u;
    dInfo.isNoteOff = (durationFlags & 1u) != 0u;

    // AMBER-BLUE: Cell-type classification
    let isNoteOn   = (note > 0u && note < NOTE_OFF_MIN && dInfo.rowOffset == 0u);
    let isNoteOff  = (note >= NOTE_OFF_MIN);
    let isExprOnly = (!isNoteOn && !isNoteOff && isExpressionOnly);
    let isSustain  = (note > 0u && note < NOTE_OFF_MIN && dInfo.duration > 1u && dInfo.rowOffset > 0u && !dInfo.isNoteOff);
    let isDead     = (!isNoteOn && !isExprOnly && !isSustain && !isNoteOff);

    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);
    let hasExpression = (volCmd > 0u) || (effCmd > 0u) || (volCmdFull > 0u);

    // --- THREE-EMITTER SYSTEM with Amber-vs-Blue differentiation ---

    // EMITTER 1 (TOP): Semantic indicator — Blue for note-on, Amber for expression-only
    let blueColor  = vec3<f32>(0.05, 0.45, 1.0);  // royal blue #0080FF
    let amberColor = vec3<f32>(1.0, 0.55, 0.0);   // warm amber #FFA500
    var topColor = vec3<f32>(0.0);
    var topIntensity = calculateTopIntensity(isNoteOn, isExprOnly, isSustain, isMuted, ch.trigger, bloom, beat);
    if (isNoteOn) {
      topColor = blueColor;
    } else if (isExprOnly) {
      topColor = amberColor;
    } else if (isSustain) {
      topColor = blueColor;
    }

    // EMITTER 2 (MIDDLE): Note color (pitch-class) or dark
    var noteColor = vec3<f32>(0.051, 0.051, 0.051); // #0D0D0D near-black default
    var midIntensity = 0.02; // Base dim glow for dead/empty cells

    if (isNoteOn || isSustain) {
      let pitchHue = pitchClassFromIndex(note);
      let baseColor = neonPalette(pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
      noteColor = baseColor * instBright;

      if (isNoteOn) {
        midIntensity = calculateSustainBrightness(dInfo, 0.8 + bloom * 2.0);
      } else {
        // Sustain tail: fixed ~45% intensity
        midIntensity = 0.45 + bloom * 0.5;
      }
      if (isMuted) { midIntensity *= 0.25; }
    } else if (isNoteOff) {
      noteColor = vec3<f32>(0.3, 0.3, 0.35);
      midIntensity = 0.2 + 0.1 * sin(uniforms.timeSec * 4.0);
    } else if (isExprOnly) {
      // Dark center; amber top emitter illuminates via lens bloom
      noteColor = vec3<f32>(0.051, 0.051, 0.051);
      midIntensity = 0.0;
    } else if (isDead) {
      noteColor = vec3<f32>(0.051, 0.051, 0.051);
      midIntensity = 0.02;
    }
    let midColor = noteColor;

    // EMITTER 3 (BOTTOM): Control indicator — suppressed for expression-only (amber moved to top)
    var botIntensity = 0.0;
    var botColor = vec3<f32>(0.0);
    if (!isMuted && !isExprOnly) {
      if (isNoteOn && hasExpression) {
        botIntensity = 1.0 + bloom * 2.0;
        botColor = amberColor;
      } else if (isSustain && hasExpression) {
        botIntensity = 0.6 + bloom * 1.0;
        botColor = amberColor;
      }
    }
    
    // --- DRAW UNIFIED LENS CAP ---
    let lensUV = btnUV - vec2<f32>(0.5, 0.5);
    let lensSize = vec2<f32>(0.6, 0.82);
    
    let unifiedLens = drawUnifiedLensCap(
        lensUV, lensSize,
        vec4<f32>(topColor, topIntensity),    // Top: Blue note-on/sustain
        vec4<f32>(midColor, midIntensity),    // Middle: Note color with sustain
        vec4<f32>(botColor, botIntensity),    // Bottom: Amber control
        aa
    );
    
    finalColor = mix(finalColor, unifiedLens.rgb, unifiedLens.a);

    // AMBER-BLUE: Enhanced external glow for active notes
    if (playheadActivation > 0.5 && (isNoteOn || isSustain)) {
      let pulseColor = mix(blueColor, noteColor, 0.5 + 0.5 * sin(beat * 6.2832));
      let sustainBoost = select(1.0, 1.5, isSustain && !isNoteOn);
      finalColor += pulseColor * playheadActivation * 0.15 * sustainBoost;
    }
  }

  // Kick reactive glow
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.3;
  finalColor += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * uniforms.bloomIntensity;

  // Add playhead arc overlay
  finalColor += arcContrib;

  // Dithering for night mode
  let noise = fract(sin(dot(in.uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  finalColor += (noise - 0.5) * 0.01;

  // Idle cells: thin outer stroke instead of invisible
  if (housingMask < 0.5) {
    if (dHousing < 0.02) {
      return vec4<f32>(fs.ledOffColor, 1.0);
    }
    return vec4<f32>(fs.borderColor, 0.0);
  }
  return vec4<f32>(finalColor, 1.0);
}
