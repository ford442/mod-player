// chassis_frosted.wgsl
// Procedural Hardware Case with "Full Frosted" Crystal Buttons
// Replaces sampled background with high-quality procedural materials.

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
  dimFactor: f32,
  isPlaying: f32,
  volume: f32,
  pan: f32,
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

// --- UTILITIES ---

fn hash2(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i + vec2<f32>(0.0, 0.0)), hash2(i + vec2<f32>(1.0, 0.0)), u.x),
               mix(hash2(i + vec2<f32>(0.0, 1.0)), hash2(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}

// 2D SDFs
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
    if (p2.x + k * p2.y > 0.0) { p2 = vec2<f32>(p2.x - k * p2.y, -k * p2.x - p2.y) / 2.0; }
    p2.x = p2.x - clamp(p2.x, -2.0 * r, 0.0);
    return -length(p2) * sign(p2.y);
}

fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

// --- TEXT/UI RENDERING ---

fn drawDigit(p: vec2<f32>, digit: u32, size: f32) -> f32 {
    let segW = size * 0.15;
    let segL = size * 0.45;
    let gap = size * 0.05;
    var segments = array<u32, 10>(0x77u, 0x24u, 0x5du, 0x6du, 0x2eu, 0x6bu, 0x7bu, 0x25u, 0x7fu, 0x6fu);
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

// --- MATERIALS ---

fn getChassisMaterial(uv: vec2<f32>) -> vec3<f32> {
    let baseCol = vec3<f32>(0.92, 0.92, 0.93);
    let grain = noise(uv * 1200.0) * 0.04;
    let subtleDirt = noise(uv * 8.0) * 0.02;
    return baseCol - vec3<f32>(grain + subtleDirt);
}

fn drawFrostedButton(p: vec2<f32>, size: vec2<f32>, ledColor: vec3<f32>, isOn: bool, aa: f32) -> vec4<f32> {
    let halfSize = size * 0.5;
    let cornerRadius = 0.01;
    let d = sdRoundedBox(p, halfSize, cornerRadius);

    let alpha = 1.0 - smoothstep(0.0, aa, d);
    if (alpha <= 0.0) { return vec4<f32>(0.0); }

    var col = vec3<f32>(0.85, 0.88, 0.92); 
    let frostGrain = hash2(p * 500.0) * 0.06;
    col -= vec3<f32>(frostGrain);

    let bevelW = 0.015;
    let height = smoothstep(0.0, bevelW, -d);
    let rim = smoothstep(bevelW, 0.0, -d) * 0.5;
    col += vec3<f32>(rim);

    if (isOn) {
        let coreGlow = exp(-length(p) * 6.0) * 1.8;
        let volumeFill = smoothstep(0.0, 1.0, height) * 0.6;
        col = mix(col, ledColor, 0.3 * volumeFill);
        col += ledColor * coreGlow * 0.8;
    } else {
        col *= 0.75;
        col -= vec3<f32>(0.15) * (1.0 - height);
    }

    return vec4<f32>(col, alpha);
}

// --- MAIN STAGE ---

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

    var color = getChassisMaterial(uv);

    let recessBox = sdRoundedBox(p - vec2<f32>(0.0, 0.42), vec2<f32>(0.35, 0.08), 0.02);
    let recessMask = smoothstep(aa, -aa, recessBox);
    let shadow = smoothstep(0.05, 0.0, recessBox);
    
    let colRecess = vec3<f32>(0.05, 0.05, 0.06);
    color = mix(color, colRecess, recessMask);
    color *= 1.0 - (shadow * 0.3 * (1.0 - recessMask));

    let displayY = 0.45;
    let sliderRightX = 0.42;
    let sliderY = -0.2;
    let sliderH = 0.2;
    let sliderW = 0.015;
    let volPos = vec2<f32>(0.08, 0.415);
    let volDim = vec2<f32>(0.09, 0.006);

    let dTempoLabel = drawText(p - vec2<f32>(-0.07, displayY), vec2<f32>(0.03, 0.008));
    if (dTempoLabel < 0.0) { color = mix(color, vec3<f32>(0.6), smoothstep(aa, 0.0, dTempoLabel)); }

    let dBPMLabel = drawText(p - vec2<f32>(0.07, displayY), vec2<f32>(0.015, 0.008));
    if (dBPMLabel < 0.0) { color = mix(color, vec3<f32>(0.6), smoothstep(aa, 0.0, dBPMLabel)); }

    let dPanLabel = drawText(p - vec2<f32>(sliderRightX, sliderY - sliderH * 0.6), vec2<f32>(0.03, 0.008));
    if (dPanLabel < 0.0) { color = mix(color, vec3<f32>(0.6), smoothstep(aa, 0.0, dPanLabel)); }

    let dVolLabel = drawText(p - vec2<f32>(0.06, 0.415), vec2<f32>(0.02, 0.008));
    if (dVolLabel < 0.0) { color = mix(color, vec3<f32>(0.6), smoothstep(aa, 0.0, dVolLabel)); }

    let sliderBg = vec3<f32>(0.15, 0.15, 0.18);
    let dVolTrack = sdRoundedBox(p - volPos, volDim, 0.003);
    if (dVolTrack < 0.0) { color = sliderBg; }
    
    let volNorm = clamp(bez.volume, 0.0, 1.0);
    let volHandleX = volPos.x + (volNorm - 0.5) * (volDim.x * 2.0 * 0.9);
    let dVolHandle = sdCircle(p - vec2<f32>(volHandleX, volPos.y), 0.02);
    if (dVolHandle < 0.0) {
        color = mix(color, vec3<f32>(0.3, 0.8, 0.4), smoothstep(aa, -aa, dVolHandle)); 
    }

    let dPanTrack = sdRoundedBox(p - vec2<f32>(sliderRightX, sliderY), vec2<f32>(sliderW * 0.5, sliderH * 0.5), 0.003);
    if (dPanTrack < 0.0) { color = sliderBg; }
    
    let panNorm = clamp(bez.pan, -1.0, 1.0);
    let panHandleY = sliderY + panNorm * sliderH * 0.45;
    let dPanHandle = sdCircle(p - vec2<f32>(sliderRightX, panHandleY), 0.02);
    if (dPanHandle < 0.0) {
        let panColor = mix(vec3<f32>(0.8, 0.3, 0.3), vec3<f32>(0.3, 0.3, 0.8), (panNorm + 1.0) * 0.5);
        color = mix(color, panColor, smoothstep(aa, -aa, dPanHandle));
    }

    let barY = -0.45;
    let barWidth = 0.6;
    let barCenterX = 0.1;
    let dBarRail = sdRoundedBox(p - vec2<f32>(barCenterX, barY), vec2<f32>(barWidth * 0.5, 0.015), 0.005);
    if (dBarRail < 0.0) { color = mix(color, vec3<f32>(0.2, 0.2, 0.25), 0.9); }

    let dim = max(0.2, bez.dimFactor);
    color *= dim;
    let uvFactor = (1.0 - dim) * 1.5;

    let lcdColorBase = vec3<f32>(0.3, 0.8, 1.0); 
    let lcdColor = lcdColorBase + (lcdColorBase * uvFactor);

    let bpmValue = u32(bez.bpm);
    let dBPM = drawNumber(p - vec2<f32>(0.0, displayY), bpmValue, 3u, 0.012, 0.015);
    if (dBPM < 0.0) {
        let mask = smoothstep(aa, 0.0, dBPM);
        color = mix(color, lcdColor, mask);
        color += lcdColor * 0.6 * mask;
    }

    let posY = displayY - 0.04;
    let lcdColorPos = vec3<f32>(1.0, 0.7, 0.2); 
    let lcdColorPosBright = lcdColorPos + (lcdColorPos * uvFactor);

    let dOrder = drawNumber(p - vec2<f32>(-0.10, posY), bez.currentOrder, 2u, 0.01, 0.012);
    if (dOrder < 0.0) {
        let mask = smoothstep(aa, 0.0, dOrder);
        color = mix(color, lcdColorPosBright, mask);
    }
    let dRow = drawNumber(p - vec2<f32>(0.10, posY), bez.currentRow, 2u, 0.01, 0.012);
    if (dRow < 0.0) {
        let mask = smoothstep(aa, 0.0, dRow);
        color = mix(color, lcdColorPosBright, mask);
    }

    let btnSize = vec2<f32>(0.09, 0.09);
    let iconRadius = 0.045;
    
    let ledPurple = vec3<f32>(0.7, 0.2, 1.0);
    let ledAmber = vec3<f32>(1.0, 0.6, 0.1);
    let ledGreen = vec3<f32>(0.2, 1.0, 0.4);
    let ledRed = vec3<f32>(1.0, 0.2, 0.2);

    let posLoop = vec2<f32>(-0.24, 0.42);
    let loopActive = (bez.isLooping == 1u) || (bez.clickedButton == 1u);
    let loopBtn = drawFrostedButton(p - posLoop, btnSize, ledPurple, loopActive, aa);
    color = mix(color, loopBtn.rgb, loopBtn.a);

    let dIconOuter = sdCircle(p - posLoop, iconRadius * 0.4);
    let dIconInner = sdCircle(p - posLoop, iconRadius * 0.25);
    let ring = max(dIconOuter, -dIconInner);
    let ringMask = smoothstep(aa, 0.0, -ring);
    color = mix(color, vec3<f32>(0.2), ringMask * 0.7 * loopBtn.a);

    let posOpen = vec2<f32>(0.24, 0.42);
    let openActive = (bez.clickedButton == 2u);
    let openBtn = drawFrostedButton(p - posOpen, btnSize, ledAmber, openActive, aa);
    color = mix(color, openBtn.rgb, openBtn.a);

    let iconOff = p - posOpen;
    let tri = sdTriangle((iconOff - vec2<f32>(0.0, -0.01)) * 1.8, iconRadius * 0.3);
    let stem = sdBox(iconOff - vec2<f32>(0.0, 0.015), vec2<f32>(0.006, 0.015));
    let arrow = min(tri, stem);
    let openIconMask = smoothstep(aa, 0.0, -arrow);
    color = mix(color, vec3<f32>(0.2), openIconMask * 0.7 * openBtn.a);

    let posPlay = vec2<f32>(-0.44, -0.45);
    let playActive = (bez.isPlaying > 0.5) || (bez.clickedButton == 3u);
    let playBtn = drawFrostedButton(p - posPlay, btnSize, ledGreen, playActive, aa);
    color = mix(color, playBtn.rgb, playBtn.a);

    let dPlayIcon = sdTriangle((p - posPlay) * vec2<f32>(1.0, -1.0) * 1.5, iconRadius * 0.4);
    let playIconMask = smoothstep(aa, 0.0, -dPlayIcon);
    color = mix(color, vec3<f32>(0.2), playIconMask * 0.7 * playBtn.a);

    let posStop = vec2<f32>(-0.35, -0.45);
    let stopActive = (bez.isPlaying < 0.5) || (bez.clickedButton == 4u);
    let stopBtn = drawFrostedButton(p - posStop, btnSize, ledRed, stopActive, aa);
    color = mix(color, stopBtn.rgb, stopBtn.a);

    let dStopIcon = sdBox(p - posStop, vec2<f32>(iconRadius * 0.35));
    let stopIconMask = smoothstep(aa, 0.0, -dStopIcon);
    color = mix(color, vec3<f32>(0.2), stopIconMask * 0.7 * stopBtn.a);

    return vec4<f32>(color, 1.0);
}
