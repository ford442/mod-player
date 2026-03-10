// patternv0.49.wgsl
// Frosted Glass Circular – Solid Housing (Behinds) + Full-Height LED-Under-Glass Caps
//
// Layered composition per step:
//   1. BEHINDS  — Solid dark-metallic housing that lights up with vibrant note-data
//                 colours (purple, teal, green, orange, red, cyan) driven by real
//                 pitch / velocity.  This is the "body" of each key.
//   2. CAP      — Full-height frosted acrylic glass cap (0.88 × 0.88 relative)
//                 sitting on top of the housing.  The LED colour shines THROUGH the
//                 glass material (transmissive, not emissive).  Alpha ≈ 0.70–0.90
//                 so the housing colour bleeds through slightly.
//   3. DEPRESSION — On playhead hit the cap scales down 4 % and gains a top
//                 inner shadow to fake a physical key press.
//
// The background hardware image (bezel.wgsl) renders first via the chassis pass.
// The transparent inner-ring area (no instances) lets the bezel dark centre show.
// Alpha blending is enabled by PatternDisplay.tsx for this shader.

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

fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u) { return 0.0; }
  return f32((note - 1u) % 12u) / 12.0;
}

// ── Frosted Glass Cap (LED-Under-Glass model) ────────────────────────────────
//
// The glass cap sits on top of the lit housing.  Light passes THROUGH the
// material from the housing below.  The frosted surface scatters this light,
// creating a soft internal glow whose shape reveals the glass body.
// Alpha stays ~0.70–0.90 (never fully opaque) so the housing colour bleeds through.
//
fn drawGlassCap(p: vec2<f32>, size: vec2<f32>, ledColor: vec3<f32>, ledIntensity: f32, aa: f32) -> vec4<f32> {
  let dBox = sdRoundedBox(p, size * 0.5, 0.07);
  if (dBox > 0.0) { return vec4<f32>(0.0); }

  let radial  = length(p / (size * 0.5));
  let n       = normalize(vec3<f32>(p.x * 2.0 / size.x, p.y * 2.0 / size.y, 0.4));
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.5);  // rim brightening

  // LED hotspot transmitted through frosted glass (Gaussian from centre)
  let hotspot = exp(-radial * radial * 3.2) * ledIntensity;
  let scatter = exp(-radial * 2.2)          * ledIntensity * 0.55;

  // Frosted glass base (neutral grey acrylic tinted by LED)
  let glassDark  = vec3<f32>(0.14, 0.15, 0.18);  // unlit frosted glass
  let glassLight = mix(glassDark, ledColor * 0.85, clamp(ledIntensity * 0.5, 0.0, 0.7));

  // Surface lighting (top-left fill light for 3-D bevel)
  let light = normalize(vec3<f32>(0.4, -0.7, 1.0));
  let diff  = max(0.0, dot(n, light));
  let litGlass = glassLight * (0.55 + 0.45 * diff);

  // Crisp white rim highlight (catches light at the bevelled edge)
  let rimMask = smoothstep(0.0, aa * 3.0, -dBox) * (1.0 - smoothstep(aa * 3.0, aa * 6.0, -dBox));
  let rimLight = vec3<f32>(0.9, 0.92, 0.95) * rimMask * 0.45;

  var col = litGlass;
  col    += ledColor * hotspot * 2.0;                   // LED core glow
  col    += ledColor * scatter * 0.55;                  // sub-surface scatter
  col    += ledColor * fresnel * ledIntensity * 0.40;   // rim LED colour
  col    += rimLight;                                    // white bevel rim

  let edgeAlpha  = smoothstep(0.0, aa * 2.0, -dBox);
  let glassAlpha = edgeAlpha * (0.68 + 0.22 * fresnel + ledIntensity * 0.10);

  return vec4<f32>(col, clamp(glassAlpha, 0.0, 0.92));
}

// ── Fragment ──────────────────────────────────────────────────────────────────
@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p  = uv - 0.5;
  let aa = fwidth(p.y) * 0.33;

  if (in.channel >= uniforms.numChannels) { return vec4<f32>(0.0); }

  let bloom = uniforms.bloomIntensity;
  let kick  = uniforms.kickTrigger;
  let beat  = uniforms.beatPhase;

  if (in.position.y > uniforms.canvasH * 0.88) { discard; }

  // ── Playhead proximity ────────────────────────────────────────────────────
  let totalSteps   = 64.0;
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / totalSteps) * totalSteps;
  let rowDistRaw   = abs(f32(in.row % 64u) - playheadStep);
  let rowDist      = min(rowDistRaw, totalSteps - rowDistRaw);
  let playheadHit  = 1.0 - smoothstep(0.0, 1.5, rowDist);

  // ── CHANNEL 0 — Indicator Ring ────────────────────────────────────────────
  if (in.channel == 0u) {
    let ledOnColor   = vec3<f32>(1.0, 0.55, 0.08);
    let indSize      = vec2<f32>(0.30, 0.30);
    let indIntensity = playheadHit * 1.6;
    let indColor     = mix(vec3<f32>(0.1, 0.12, 0.18), ledOnColor, playheadHit);
    let indCap       = drawGlassCap(p, indSize, indColor, indIntensity, aa);

    var col   = indCap.rgb;
    var alpha = indCap.a;
    if (playheadHit > 0.01) {
      let beatPulse = 1.0 + kick * 0.7 + (0.5 + 0.5 * sin(beat * 6.2832)) * 0.2;
      let glow = ledOnColor * (bloom * 4.5) * exp(-length(p) * 3.5) * playheadHit * beatPulse;
      col  += glow;
      alpha = max(alpha, smoothstep(0.0, 0.25, length(glow)));
    }
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // ── MUSIC CHANNELS ────────────────────────────────────────────────────────

  // Extract note/instrument/effect data
  let note   = (in.packedA >> 24) & 255u;
  let inst   = (in.packedA >> 16) & 255u;
  let effCmd = (in.packedB >>  8) & 255u;
  let hasNote = note > 0u;

  let ch      = channels[in.channel];
  let isMuted = ch.isMuted == 1u;

  // ── 1. BEHINDS — Solid metallic housing lit by note data ──────────────────
  // This is the coloured body of the key, visible through the frosted glass cap.
  let housingSize = vec2<f32>(0.92, 0.92);
  let dHousing    = sdRoundedBox(p, housingSize * 0.5, 0.07);
  let housingMask = 1.0 - smoothstep(0.0, aa * 1.5, dHousing);

  // Dark metallic base (used when note is absent or muted)
  let metalDark = vec3<f32>(0.07, 0.08, 0.11);
  var housingColor = metalDark;
  var noteHue = vec3<f32>(0.0);
  var actGlow  = 0.0;

  if (hasNote && !isMuted) {
    let pitchHue = pitchClassFromIndex(note);
    noteHue = neonPalette(pitchHue);

    // Activity: lingering glow + trigger flash + playhead hit
    let linger  = exp(-ch.noteAge * 0.9);
    let flash   = f32(ch.trigger) * 2.5;
    let volScale = clamp(ch.volume, 0.0, 1.5);
    actGlow = clamp(linger * 1.3 + flash, 0.0, 1.0) * volScale;
    let hitBoost = playheadHit * 3.0;
    let totalGlow = max(actGlow, hitBoost);

    // Housing colour: metalDark → vibrant noteHue, minimum visibility 0.10
    housingColor = mix(metalDark, noteHue, clamp(totalGlow + 0.10, 0.0, 1.0));
  }

  // Apply housing fill (solid, inside the rounded box boundary)
  var finalColor = vec3<f32>(0.0); // transparent start (bezel shows at cell gaps)
  finalColor = mix(finalColor, housingColor, housingMask);

  // ── 2. CAP — Full-height frosted glass sits on top of lit housing ─────────
  // Determine LED colour and intensity for the glass transmittance model
  var ledColor:     vec3<f32>;
  var ledIntensity: f32;

  if (!hasNote || isMuted) {
    // No note / muted — very dim so dark glass is barely visible
    ledColor     = vec3<f32>(0.04, 0.04, 0.06);
    ledIntensity = 0.05;
  } else {
    // Note present: idle cool blue → active warm orange
    let idleBlue    = vec3<f32>(0.05, 0.55, 1.0);
    let activeOrange = vec3<f32>(1.0, 0.50, 0.08);
    let hitFrac      = clamp(playheadHit * 1.5, 0.0, 1.0);

    // Tint slightly by note hue for colour identity (15%)
    ledColor = mix(mix(idleBlue, activeOrange, hitFrac), noteHue, 0.15);
    // Minimum 0.38 so cap body is always visible when a note is present
    ledIntensity = max(0.38 + actGlow * 0.65, hitFrac * 1.7 + actGlow);
  }

  // ── 3. DEPRESSION — Key appears to press down on playhead hit ─────────────
  // Cap scale shrinks 4 % and a top inner-shadow appears
  let capBaseScale = 0.88;
  let capScale     = capBaseScale - playheadHit * 0.04;  // 0.88 → 0.84 on hit
  let capSize      = vec2<f32>(capScale, capScale);

  let cap      = drawGlassCap(p, capSize, ledColor, ledIntensity, aa);
  finalColor   = mix(finalColor, cap.rgb, cap.a);

  // Top inner-shadow on active press (dark stripe at upper cap edge)
  if (playheadHit > 0.2) {
    let shadowY    = p.y + capSize.y * 0.38;  // above centre
    let innerShadow = smoothstep(0.06, 0.0, shadowY) * playheadHit * 0.30;
    finalColor    -= vec3<f32>(innerShadow);
  }

  // ── Kick-reactive ambient pulse ───────────────────────────────────────────
  let kickPulse = kick * exp(-length(p) * 3.0) * 0.15;
  finalColor   += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * bloom;

  // ── Noise / dither ────────────────────────────────────────────────────────
  let noise = fract(sin(dot(in.uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  finalColor += (noise - 0.5) * 0.007;

  // Fully opaque for all cells — bezel shows through only in the ring gaps
  // and in the centre circle where no instances are drawn.
  return vec4<f32>(clamp(finalColor, vec3<f32>(0.0), vec3<f32>(3.0)), housingMask);
}
