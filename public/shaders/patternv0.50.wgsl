// patternv0.50.wgsl
// Frosted Glass Circular – Vibrant Note Colours + Blue LED Indicator + Full-Height Caps
//
// Hybrid composition combining v0.48 (vibrant note-data colours from neonPalette)
// and v0.49 (blue LED indicator ring, solid housing, frosted glass caps).
//
// Per-step layering:
//   1. HOUSING (BEHINDS) — Solid dark-metallic body lit with vibrant neonPalette
//                          colours driven by real note pitch (purple, teal, green,
//                          orange, red, cyan).  Activity from v0.48's distance-based
//                          energy sweep + trail + noteAge + tickOffset sub-step.
//   2. CAP — Full-height frosted acrylic glass (0.88 × 0.88) in the same vibrant
//            hue as the housing.  LED-under-glass model with white bevel rim.
//   3. DEPRESSION — On playhead hit: cap scales 4 % smaller + top inner-shadow.
//
// Channel 0: Blue LED indicator ring shows playhead proximity (from v0.49).
//
// Background: bezel.wgsl (hardware photo with dark centre + white frame).
// Transparent gaps + centre circle allow bezel to show through.

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

@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var<storage, read> rowFlags: array<u32>;

struct ChannelState { volume: f32, pan: f32, freq: f32, trigger: u32, noteAge: f32, activeEffect: u32, effectValue: f32, isMuted: u32 };
@group(0) @binding(3) var<storage, read> channels: array<ChannelState>;
@group(0) @binding(4) var buttonsSampler: sampler;
@group(0) @binding(5) var buttonsTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat)   row:     u32,
  @location(1) @interpolate(flat)   channel: u32,
  @location(2) @interpolate(linear) uv:      vec2<f32>,
  @location(3) @interpolate(flat)   packedA: u32,
  @location(4) @interpolate(flat)   packedB: u32,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row         = instanceIndex / numChannels;
  let channel     = instanceIndex % numChannels;

  let invertedChannel = numChannels - 1u - channel;
  let ringIndex = select(invertedChannel, channel, uniforms.invertChannels == 1u);

  let center    = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let minDim    = min(uniforms.canvasW, uniforms.canvasH);
  let maxRadius = minDim * 0.45;
  let minRadius = minDim * 0.15;
  let ringDepth = (maxRadius - minRadius) / f32(numChannels);
  let radius    = minRadius + f32(ringIndex) * ringDepth;

  let totalSteps   = 64.0;
  let anglePerStep = 6.2831853 / totalSteps;
  let theta        = -1.570796 + f32(row % 64u) * anglePerStep;

  let circumference = 2.0 * 3.14159265 * radius;
  let arcLength     = circumference / totalSteps;
  let btnW          = arcLength * 0.95;
  let btnH          = ringDepth * 0.95;

  let lp       = quad[vertexIndex];
  let localPos = (lp - 0.5) * vec2<f32>(btnW, btnH);

  let rotAng = theta + 1.570796;
  let cA = cos(rotAng); let sA = sin(rotAng);
  let rotX = localPos.x * cA - localPos.y * sA;
  let rotY = localPos.x * sA + localPos.y * cA;

  let worldX = center.x + cos(theta) * radius + rotX;
  let worldY = center.y + sin(theta) * radius + rotY;

  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;

  let idx = instanceIndex * 2u;
  let a   = cells[idx];
  let b   = cells[idx + 1u];

  var out: VertexOut;
  out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
  out.row      = row;
  out.channel  = channel;
  out.uv       = lp;
  out.packedA  = a;
  out.packedB  = b;
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn neonPalette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.0, 0.33, 0.67);
  let beatDrift = uniforms.beatPhase * 0.08;
  return a + b * cos(6.28318 * (c * (t + beatDrift) + d));
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
  if (note == 0u) { return 0.0; }
  let semi = (note - 1u) % 12u;
  return f32(semi) / 12.0;
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
    
    // Glass transparency — reduce opacity when active emitters are lit
    let diodeVisibility = diodeMask * 0.55;
    let baseAlpha = 0.72 + 0.28 * fresnel;
    let emitterLift = clamp(topEmitter.a * 0.4 + botEmitter.a * 0.4, 0.0, 0.7);
    let alpha = mix(baseAlpha, 0.32, min(diodeVisibility + emitterLift, 0.9)) * edgeAlpha;
    
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

  // Smooth playhead position
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / 64.0) * 64.0;
  let rowDistRaw = abs(f32(in.row % 64u) - playheadStep);
  let rowDist = min(rowDistRaw, 64.0 - rowDistRaw);
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
    let note = (in.packedA >> 24) & 255u;
    let inst = (in.packedA >> 16) & 255u;
    let volCmd = (in.packedA >> 8) & 255u;
    let effCmd = (in.packedB >> 8) & 255u;
    let effVal = in.packedB & 255u;

    let hasNote = (note > 0u);
    let hasExpression = (volCmd > 0u) || (effCmd > 0u);

    // Housing color: tint by note presence (restore color-per-note display)
    var housingColor = fs.bgColor;
    if (hasNote) {
      let pitchHue = pitchClassFromIndex(note);
      let baseColor = neonPalette(pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
      let tintColor = baseColor * instBright;
      housingColor = mix(fs.bgColor, tintColor, 0.35);
    }

    // Start with tinted housing background
    finalColor = housingColor;

    // Bounds check for channel state array access
    var ch = ChannelState(0.0, 0.0, 0.0, 0u, 1000.0, 0u, 0.0, 0u);
    if (in.channel < arrayLength(&channels)) {
      ch = channels[in.channel];
    }
    let isMuted = (ch.isMuted == 1u);

    // --- THREE-EMITTER SYSTEM ---
    
    // EMITTER 1 (TOP): Blue Note-On Indicator
    // Lights up BLUE when note is triggered or playhead is on this step
    let blueColor = vec3<f32>(0.15, 0.5, 1.0);
    var topIntensity = 0.0;
    if (!isMuted) {
      if (ch.trigger > 0u) {
        topIntensity = 3.0 + kick * 0.5;
      } else if (hasNote) {
        topIntensity = playheadActivation * 0.8;
      }
    }
    let topColor = blueColor * (1.5 + bloom * 2.0);
    
    // EMITTER 2 (MIDDLE): Steady Note Color
    // Shows pitch color steadily whenever there's a note (does NOT blink)
    var noteColor = vec3<f32>(0.15);
    var midIntensity = 0.12; // Base dim glow
    if (hasNote) {
      let pitchHue = pitchClassFromIndex(note);
      let baseColor = neonPalette(pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
      noteColor = baseColor * instBright;
      
      // Steady indication - no flashing, just presence
      midIntensity = 0.6 + bloom * 2.0;
      if (isMuted) { midIntensity *= 0.3; }
    }
    let midColor = noteColor;
    
    // EMITTER 3 (BOTTOM): Amber Control Message Indicator
    // Lights up AMBER when there's an effect or volume command
    let amberColor = vec3<f32>(1.0, 0.55, 0.1);
    var botIntensity = 0.0;
    if (!isMuted) {
      if (hasExpression) {
        botIntensity = 2.0;
      } else if (hasNote && playheadActivation > 0.5) {
        botIntensity = 0.6;
      }
    }
    let botColor = amberColor * (1.5 + bloom * 2.0);
    
    // --- DRAW UNIFIED LENS CAP ---
    let lensUV = btnUV - vec2<f32>(0.5, 0.5);
    let lensSize = vec2<f32>(0.6, 0.82);
    
    let unifiedLens = drawUnifiedLensCap(
        lensUV, lensSize,
        vec4<f32>(topColor, topIntensity),    // Top: Blue note-on
        vec4<f32>(midColor, midIntensity),    // Middle: Steady note color
        vec4<f32>(botColor, botIntensity),    // Bottom: Amber control
        aa
    );
    
    finalColor = mix(finalColor, unifiedLens.rgb, unifiedLens.a);

    // External glow when note is playing on playhead
    if (playheadActivation > 0.5 && hasNote) {
      let pulseColor = mix(blueColor, amberColor, 0.5 + 0.5 * sin(beat * 6.2832));
      finalColor += pulseColor * playheadActivation * 0.4;
    }

    // Blue LED: bloom-independent external glow for active channels
    if (!isMuted && ch.trigger > 0u) {
      finalColor += blueColor * 0.4 * exp(-length(p) * 3.5);
    }
    // Amber LED: bloom-independent external glow for expression data
    if (!isMuted && hasExpression) {
      finalColor += amberColor * 0.3 * exp(-length(p) * 3.5);
    }
  }

  // Kick reactive glow
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.3;
  finalColor += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * uniforms.bloomIntensity;

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