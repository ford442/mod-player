// patternv0.38.wgsl
// Features: Circular Layout (v0.37 clone) + Prepared for WebGL2 Glass Overlay
// PackedA: [Note(8) | Instr(8) | VolCmd(8) | VolVal(8)]
// PackedB: [Unused(16) | EffCmd(8) | EffVal(8)]

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

  // v0.37/38 size: 0.75 factor
  let btnW = arcLength * 0.75;
  let btnH = ringDepth * 0.75;

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
  c.bgColor = vec3<f32>(0.15, 0.16, 0.18);
  c.ledOnColor = vec3<f32>(0.0, 0.85, 0.95);
  c.ledOffColor = vec3<f32>(0.08, 0.08, 0.10);
  c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
  c.housingSize = vec2<f32>(0.92, 0.92);
  return c;
}

fn drawChromeIndicator(uv: vec2<f32>, size: vec2<f32>, color: vec3<f32>, isOn: bool, aa: f32) -> vec4<f32> {
    let uv01 = (uv / size) + vec2<f32>(0.5);
    let lensR = 0.7;
    let bezelR = 0.9;
    let center = vec2<f32>(0.5, 0.5);
    let dist = length(uv01 - center) * 2.0;

    var col = vec3<f32>(0.0);
    var alpha = 0.0;

    if (dist < bezelR) {
        if (dist > lensR) {
            let angle = atan2(uv01.y - center.y, uv01.x - center.x);
            let rim = 0.2 + 0.8 * abs(sin(angle * 10.0));
            col = vec3<f32>(0.25, 0.28, 0.30) * rim;
            alpha = 1.0;
        } else {
            let lensNormR = dist / lensR;
            let z = sqrt(max(0.0, 1.0 - lensNormR * lensNormR));
            let localXY = (uv01 - center) / lensR;
            let normal = normalize(vec3<f32>(localXY.x, localXY.y, z));
            let lightDir = normalize(vec3<f32>(-0.5, 0.5, 1.0));
            let diffuse = max(0.0, dot(normal, lightDir));
            let reflectDir = reflect(-lightDir, normal);
            let specular = pow(max(0.0, dot(reflectDir, vec3<f32>(0.0, 0.0, 1.0))), 10.0);

            let baseColor = color;
            col = baseColor * (0.5 + 0.8 * diffuse);
            col += vec3<f32>(1.0) * specular * 0.5;

            let rimGlow = exp(-pow(lensNormR, 2.0) * 6.0);
            col += baseColor * rimGlow * 0.25;
            alpha = 1.0;
        }
    } else {
        return vec4<f32>(vec3<f32>(0.0), 0.0);
    }
    let vignette = smoothstep(bezelR * 0.95, bezelR, dist);
    col = mix(col * (1.0 - 0.08 * vignette), vec3<f32>(0.02), vignette);
    return vec4<f32>(col, alpha);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y) * 0.33;
  let bloom = uniforms.bloomIntensity;

  if (in.position.y > uniforms.canvasH * 0.88) {
    discard;
  }

  if (in.channel == 0u) {
    let onPlayhead = (in.row == uniforms.playheadRow);
    let indSize = vec2(0.3, 0.3);
    let indColor = select(vec3(0.2), fs.ledOnColor, onPlayhead);
    let indLed = drawChromeIndicator(p, indSize, indColor, onPlayhead, aa);
    var col = indLed.rgb;
    var alpha = indLed.a;
    if (onPlayhead) {
      let glow = fs.ledOnColor * (bloom * 4.0) * exp(-length(p) * 4.0);
      col += glow;
      alpha = max(alpha, smoothstep(0.0, 0.2, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = fs.bgColor;
  finalColor += vec3(0.04) * (0.5 - uv.y);

  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var inButton = 0.0;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    let texColor = textureSampleLevel(buttonsTexture, buttonsSampler, btnUV, -0.5).rgb;
    finalColor = mix(finalColor, texColor, 0.7);
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

    let topUV = btnUV - vec2(0.5, 0.16);
    let topSize = vec2(0.20, 0.20);
    let isDataPresent = hasExpression && !isMuted;
    let topColorBase = vec3(0.0, 0.9, 1.0);
    let topColor = topColorBase * select(0.0, 1.5 + bloom, isDataPresent);
    let topLed = drawChromeIndicator(topUV, topSize, topColor, isDataPresent, aa);
    finalColor = mix(finalColor, topLed.rgb, topLed.a);
    if (isDataPresent) { finalColor += topColor * topLed.a * 0.3; }

    let mainUV = btnUV - vec2(0.5, 0.5);
    let mainSize = vec2(0.55, 0.45);
    var noteColor = vec3(0.2);
    var lightAmount = 0.0;

    if (hasNote) {
      let pitchHue = pitchClassFromIndex(note);
      let baseColor = neonPalette(pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.8 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.2;
      noteColor = baseColor * instBright;

      let linger = exp(-ch.noteAge * 1.5);
      let onPlayhead = (in.row == uniforms.playheadRow);
      let strike = select(0.0, 3.0, onPlayhead);
      let flash = f32(ch.trigger) * 1.0;

      var d = f32(in.row) + uniforms.tickOffset - f32(uniforms.playheadRow);
      let totalSteps = 64.0;
      if (d > totalSteps * 0.5) { d = d - totalSteps; }
      if (d < -totalSteps * 0.5) { d = d + totalSteps; }
      let coreDist = abs(d);
      let energy = 0.02 / (coreDist + 0.001);
      let trail = exp(-10.0 * max(0.0, -d));
      let activeVal = clamp(pow(energy, 1.5) + trail, 0.0, 1.0);

      lightAmount = (activeVal * 0.8 + flash + strike + (linger * 2.0)) * clamp(ch.volume, 0.0, 1.2);
      if (isMuted) { lightAmount *= 0.2; }
    }

    let displayColor = noteColor * max(lightAmount, 0.1) * (1.0 + bloom * 6.0);
    let isLit = (lightAmount > 0.05);
    let mainPad = drawChromeIndicator(mainUV, mainSize, displayColor, isLit, aa);
    finalColor = mix(finalColor, mainPad.rgb, mainPad.a);

    let botUV = btnUV - vec2(0.5, 0.85);
    let botSize = vec2(0.25, 0.12);
    var effColor = vec3(0.0);
    var isEffOn = false;

    if (effCmd > 0u) {
      effColor = neonPalette(f32(effCmd) / 32.0);
      let strength = clamp(f32(effVal) / 255.0, 0.2, 1.0);
      if (!isMuted) {
        effColor *= strength * (1.0 + bloom * 2.5);
        isEffOn = true;
      }
    } else if (volCmd > 0u) {
      effColor = vec3(0.9, 0.9, 0.9);
      if (!isMuted) { effColor *= 0.5; isEffOn = true; }
    }

    let botLed = drawChromeIndicator(botUV, botSize, effColor, isEffOn, aa);
    finalColor = mix(finalColor, botLed.rgb, botLed.a);
  }

  if (housingMask < 0.5) { return vec4(fs.borderColor, 0.0); }
  return vec4(finalColor, 1.0);
}
