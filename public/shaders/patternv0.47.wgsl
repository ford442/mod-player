// patternv0.47.wgsl
// Trap Frosted - Improved Translucency with Visible Diode Shape
// Circular Layout with Translucent Glass Caps + Blue/Orange Lighting
// Based on v0.30 (disc layout with ASCII-packed note data)

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

  let totalSteps = 64.0;
  let anglePerStep = 6.2831853 / totalSteps;
  let theta = -1.570796 + f32(row % 64u) * anglePerStep;

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

fn neonPalette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.0, 0.33, 0.67);
  let beatDrift = uniforms.beatPhase * 0.1;
  return a + b * cos(6.28318 * (c * (t + beatDrift) + d));
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
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
  c.bgColor = vec3<f32>(0.04, 0.04, 0.05);
  // Blue/Orange trap palette: primary indicator is warm orange
  c.ledOnColor = vec3<f32>(1.0, 0.55, 0.1);
  c.ledOffColor = vec3<f32>(0.06, 0.06, 0.08);
  c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
  c.housingSize = vec2<f32>(0.92, 0.92);
  return c;
}

// --- EMITTER DIODE SHAPE ---
// Draws the actual LED emitter that shows through the glass cap
fn drawEmitterDiode(uv: vec2<f32>, intensity: f32, color: vec3<f32>, isOn: bool) -> vec4<f32> {
    // Diode is a small rounded rectangle positioned at the bottom of the cap
    let diodeSize = vec2<f32>(0.35, 0.18);
    let diodePos = vec2<f32>(0.0, 0.22); // Positioned toward bottom

    let p = uv - diodePos;
    let dDiode = sdRoundedBox(p, diodeSize * 0.5, 0.08);

    // Diode has a smaller "die" inside it
    let dieSize = vec2<f32>(0.18, 0.09);
    let dDie = sdRoundedBox(p, dieSize * 0.5, 0.04);

    // Base diode housing (darker)
    let diodeMask = 1.0 - smoothstep(0.0, 0.02, dDiode);
    let dieMask = 1.0 - smoothstep(0.0, 0.01, dDie);

    var diodeColor = vec3<f32>(0.08, 0.08, 0.1); // Dark housing

    if (isOn) {
        // The die glows with the note color
        let dieGlow = color * (1.0 + intensity * 3.0);
        let housingGlow = color * 0.15 * intensity;

        diodeColor = mix(housingGlow, dieGlow, dieMask);

        // Add a hotspot in the center of the die
        let hotspot = exp(-length(p / vec2<f32>(0.08, 0.04)) * 2.0) * intensity;
        diodeColor += color * hotspot * 0.5;
    }

    return vec4<f32>(diodeColor, diodeMask);
}

// --- ENHANCED TRANSLUCENT FROSTED GLASS CAP ---
// Shows the diode shape underneath with proper translucency
fn drawFrostedGlassCap(uv: vec2<f32>, size: vec2<f32>, color: vec3<f32>, isOn: bool, aa: f32, noteGlow: f32, diodeColor: vec3<f32>, diodeIntensity: f32) -> vec4<f32> {
    let p = uv;
    let dBox = sdRoundedBox(p, size * 0.5, 0.08);

    if (dBox > 0.0) {
        return vec4<f32>(0.0);
    }

    // Draw the emitter diode underneath
    let diode = drawEmitterDiode(uv, diodeIntensity, diodeColor, isOn);

    // Glass surface normal for reflections
    let n = normalize(vec3<f32>(p.x * 2.0 / size.x, p.y * 2.0 / size.y, 0.4));
    let viewDir = vec3<f32>(0.0, 0.0, 1.0);
    let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.0);
    let radial = length(p / (size * 0.5));

    // Glass thickness varies - thicker at edges
    let edgeThickness = 0.15 + radial * 0.08;
    let centerThickness = 0.08;
    let thickness = mix(centerThickness, edgeThickness, radial);

    // Subsurface scattering - light travels through the glass
    // Illumination is concentrated above the emitter (negative Y is up in UV space)
    let emitterPos = vec2<f32>(0.0, 0.22);
    let distFromEmitter = length(uv - emitterPos);
    let lightTravel = exp(-distFromEmitter * 4.0) * noteGlow;

    // Light concentrates upward from the emitter
    let upwardBias = smoothstep(0.0, -0.3, uv.y - emitterPos.y);
    let subsurface = lightTravel * upwardBias * (1.0 - radial * 0.3);

    let bgColor = vec3<f32>(0.04, 0.04, 0.05);

    // Glass tint varies with light passing through
    let litTint = mix(vec3<f32>(0.95, 0.95, 1.0), color, noteGlow * 0.3);
    let glassBaseColor = mix(bgColor * 0.15, litTint, 0.85);

    // Edge alpha with anti-aliasing
    let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);

    // Glass is more transparent where the diode is visible
    let diodeVisibility = diode.a * 0.6; // Diode shows through at 60%
    let baseAlpha = 0.75 + 0.25 * fresnel;
    let alpha = mix(baseAlpha, 0.35, diodeVisibility) * edgeAlpha;

    // Directional lighting from top-left
    let lightDir = vec3<f32>(0.4, -0.7, 0.6);
    let diff = max(0.0, dot(n, normalize(lightDir)));
    let spec = pow(max(0.0, dot(reflect(-normalize(lightDir), n), viewDir)), 32.0);

    let litGlassColor = glassBaseColor * (0.5 + 0.5 * diff) + vec3<f32>(spec * 0.3);

    // Start with background
    var finalColor = bgColor;

    // Layer the diode underneath
    let diodeBlend = diode.a * (1.0 - alpha * 0.7); // Diode visible through glass
    finalColor = mix(finalColor, diode.rgb, diodeBlend);

    // Apply glass layer
    finalColor = mix(finalColor, litGlassColor, alpha);

    // Add subsurface glow from light passing through
    finalColor += subsurface * color * 2.5;

    // Inner glow when on - concentrated above the diode
    if (isOn) {
        let glowCenter = vec2<f32>(0.0, -0.1); // Above the diode
        let glowDist = length(uv - glowCenter);
        let innerGlow = (1.0 - smoothstep(0.0, 0.4, glowDist)) * noteGlow * 0.35;
        finalColor += color * innerGlow;
    }

    // Fresnel rim highlight
    finalColor += fresnel * vec3<f32>(0.9, 0.95, 1.0) * 0.15;

    return vec4<f32>(finalColor, edgeAlpha);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  // Compute derivatives in uniform control flow (before any early returns)
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

  // --- INDICATOR RING (Channel 0 / Outer Ring) ---
  if (in.channel == 0u) {
    let onPlayhead = playheadActivation > 0.5;
    let indSize = vec2<f32>(0.3, 0.3);
    // Blue/Orange: indicator uses warm orange
    let indColor = mix(vec3<f32>(0.15), fs.ledOnColor * 1.3, playheadActivation);
    let indLed = drawFrostedGlassCap(p, indSize, indColor, onPlayhead, aa, playheadActivation * 1.5, indColor, playheadActivation);

    var col = indLed.rgb;
    var alpha = indLed.a;
    if (playheadActivation > 0.0) {
      // Bright orange pulse on beat
      let beatPulse = 1.0 + kick * 0.6 + (0.5 + 0.5 * sin(beat * 6.2832)) * 0.2;
      let glow = fs.ledOnColor * (bloom * 5.0) * exp(-length(p) * 3.5) * playheadActivation * beatPulse;
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.25, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // --- PATTERN ROWS ---
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
    let noteChar = (in.packedA >> 24) & 255u;
    let inst = (in.packedA >> 16) & 255u;  // Fixed: bits 16-23, not 0-7
    let effCode = (in.packedB >> 8) & 255u;
    let effParam = in.packedB & 255u;

    // Fixed: numeric note values 1-120, not ASCII A-G (65-71)
    let hasNote = (noteChar > 0u) && (noteChar <= 120u);
    let hasEffect = (effParam > 0u);
    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);

    // COMPONENT 1: ACTIVITY LIGHT (Blue indicator for trap)
    let topUV = btnUV - vec2<f32>(0.5, 0.16);
    let topSize = vec2<f32>(0.20, 0.20);

    let isActive = (step(0.3, exp(-ch.noteAge * 4.0)) > 0.5) && !isMuted;
    // Blue accent for trap palette
    let topColor = vec3<f32>(0.15, 0.5, 1.0) * select(0.0, 1.5 + bloom, isActive);

    let topLed = drawFrostedGlassCap(topUV, topSize, topColor, isActive, aa, select(0.0, 1.0, isActive), topColor, select(0.0, 1.0, isActive));
    finalColor = mix(finalColor, topLed.rgb, topLed.a);

    // COMPONENT 2: MAIN NOTE LIGHT
    let mainUV = btnUV - vec2<f32>(0.5, 0.5);
    let mainSize = vec2<f32>(0.55, 0.45);

    var noteColor = vec3<f32>(0.15);
    var lightAmount = 0.0;
    var noteGlow = 0.0;

    if (hasNote) {
      let pitchHue = pitchClassFromPacked(in.packedA);
      let baseColor = neonPalette(pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
      noteColor = baseColor * instBright;

      let linger = exp(-ch.noteAge * 1.2);
      let strike = playheadActivation * 3.5;
      let flash = f32(ch.trigger) * 1.2;

      let totalSteps = 64.0;
      let d = fract((f32(in.row) + uniforms.tickOffset - uniforms.playheadRow) / totalSteps) * totalSteps;
      let coreDist = min(d, totalSteps - d);
      let energy = 0.03 / (coreDist + 0.001);
      let trail = exp(-7.0 * max(0.0, -d));
      let activeVal = clamp(pow(energy, 1.3) + trail, 0.0, 1.0);

      // Beat-reactive: brighter pulse on kick
      let beatBoost = 1.0 + kick * 0.5;
      lightAmount = (activeVal * 0.9 + flash + strike + (linger * 2.5)) * clamp(ch.volume, 0.0, 1.2) * beatBoost;
      if (isMuted) { lightAmount *= 0.2; }
      noteGlow = lightAmount;
    }

    let displayColor = noteColor * max(lightAmount, 0.12) * (1.0 + bloom * 8.0);
    let isLit = (lightAmount > 0.05);
    let mainPad = drawFrostedGlassCap(mainUV, mainSize, displayColor, isLit, aa, noteGlow, displayColor, noteGlow);
    finalColor = mix(finalColor, mainPad.rgb, mainPad.a);

    // Playhead pulse
    if (playheadActivation > 0.5 && hasNote) {
      let pulseColor = mix(vec3<f32>(0.15, 0.5, 1.0), vec3<f32>(1.0, 0.55, 0.1), 0.5 + 0.5 * sin(beat * 6.2832));
      finalColor += pulseColor * playheadActivation * 0.15;
    }

    // COMPONENT 3: EFFECT INDICATOR (Orange pill)
    let botUV = btnUV - vec2<f32>(0.5, 0.85);
    let botSize = vec2<f32>(0.25, 0.12);
    var effColor = vec3<f32>(0.0);
    var isEffOn = false;

    if (effCode > 0u && hasEffect) {
      effColor = effectColorFromCode(effCode, vec3<f32>(1.0, 0.55, 0.1));
      if (!isMuted) {
        effColor *= (1.0 + bloom * 3.5);
        isEffOn = true;
      }
    }

    let botLed = drawFrostedGlassCap(botUV, botSize, effColor, isEffOn, aa, select(0.0, 0.7, isEffOn), effColor, select(0.0, 0.7, isEffOn));
    finalColor = mix(finalColor, botLed.rgb, botLed.a);
  }

  // Kick reactive glow
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.3;
  finalColor += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * uniforms.bloomIntensity;

  // Dithering for night mode
  let noise = fract(sin(dot(in.uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  finalColor += (noise - 0.5) * 0.01;

  if (housingMask < 0.5) { return vec4<f32>(fs.borderColor, 0.0); }
  return vec4<f32>(finalColor, 1.0);
}
