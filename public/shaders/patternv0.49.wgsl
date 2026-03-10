// patternv0.49.wgsl
// Frosted Glass Circular – Full-Height LED-Under-Glass Caps
// Architecture: Per-instance instanced rendering (one quad per step × channel).
// Each cap is a full-height frosted acrylic key with an LED mounted underneath.
// Light shines THROUGH the glass material; alpha stays < 1.0 for translucency.

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

  let center = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let minDim  = min(uniforms.canvasW, uniforms.canvasH);

  let maxRadius = minDim * 0.45;
  let minRadius = minDim * 0.15;
  let ringDepth = (maxRadius - minRadius) / f32(numChannels);
  let radius    = minRadius + f32(ringIndex) * ringDepth;

  let totalSteps  = 64.0;
  let anglePerStep = 6.2831853 / totalSteps;
  let theta       = -1.570796 + f32(row % 64u) * anglePerStep;

  let circumference = 2.0 * 3.14159265 * radius;
  let arcLength     = circumference / totalSteps;
  let btnW          = arcLength * 0.95;
  let btnH          = ringDepth * 0.95;

  let lp       = quad[vertexIndex];
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
  let beatDrift = uniforms.beatPhase * 0.1;
  return a + b * cos(6.28318 * (c * (t + beatDrift) + d));
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u) { return 0.0; }
  return f32((note - 1u) % 12u) / 12.0;
}

// ── Frosted Glass Cap (LED-Under-Glass model) ────────────────────────────────
//
// Simulates: LED light emitting upward through a frosted acrylic keycap.
//   ledColor  – the colour/temperature of the underlying LED
//   ledIntensity – 0..1+ (0 = off, 1 = idle, >1 = active hit)
//   The glass transmits light multiplicatively, scatters at the surface,
//   and adds a Fresnel rim highlight.  Alpha stays < 1.0 (translucent glass).
//
fn drawGlassCap(p: vec2<f32>, size: vec2<f32>, ledColor: vec3<f32>, ledIntensity: f32, aa: f32) -> vec4<f32> {
  let dBox = sdRoundedBox(p, size * 0.5, 0.07);

  // Outside the physical cap geometry – completely transparent
  if (dBox > 0.0) { return vec4<f32>(0.0); }

  // ── Glass material properties ─────────────────────────────────────────────
  let radial    = length(p / (size * 0.5));          // 0 = center, 1 = edge
  let n         = normalize(vec3<f32>(p.x * 2.0 / size.x, p.y * 2.0 / size.y, 0.4));
  let viewDir   = vec3<f32>(0.0, 0.0, 1.0);
  let fresnel   = pow(1.0 - abs(dot(n, viewDir)), 2.5);  // rim brightening

  // ── LED hotspot: bright emissive core that diffuses toward edges ───────────
  // This is the primary source of light – it shines UP through the glass.
  let hotspot   = exp(-radial * radial * 3.5) * ledIntensity;      // Gaussian falloff
  let scatter   = exp(-radial * 2.5)          * ledIntensity * 0.5; // wider scatter

  // ── Frosted glass base colour ─────────────────────────────────────────────
  // Idle glass has a slight tint from the LED; darker glass base dims when LED is off.
  let glassDark  = vec3<f32>(0.06, 0.07, 0.09);                    // unlit glass
  let glassLight = mix(glassDark, ledColor, clamp(ledIntensity * 0.6, 0.0, 0.8));

  // Directional diffuse (surface shading)
  let light = vec3<f32>(0.4, -0.7, 1.0);
  let diff  = max(0.0, dot(n, normalize(light)));
  let litGlass = glassLight * (0.55 + 0.45 * diff);

  // ── Composite ─────────────────────────────────────────────────────────────
  let edgeAlpha  = smoothstep(0.0, aa * 2.0, -dBox);
  let glassAlpha = edgeAlpha * (0.65 + 0.25 * fresnel); // ~0.65–0.90, never fully opaque

  var col = litGlass;
  col    += ledColor * hotspot * 1.8;               // LED core glow
  col    += ledColor * scatter * 0.6;               // sub-surface scatter
  col    += ledColor * fresnel * ledIntensity * 0.35; // rim highlight

  return vec4<f32>(col, glassAlpha);
}

// ── Fragment ──────────────────────────────────────────────────────────────────
@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  // Derivatives must be computed in uniform control flow
  let uv = in.uv;
  let p  = uv - 0.5;
  let aa = fwidth(p.y) * 0.33;

  if (in.channel >= uniforms.numChannels) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }

  let bloom = uniforms.bloomIntensity;
  let kick  = uniforms.kickTrigger;
  let beat  = uniforms.beatPhase;

  // Clip UI strip at bottom of canvas
  if (in.position.y > uniforms.canvasH * 0.88) { discard; }

  // ── Playhead proximity (smooth, wraps around 64-step page) ────────────────
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / 64.0) * 64.0;
  let rowDistRaw   = abs(f32(in.row % 64u) - playheadStep);
  let rowDist      = min(rowDistRaw, 64.0 - rowDistRaw);
  let playheadHit  = 1.0 - smoothstep(0.0, 1.5, rowDist);   // 1 = on playhead

  // ── CHANNEL 0 — Indicator Ring (playhead position marker) ─────────────────
  if (in.channel == 0u) {
    let ledOnColor = vec3<f32>(1.0, 0.55, 0.1); // warm orange indicator
    let indSize    = vec2<f32>(0.30, 0.30);
    let indIntensity = playheadHit * 1.5;
    let indColor   = mix(vec3<f32>(0.1, 0.12, 0.18), ledOnColor, playheadHit);
    let indCap     = drawGlassCap(p, indSize, indColor, indIntensity, aa);

    var col   = indCap.rgb;
    var alpha = indCap.a;
    if (playheadHit > 0.01) {
      let beatPulse = 1.0 + kick * 0.6 + (0.5 + 0.5 * sin(beat * 6.2832)) * 0.2;
      let glow = ledOnColor * (bloom * 5.0) * exp(-length(p) * 3.5) * playheadHit * beatPulse;
      col  += glow;
      alpha = max(alpha, smoothstep(0.0, 0.25, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // ── MUSIC CHANNELS — Full-height frosted glass caps ───────────────────────
  // Housing background: dark blue-grey panel behind each button
  let bgColor     = vec3<f32>(0.08, 0.09, 0.13);
  var finalColor  = bgColor;

  // ── Extract note/instrument/effect data from packed buffer ────────────────
  let note   = (in.packedA >> 24) & 255u;
  let inst   = (in.packedA >> 16) & 255u;
  let effCmd = (in.packedB >>  8) & 255u;
  let hasNote = note > 0u;

  let ch      = channels[in.channel];
  let isMuted = ch.isMuted == 1u;

  // ── Determine LED colour and intensity ────────────────────────────────────
  //   Empty / muted  → LED off  (very dim, glass barely visible)
  //   Note, idle     → Cool blue glow passing through glass
  //   Note, active   → Warm orange flash (playhead hit)
  var ledColor:     vec3<f32>;
  var ledIntensity: f32;

  let idleBlue   = vec3<f32>(0.05, 0.55, 1.00);  // cool blue LED (note present, idle)
  let activeOrange = vec3<f32>(1.00, 0.50, 0.08); // warm orange LED (playhead hit)

  if (!hasNote || isMuted) {
    // No note — LED off, dark glass
    ledColor     = vec3<f32>(0.04, 0.04, 0.06);
    ledIntensity = 0.06;
  } else {
    // Note present — LED on
    let pitchHue   = pitchClassFromIndex(note);
    let pitchTint  = neonPalette(pitchHue);

    // Activity: lingering glow + trigger flash
    let linger     = exp(-ch.noteAge * 1.2);
    let flash      = f32(ch.trigger) * 1.5;
    let volScale   = clamp(ch.volume, 0.0, 1.2);
    let actGlow    = clamp(linger * 1.5 + flash, 0.0, 1.0) * volScale;

    // Blend idle blue → active orange based on playhead proximity
    let hitFrac    = clamp(playheadHit * 1.5, 0.0, 1.0);
    let baseLed    = mix(idleBlue, activeOrange, hitFrac);
    // Subtle pitch tint (15%) so each pitch has a unique hue cast
    ledColor       = mix(baseLed, pitchTint, 0.15);

    // Intensity: minimum 0.4 when note is present so cap is always visible,
    // boosted further by playhead hit and channel activity
    ledIntensity   = max(0.40 + actGlow * 0.6, hitFrac * 1.6 + actGlow);
    if (isMuted) { ledIntensity *= 0.2; }
  }

  // ── Draw the full-height frosted glass cap ────────────────────────────────
  // Size 0.88×0.88 (relative to button) covers the entire step area
  let capSize = vec2<f32>(0.88, 0.88);
  let cap     = drawGlassCap(p, capSize, ledColor, ledIntensity, aa);

  // Composite cap over housing background (cap alpha < 1.0 → glass translucency)
  finalColor  = mix(finalColor, cap.rgb, cap.a);

  // ── LED centre hotspot leak onto housing ──────────────────────────────────
  // Very subtle ambient light that bleeds outside the cap boundary
  if (hasNote && !isMuted && ledIntensity > 0.3) {
    let leak = exp(-length(p) * 5.0) * (ledIntensity - 0.3) * 0.25;
    finalColor += ledColor * leak;
  }

  // ── Kick-reactive ambient pulse ───────────────────────────────────────────
  let kickPulse = kick * exp(-length(p) * 3.0) * 0.18;
  finalColor   += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * bloom;

  // ── Noise / dither (anti-banding) ────────────────────────────────────────
  let noise    = fract(sin(dot(in.uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  finalColor  += (noise - 0.5) * 0.008;

  // Always fully opaque — the glass translucency is encoded in the RGB, not alpha
  return vec4<f32>(clamp(finalColor, vec3<f32>(0.0), vec3<f32>(3.0)), 1.0);
}
