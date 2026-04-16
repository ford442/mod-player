// patternv0.46.wgsl
// Frosted Glass - Circular Layout with Translucent Glass Caps

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

  // Cull instances not in current 64-step page to prevent alpha/z-fighting
  let pageStart = u32(uniforms.playheadRow / 64.0) * 64u;
  var isVisible = (row >= pageStart && row < pageStart + 64u);

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
  let localPos = (lp - vec2<f32>(0.5, 0.5)) * vec2<f32>(btnW, btnH);

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
  var a = 0u;
  var b = 0u;
  if (idx + 1u < arrayLength(&cells)) {
      a = cells[idx];
      b = cells[idx + 1u];
  }

  // Move invisible instances off-screen instead of using w=0 (which creates degenerate triangles at origin)
  let finalPos = select(vec4<f32>(2.0, 2.0, 0.0, 1.0), vec4<f32>(clipX, clipY, 0.0, 1.0), isVisible);

  var out: VertexOut;
  out.position = finalPos;
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
  return length(max(q, vec2<f32>(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
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

fn drawFrostedGlassCap(uv: vec2<f32>, size: vec2<f32>, color: vec3<f32>, isOn: bool, aa: f32, noteGlow: f32) -> vec4<f32> {
    let p = uv;
    let dBox = sdRoundedBox(p, size * 0.5, 0.08);
    
    if (dBox > 0.0) {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }
    
    let n = normalize(vec3<f32>(p.x * 2.0 / size.x, p.y * 2.0 / size.y, 0.35));
    let viewDir = vec3<f32>(0.0, 0.0, 1.0);
    
    let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.5);
    let radial = length(p / (size * 0.5));
    let thickness = 0.12;
    let subsurface = exp(-thickness * 3.5) * noteGlow * (1.0 - radial * 0.4);
    
    let bgColor = vec3<f32>(0.05, 0.05, 0.06);
    let glassColor = mix(bgColor * 0.2, color, 0.8);
    
    let edgeAlpha = smoothstep(0.0, aa * 2.0, -dBox);
    let alpha = edgeAlpha * (0.7 + 0.3 * fresnel);
    
    let light = vec3<f32>(0.5, -0.8, 1.0);
    let diff = max(0.0, dot(n, normalize(light)));
    let litGlassColor = glassColor * (0.55 + 0.45 * diff);
    
    var finalColor = mix(bgColor, litGlassColor, alpha);
    finalColor += subsurface * color * 3.5;
    
    if (isOn) {
        let innerGlow = (1.0 - radial) * noteGlow * 0.4;
        finalColor += color * innerGlow;
    }
    
    finalColor += fresnel * color * noteGlow * 0.3;
    return vec4<f32>(finalColor, edgeAlpha);
}
@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  // Compute derivatives in uniform control flow (before any early returns)
  let uv = in.uv;
  let p = uv - vec2<f32>(0.5, 0.5);
  let aa = fwidth(p.y) * 0.33;
  
  if (in.channel >= uniforms.numChannels) { return vec4<f32>(0.0); }
  
  let fs = getFragmentConstants();
  let bloom = uniforms.bloomIntensity;

  // ── Playhead proximity ────────────────────────────────────────────────────
  let totalSteps = 64.0;
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / totalSteps) * totalSteps;
  let rowF = f32(in.row % 64u);
  let rowDistRaw = abs(rowF - playheadStep);
  let rowDist = min(rowDistRaw, totalSteps - rowDistRaw);
  let playheadHit = 1.0 - smoothstep(0.0, 2.0, rowDist);

  // NOTE: Early discard moved to after derivative computation to avoid undefined behavior in fwidth()
  // Clip UI strip at bottom of canvas — SAFE HERE after derivatives computed
  if (in.position.y > uniforms.canvasH * 0.88) { discard; }

  // ── Trailing sweep ────────────────────────────────────────────────────────
  let stepsBehind = fract((playheadStep - rowF) / totalSteps) * totalSteps;
  let trailGlow = select(
    0.0,
    exp(-stepsBehind * 0.40),
    stepsBehind > 0.001 && stepsBehind < 14.0
  );

  if (in.channel == 0u) {
    let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / 64.0) * 64.0;
    let rowDistRaw = abs(f32(in.row % 64u) - playheadStep);
    let rowDist = min(rowDistRaw, 64.0 - rowDistRaw);
    let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);
    let onPlayhead = playheadActivation > 0.5;
    
    // Explicit Type Fixes
    let indSize = vec2<f32>(0.3, 0.3);
    let indColor = mix(vec3<f32>(0.2, 0.2, 0.2), fs.ledOnColor * 1.2, playheadActivation);
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

  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  var finalColor = fs.bgColor;

  let btnScale = 1.05;
  let btnUV = (uv - vec2<f32>(0.5, 0.5)) * btnScale + vec2<f32>(0.5, 0.5);
  var inButton = 0.0;
  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    inButton = 1.0;
  }

  if (inButton > 0.5) {
    let note          = (in.packedA >> 24) & 255u;
    let inst          = (in.packedA >> 16) & 255u;
    let volCmd        = (in.packedA >>  8) & 255u;
    let effCmd        = (in.packedB >>  8) & 255u;
    let hasNote       = (note > 0u) && (note <= 120u);
    let hasExpression = (volCmd > 0u) || (effCmd > 0u);
    let ch            = channels[in.channel];
    let isMuted       = (ch.isMuted == 1u);

    if (!isMuted) {
      if (hasNote) {
        let pitchHue = pitchClassFromIndex(note);
        let noteCol  = neonPalette(pitchHue);
        // playheadHit already computed above (0..1 proximity)
        var noteGlow = playheadHit;
        if (ch.trigger > 0u && playheadHit > 0.5) { noteGlow += 1.0; }

        let mainUV  = btnUV - vec2<f32>(0.5, 0.5);
        let mainSz  = vec2<f32>(0.60, 0.60);
        let mainLed = drawFrostedGlassCap(mainUV, mainSz, noteCol * max(0.35, noteGlow), noteGlow > 0.05, aa, noteGlow);
        finalColor  = mix(finalColor, mainLed.rgb, mainLed.a);
        if (noteGlow > 0.05) { finalColor += noteCol * noteGlow * bloom * 0.3; }
      } else {
        finalColor = mix(finalColor, vec3<f32>(0.06, 0.07, 0.09), 0.5);
      }

      if (hasExpression) {
        let exprCenter = p - vec2<f32>(0.0, -0.32);
        let exprMask   = 1.0 - smoothstep(0.04, 0.07, length(exprCenter));
        let exprCol    = vec3<f32>(0.0, 0.75, 1.0) * (0.9 + bloom * 0.4);
        finalColor     = mix(finalColor, exprCol, exprMask * 0.85);
      }

      if (playheadHit > 0.0) {
        finalColor += vec3<f32>(0.04, 0.04, 0.08) * playheadHit;
      }
    } else {
      finalColor *= 0.3;
    }
  }

  // Kick reactive glow
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.3;
  finalColor += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * uniforms.bloomIntensity;
  // Dithering for night mode
  let noise = fract(sin(dot(in.uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  finalColor += (noise - 0.5) * 0.01;

  if (housingMask < 0.01) { discard; }
  return vec4<f32>(finalColor, housingMask);
}
