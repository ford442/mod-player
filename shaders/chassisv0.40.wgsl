// chassisv0.37.wgsl
// White Hardware Chassis Pass (fullscreen) + Global UI Controls (Play/Stop/etc)
// Drawn via the existing background pass slot (uniform @binding(0)).

struct BezelUniforms {
  canvasW: f32,
  canvasH: f32,
  bezelWidth: f32,
  surfaceR: f32,
  surfaceG: f32,
  surfaceB: f32,
  bezelR: f32,
  bezelG: f32,
  bezelB: f32,
  screwRadius: f32,
  recessKind: f32,
  recessOuterScale: f32,
  recessInnerScale: f32,
  recessCorner: f32,
  dimFactor: f32,   // 1.0 = Stop, 0.35 = Playing (Night Mode)
  _pad1: f32,
  // New fields for UI controls
  volume: f32,      // 0.0 to 1.0
  pan: f32,         // -1.0 to 1.0
  bpm: f32,
  isLooping: u32,
  currentOrder: u32,
  currentRow: u32,
  clickedButton: u32, // 0=none, 1=loop, 2=open, 3=play, 4=stop
  _pad2: f32,
};

@group(0) @binding(0) var<uniform> bez: BezelUniforms;
@group(0) @binding(1) var bezelSampler: sampler;
@group(0) @binding(2) var bezelTexture: texture_2d<f32>;

fn hash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

fn sdTriangle(p: vec2<f32>, r: f32) -> f32 {
    let k = sqrt(3.0);
    var p2 = p;
    p2.x = abs(p2.x) - r;
    p2.y = p2.y + r / k;
    if (p2.x + k * p2.y > 0.0) {
        p2 = vec2<f32>(p2.x - k * p2.y, -k * p2.x - p2.y) / 2.0;
    }
    p2.x = p2.x - clamp(p2.x, -2.0 * r, 0.0);
    return -length(p2) * sign(p2.y);
}

fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

// Simple 7-segment style digit rendering
fn drawDigit(p: vec2<f32>, digit: u32, size: f32) -> f32 {
    let segW = size * 0.15;
    let segL = size * 0.45;
    let gap = size * 0.05;

    var segments = array<u32, 10>(
        0x77u, 0x24u, 0x5du, 0x6du, 0x2eu,
        0x6bu, 0x7bu, 0x25u, 0x7fu, 0x6fu
    );

    let code = select(0u, segments[digit], digit < 10u);
    var minDist = 100.0;

    if ((code & 0x01u) != 0u) { minDist = min(minDist, sdBox(p - vec2<f32>(0.0, -segL), vec2<f32>(segL, segW))); }
    if ((code & 0x02u) != 0u) { minDist = min(minDist, sdBox(p - vec2<f32>(segL, -segL * 0.5 - gap * 0.5), vec2<f32>(segW, segL * 0.5))); }
    if ((code & 0x04u) != 0u) { minDist = min(minDist, sdBox(p - vec2<f32>(segL, segL * 0.5 + gap * 0.5), vec2<f32>(segW, segL * 0.5))); }
    if ((code & 0x08u) != 0u) { minDist = min(minDist, sdBox(p - vec2<f32>(0.0, segL), vec2<f32>(segL, segW))); }
    if ((code & 0x10u) != 0u) { minDist = min(minDist, sdBox(p - vec2<f32>(-segL, segL * 0.5 + gap * 0.5), vec2<f32>(segW, segL * 0.5))); }
    if ((code & 0x20u) != 0u) { minDist = min(minDist, sdBox(p - vec2<f32>(-segL, -segL * 0.5 - gap * 0.5), vec2<f32>(segW, segL * 0.5))); }
    if ((code & 0x40u) != 0u) { minDist = min(minDist, sdBox(p, vec2<f32>(segL, segW))); }

    return minDist;
}

fn drawNumber(p: vec2<f32>, value: u32, numDigits: u32, digitSize: f32, spacing: f32) -> f32 {
    var minDist = 100.0;
    var v = value;
    for (var i = 0u; i < numDigits; i = i + 1u) {
        let digit = v % 10u;
        v = v / 10u;
        let xPos = f32(i) * spacing - f32(numDigits - 1u) * spacing * 0.5;
        let d = drawDigit(p - vec2<f32>(-xPos, 0.0), digit, digitSize);
        minDist = min(minDist, d);
    }
    return minDist;
}

fn drawText(p: vec2<f32>, size: vec2<f32>) -> f32 {
    return sdBox(p, size);
}

// White Square Button Style
fn drawWhiteButton(uv: vec2<f32>, size: vec2<f32>, glowColor: vec3<f32>, isOn: bool, aa: f32) -> vec4<f32> {
  let halfSize = size * 0.5;
  // Use radius 0.0 for perfectly square buttons
  let d = sdRoundedBox(uv, halfSize, 0.0);

  // Pure white base color
  var col = vec3<f32>(1.0, 1.0, 1.0);
  // Removed texture cosine modulation for cleaner look

  var alpha = 0.0;
  let bodyMask = 1.0 - smoothstep(0.0, aa, d);

  if (isOn) {
      col = vec3<f32>(1.0, 1.0, 1.0);
      col = mix(col, glowColor, 0.2);
  } else {
      col = vec3<f32>(0.65, 0.65, 0.68);
  }

  if (bodyMask > 0.0) { alpha = 1.0; }

  if (isOn) {
      let glowDist = max(0.0, d);
      let glow = exp(-glowDist * 12.0) * glowColor * 1.5;
      if (d > 0.0) {
        col = glow;
        alpha = smoothstep(0.0, 0.4, length(glow));
      } else {
        col += glow * 0.5;
      }
  }

  if (!isOn) { alpha = bodyMask; }
  return vec4<f32>(col, alpha);
}

struct VertOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertOut {
  var verts = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
  );
  let pos = verts[vertexIndex];
  var out: VertOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + vec2<f32>(0.5);
  return out;
}

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let p = uv - 0.5;
  let aa = 1.0 / bez.canvasH;

  let colPlastic = vec3<f32>(0.08, 0.08, 0.10);
  let colRecess = vec3<f32>(0.05, 0.05, 0.06);

  // --- PASS 1: PHYSICAL CASE (Dimmed) ---
  var color = colPlastic;

  let texSample = textureSampleLevel(bezelTexture, bezelSampler, uv, 0.0);
  if (texSample.a > 0.1) {
    color = mix(color, texSample.rgb, texSample.a);
  } else {
    let dist = length(p);
    if (dist < 0.47 && dist > 0.13) {
        color = colRecess;
        color -= vec3<f32>(0.01) * sin(dist * 200.0);
    }
  }

  let displayY = 0.45;

  // --- 1. SLIDER DEFINITIONS ---

  // Panning (Right Vertical) - kept as is
  let sliderRightX = 0.42;
  let sliderY = -0.2;
  let sliderH = 0.2;
  let sliderW = 0.015;

  // Volume (Top Right Horizontal) - Moved inward from 0.18 to 0.08
  let volPos = vec2<f32>(0.08, 0.415);
  let volDim = vec2<f32>(0.09, 0.006); // Half-extents (0.18 width)

  // --- 2. LABELS ---

  // Tempo/BPM
  let dTempoLabel = drawText(p - vec2<f32>(-0.07, displayY), vec2<f32>(0.03, 0.008));
  if (dTempoLabel < 0.0) { color = mix(color, vec3<f32>(0.6, 0.6, 0.7), smoothstep(aa, 0.0, dTempoLabel)); }

  let dBPMLabel = drawText(p - vec2<f32>(0.07, displayY), vec2<f32>(0.015, 0.008));
  if (dBPMLabel < 0.0) { color = mix(color, vec3<f32>(0.6, 0.6, 0.7), smoothstep(aa, 0.0, dBPMLabel)); }

  // Pan Label
  let dPanLabel = drawText(p - vec2<f32>(sliderRightX, sliderY - sliderH * 0.6), vec2<f32>(0.03, 0.008));
  if (dPanLabel < 0.0) { color = mix(color, vec3<f32>(0.6, 0.6, 0.7), smoothstep(aa, 0.0, dPanLabel)); }

  // Volume Label (New Position: Left of slider)
  // "VOL" box
  let dVolLabel = drawText(p - vec2<f32>(0.06, 0.415), vec2<f32>(0.02, 0.008));
  if (dVolLabel < 0.0) { color = mix(color, vec3<f32>(0.6, 0.6, 0.7), smoothstep(aa, 0.0, dVolLabel)); }

  // --- 3. SLIDERS ---

  // Volume Track (Horizontal)
  let dVolTrack = sdRoundedBox(p - volPos, volDim, 0.003);
  if (dVolTrack < 0.0) {
      color = mix(color, vec3<f32>(0.15, 0.15, 0.18), 0.8);
  }

  // Volume Handle (Horizontal Movement)
  let volNorm = clamp(bez.volume, 0.0, 1.0);
  // Full width is 0.18. Handle travel approx 0.16.
  // Left edge: 0.28 - 0.08 = 0.20. Right edge: 0.28 + 0.08 = 0.36.
  let volHandleX = volPos.x + (volNorm - 0.5) * (volDim.x * 2.0 * 0.9);
  let dVolHandle = sdCircle(p - vec2<f32>(volHandleX, volPos.y), 0.02);

  if (dVolHandle < 0.0) {
      color = mix(color, vec3<f32>(0.3, 0.8, 0.4), smoothstep(aa, -aa, dVolHandle));
  }

  // Pan Track (Vertical)
  let dPanTrack = sdRoundedBox(p - vec2<f32>(sliderRightX, sliderY), vec2<f32>(sliderW * 0.5, sliderH * 0.5), 0.003);
  if (dPanTrack < 0.0) {
      color = mix(color, vec3<f32>(0.15, 0.15, 0.18), 0.8);
  }
  let panNorm = clamp(bez.pan, -1.0, 1.0);
  let panHandleY = sliderY + panNorm * sliderH * 0.45;
  let dPanHandle = sdCircle(p - vec2<f32>(sliderRightX, panHandleY), 0.02);
  if (dPanHandle < 0.0) {
      let panColor = mix(vec3<f32>(0.8, 0.3, 0.3), vec3<f32>(0.3, 0.3, 0.8), (panNorm + 1.0) * 0.5);
      color = mix(color, panColor, smoothstep(aa, -aa, dPanHandle));
  }

  // 4. Song Position Rail
  let barY = -0.45;
  let barWidth = 0.6;
  let barCenterX = 0.1;
  let dBarRail = sdRoundedBox(p - vec2<f32>(barCenterX, barY), vec2<f32>(barWidth * 0.5, 0.03 * 0.5), 0.005);
  if (dBarRail < 0.0) {
      color = mix(color, vec3<f32>(0.2, 0.2, 0.25), 0.9);
  }

  // --- NIGHT MODE DIMMING (DISABLED for v0.40) ---
  let dim = 1.0;
  color *= dim;
  let uvFactor = 0.0; // No extra emission when not dimmed

  // --- PASS 2: EMISSIVE UI ---

  // 5. LCD Displays
  let lcdColorBase = vec3<f32>(0.3, 0.8, 1.0);
  let lcdColor = lcdColorBase + (lcdColorBase * uvFactor);

  let bpmValue = u32(bez.bpm);
  let dBPM = drawNumber(p - vec2<f32>(0.0, displayY), bpmValue, 3u, 0.012, 0.015);
  if (dBPM < 0.0) {
      let mask = smoothstep(aa, 0.0, dBPM);
      color = mix(color, lcdColor, mask);
      color += lcdColor * 0.5 * mask;
  }

  let posY = displayY - 0.04;
  let lcdColorPos = vec3<f32>(1.0, 0.7, 0.2);
  let lcdColorPosBright = lcdColorPos + (lcdColorPos * uvFactor);

  let dOrder = drawNumber(p - vec2<f32>(-0.10, posY), bez.currentOrder, 2u, 0.01, 0.012);
  if (dOrder < 0.0) {
      let mask = smoothstep(aa, 0.0, dOrder);
      color = mix(color, lcdColorPosBright, mask);
      color += lcdColorPosBright * 0.4 * mask;
  }
  let dRow = drawNumber(p - vec2<f32>(0.10, posY), bez.currentRow, 2u, 0.01, 0.012);
  if (dRow < 0.0) {
      let mask = smoothstep(aa, 0.0, dRow);
      color = mix(color, lcdColorPosBright, mask);
      color += lcdColorPosBright * 0.4 * mask;
  }

  // 6. BUTTONS (WHITE SQUARE + PURPLE GLOW)
  let purpleGlow = vec3<f32>(0.7, 0.2, 1.0);
  let btnSize = vec2<f32>(0.09, 0.09);
  let iconRadius = 0.045;

  // LOOP - Moved inward from -0.34 to -0.24
  let posLoop = vec2<f32>(-0.24, 0.42);
  let isLooping = bez.isLooping == 1u;
  let isLoopClicked = bez.clickedButton == 1u;
  let loopActive = isLooping || isLoopClicked;

  let loopBtn = drawWhiteButton(p - posLoop, btnSize, purpleGlow, loopActive, aa);
  color = mix(color, loopBtn.rgb, loopBtn.a);

  let dIconOuter = sdCircle(p - posLoop, iconRadius * 0.4);
  let dIconInner = sdCircle(p - posLoop, iconRadius * 0.25);
  let ring = max(dIconOuter, -dIconInner);
  let ringMask = smoothstep(aa, 0.0, -ring);
  color = mix(color, vec3<f32>(0.1), ringMask * 0.6);

  // OPEN - Moved inward from 0.34 to 0.24
  let posOpen = vec2<f32>(0.24, 0.42);
  let isOpenClicked = bez.clickedButton == 2u;
  let openBtn = drawWhiteButton(p - posOpen, btnSize, purpleGlow, isOpenClicked, aa);
  color = mix(color, openBtn.rgb, openBtn.a);

  let iconOff = p - posOpen;
  let tri = sdTriangle((iconOff - vec2<f32>(0.0, -0.01)) * 1.8, iconRadius * 0.3);
  let stem = sdBox(iconOff - vec2<f32>(0.0, 0.015), vec2<f32>(0.006, 0.015));
  let arrow = min(tri, stem);
  let openIconMask = smoothstep(aa, 0.0, -arrow);
  color = mix(color, vec3<f32>(0.1), openIconMask * 0.6);

  // PLAY - Moved down from -0.425 to -0.45
  let posPlay = vec2<f32>(-0.44, -0.45);
  let isPlaying = bez.dimFactor < 0.5;
  let isPlayClicked = bez.clickedButton == 3u;
  let playActive = isPlaying || isPlayClicked;

  let playBtn = drawWhiteButton(p - posPlay, btnSize, purpleGlow, playActive, aa);
  color = mix(color, playBtn.rgb, playBtn.a);

  let dPlayIcon = sdTriangle((p - posPlay) * vec2<f32>(1.0, -1.0) * 1.5, iconRadius * 0.4);
  let playIconMask = smoothstep(aa, 0.0, -dPlayIcon);
  color = mix(color, vec3<f32>(0.1), playIconMask * 0.6);

  // STOP - Moved down from -0.425 to -0.45
  let posStop = vec2<f32>(-0.35, -0.45);
  let isStopClicked = bez.clickedButton == 4u;
  let stopActive = !isPlaying || isStopClicked;

  let stopBtn = drawWhiteButton(p - posStop, btnSize, purpleGlow, stopActive, aa);
  color = mix(color, stopBtn.rgb, stopBtn.a);

  let dStopIcon = sdBox(p - posStop, vec2<f32>(iconRadius * 0.35));
  let stopIconMask = smoothstep(aa, 0.0, -dStopIcon);
  color = mix(color, vec3<f32>(0.1), stopIconMask * 0.6);

  return vec4<f32>(color, 1.0);
}
