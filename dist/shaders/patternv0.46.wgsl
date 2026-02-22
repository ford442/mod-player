// patternv0.46.wgsl
// Frosted Glass - Circular Layout with Translucent Glass Caps
// Based on v0.38 circular layout + v0.43 translucent glass rendering

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

  // Use inverted channel logic for rings
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

  // Sizing: 0.95 factor for fuller squares
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
  return a + b * cos(6.28318 * (c * t + d));
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
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
  c.bgColor = vec3<f32>(0.05, 0.05, 0.06);
  c.ledOnColor = vec3<f32>(0.0, 0.85, 0.95);
  c.ledOffColor = vec3<f32>(0.08, 0.08, 0.10);
  c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
  c.housingSize = vec2<f32>(0.92, 0.92);
  return c;
}

// --- TRANSLUCENT GLASS CAP RENDERING ---
fn drawFrostedGlassCap(uv: vec2<f32>, size: vec2<f32>, color: vec3<f32>, isOn: bool, aa: f32, noteGlow: f32) -> vec4<f32> {
    let p = uv;
    let dBox = sdRoundedBox(p, size * 0.5, 0.08);

    if (dBox > 0.0) {
        return vec4<f32>(0.0);
    }

    // Calculate normal for fresnel effect — flatter z for wider rim highlight
    let n = normalize(vec3<f32>(p.x * 2.0 / size.x, p.y * 2.0 / size.y, 0.35));
    let viewDir = vec3<f32>(0.0, 0.0, 1.0);

    // Fresnel rim effect — sharper exponent for a brighter rim band
    let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.5);

    // Radial distance for inner glow falloff (0 at center, 1 at edge)
    let radial = length(p / (size * 0.5));

    // Subsurface scattering — thinner cap lets more light through, radial spread
    let thickness = 0.12;
    let subsurface = exp(-thickness * 3.5) * noteGlow * (1.0 - radial * 0.4);

    // Glass color mixing — higher color contribution for vividness
    let bgColor = vec3<f32>(0.05, 0.05, 0.06);
    let glassColor = mix(bgColor * 0.2, color, 0.8);

    // Alpha with fresnel rim enhancement — higher base transmittance
    let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);
    let alpha = edgeAlpha * (0.7 + 0.3 * fresnel);

    // Diffuse light for 3D effect
    let light = vec3<f32>(0.5, -0.8, 1.0);
    let diff = max(0.0, dot(n, normalize(light)));
    let litGlassColor = glassColor * (0.55 + 0.45 * diff);

    // Composite with background
    var finalColor = mix(bgColor, litGlassColor, alpha);

    // Add subsurface glow — brighter and more diffuse
    finalColor += subsurface * color * 3.5;

    // Inner glow bloom for active caps — uniform radial spread
    if (isOn) {
        let innerGlow = (1.0 - radial) * noteGlow * 0.4;
        finalColor += color * innerGlow;
    }

    // Rim highlight — bright edge halo on illuminated caps
    finalColor += fresnel * color * noteGlow * 0.3;

    return vec4<f32>(finalColor, edgeAlpha);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.33;
  let bloom = uniforms.bloomIntensity;

  // Hardware Layering: Discard pixels over UI
  if (in.position.y > uniforms.canvasH * 0.88) {
    discard;
  }

  // CHANNEL 0 is the Indicator Ring
  if (in.channel == 0u) {
    let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / 64.0) * 64.0;
    let rowDistRaw = abs(f32(in.row % 64u) - playheadStep);
    let rowDist = min(rowDistRaw, 64.0 - rowDistRaw);
    let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);
    let onPlayhead = playheadActivation > 0.5;
    let indSize = vec2(0.3, 0.3);
    let indColor = mix(vec3(0.2), fs.ledOnColor * 1.2, playheadActivation);
    let indLed = drawFrostedGlassCap(p, indSize, indColor, onPlayhead, aa, playheadActivation * 1.5);
    var col = indLed.rgb;
    var alpha = indLed.a;
    if (playheadActivation > 0.0) {
      let glow = fs.ledOnColor * (bloom * 5.0) * exp(-length(p) * 3.5) * playheadActivation;
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.25, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // --- MUSIC CHANNELS (1-32) with TRANSLUCENT GLASS ---
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
    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);

    // Top LED indicator
    let topUV = btnUV - vec2(0.5, 0.16);
    let topSize = vec2(0.20, 0.20);
    let isDataPresent = hasExpression && !isMuted;
    let topColorBase = vec3(0.0, 0.9, 1.0);
    let topColor = topColorBase * select(0.0, 1.5 + bloom, isDataPresent);
    let topLed = drawFrostedGlassCap(topUV, topSize, topColor, isDataPresent, aa, select(0.0, 1.0, isDataPresent));
    finalColor = mix(finalColor, topLed.rgb, topLed.a);

    // Main display area with translucent glass
    let mainUV = btnUV - vec2(0.5, 0.5);
    let mainSize = vec2(0.55, 0.45);
    var noteColor = vec3(0.2);
    var lightAmount = 0.0;
    var noteGlow = 0.0;

    if (hasNote) {
      let pitchHue = pitchClassFromIndex(note);
      let baseColor = neonPalette(pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
      noteColor = baseColor * instBright;

      let linger = exp(-ch.noteAge * 1.2);
      let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / 64.0) * 64.0;
      let rowDistRaw = abs(f32(in.row % 64u) - playheadStep);
      let rowDist = min(rowDistRaw, 64.0 - rowDistRaw);
      let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);
      let strike = playheadActivation * 3.5;
      let flash = f32(ch.trigger) * 1.2;

      var d = f32(in.row % 64u) - playheadStep;
      let totalSteps = 64.0;
      if (d > totalSteps * 0.5) { d = d - totalSteps; }
      if (d < -totalSteps * 0.5) { d = d + totalSteps; }
      let coreDist = abs(d);
      let energy = 0.03 / (coreDist + 0.001);
      let trail = exp(-7.0 * max(0.0, -d));
      let activeVal = clamp(pow(energy, 1.3) + trail, 0.0, 1.0);

      lightAmount = (activeVal * 0.9 + flash + strike + (linger * 2.5)) * clamp(ch.volume, 0.0, 1.2);
      if (isMuted) { lightAmount *= 0.2; }
      noteGlow = lightAmount;
    }

    let displayColor = noteColor * max(lightAmount, 0.12) * (1.0 + bloom * 8.0);
    let isLit = (lightAmount > 0.05);
    let mainPad = drawFrostedGlassCap(mainUV, mainSize, displayColor, isLit, aa, noteGlow);
    finalColor = mix(finalColor, mainPad.rgb, mainPad.a);

    // Bottom effect indicator
    let botUV = btnUV - vec2(0.5, 0.85);
    let botSize = vec2(0.25, 0.12);
    var effColor = vec3(0.0);
    var isEffOn = false;

    if (effCmd > 0u) {
      effColor = neonPalette(f32(effCmd) / 32.0);
      let strength = clamp(f32(effVal) / 255.0, 0.2, 1.0);
      if (!isMuted) {
        effColor *= strength * (1.0 + bloom * 3.5);
        isEffOn = true;
      }
    } else if (volCmd > 0u) {
      effColor = vec3(0.9, 0.9, 0.9);
      if (!isMuted) { effColor *= 0.6; isEffOn = true; }
    }

    let botLed = drawFrostedGlassCap(botUV, botSize, effColor, isEffOn, aa, select(0.0, 0.7, isEffOn));
    finalColor = mix(finalColor, botLed.rgb, botLed.a);
  }

  if (housingMask < 0.5) { return vec4(fs.borderColor, 0.0); }
  return vec4(finalColor, 1.0);
}
