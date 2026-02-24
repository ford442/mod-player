// chassis_frosted.wgsl
// High-Fidelity "Polar White" Case with Frosted Crystal Buttons
// - Dark mode disabled (Always bright)
// - Added OPEN (Folder) button
// - Refined Play/Stop/Prev/Next layout

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
  clickedButton: u32, // 0=none, 1=loop, 2=open, 3=play, 4=stop, 5=prev, 6=next
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
    // Force bright "Polar White" - ignore dimFactor for base chassis
    let baseCol = vec3<f32>(0.94, 0.95, 0.96); 
    let grain = noise(uv * 1500.0) * 0.03;
    let sheen = noise(uv * 4.0) * 0.02;
    return baseCol - vec3<f32>(grain + sheen);
} 

fn drawFrostedButton(p: vec2<f32>, size: vec2<f32>, ledColor: vec3<f32>, isOn: bool, aa: f32) -> vec4<f32> {
    let halfSize = size * 0.5;
    let cornerRadius = 0.015;
    let d = sdRoundedBox(p, halfSize, cornerRadius);

    let alpha = 1.0 - smoothstep(0.0, aa, d);
    if (alpha <= 0.0) { return vec4<f32>(0.0); }

    // Glassy Base
    var col = vec3<f32>(0.88, 0.90, 0.95); 
    let frostGrain = hash2(p * 600.0) * 0.05;
    col -= vec3<f32>(frostGrain);

    // Bevel & Height
    let bevelW = 0.012;
    let height = smoothstep(0.0, bevelW, -d);
    
    // Rim Light (Fake Caustic Edge)
    let rim = smoothstep(bevelW * 0.5, 0.0, -d) * 0.7;
    col += vec3<f32>(rim);

    // Illumination
    if (isOn) {
        // Strong internal glow
        let coreGlow = exp(-length(p) * 6.0) * 1.5;
        let volume = smoothstep(0.0, 1.0, height);
        // Mix LED color into the glass volume
        col = mix(col, ledColor, 0.5 * volume);
        // Additive core bloom
        col += ledColor * coreGlow * 0.8;
    } else {
        // When off, it's just dull glass
        col *= 0.8;
        col -= vec3<f32>(0.1) * (1.0 - height);
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
    let aa = 1.5 / bez.canvasH; 

    var color = getChassisMaterial(uv);

    // Recess Area (Slightly larger to accommodate new buttons)
    // Recess for Display
    let recessBox = sdRoundedBox(p - vec2<f32>(0.0, 0.40), vec2<f32>(0.36, 0.12), 0.02);
    let recessMask = smoothstep(aa, -aa, recessBox);
    let shadow = smoothstep(0.06, 0.0, recessBox);
    
    // Recess color (dark grey, not black)
    let colRecess = vec3<f32>(0.12, 0.13, 0.15);
    color = mix(color, colRecess, recessMask);
    color *= 1.0 - (shadow * 0.35 * (1.0 - recessMask)); 

    // 2. Sliders & Labels
    let displayY = 0.45;
    let sliderRightX = 0.42;
    let sliderY = -0.2;
    let volPos = vec2<f32>(0.08, 0.415);
    let volDim = vec2<f32>(0.09, 0.006);

    // Sliders Background
    let dVolTrack = sdRoundedBox(p - volPos, volDim, 0.003);
    if (dVolTrack < 0.0) { color = vec3<f32>(0.2); }
    
    // Volume Knob
    let volNorm = clamp(bez.volume, 0.0, 1.0);
    let volHandleX = volPos.x + (volNorm - 0.5) * (volDim.x * 2.0 * 0.9);
    let dVolHandle = sdCircle(p - vec2<f32>(volHandleX, volPos.y), 0.02);
    if (dVolHandle < 0.0) { color = mix(color, vec3<f32>(0.3, 0.9, 0.5), smoothstep(aa, -aa, dVolHandle)); }

    // Pan Track
    let dPanTrack = sdRoundedBox(p - vec2<f32>(sliderRightX, sliderY), vec2<f32>(0.008, 0.1), 0.003);
    if (dPanTrack < 0.0) { color = vec3<f32>(0.2); }
    
    // Pan Knob
    let panNorm = clamp(bez.pan, -1.0, 1.0);
    let panHandleY = sliderY + panNorm * 0.09;
    let dPanHandle = sdCircle(p - vec2<f32>(sliderRightX, panHandleY), 0.02);
    if (dPanHandle < 0.0) { color = mix(color, vec3<f32>(0.4, 0.6, 1.0), smoothstep(aa, -aa, dPanHandle)); }

    // 3. LCD Text
    // Always illuminated, slight glow
    let lcdColor = vec3<f32>(0.4, 0.9, 1.0); 
    let bpmValue = u32(bez.bpm);
    let dBPM = drawNumber(p - vec2<f32>(0.0, displayY), bpmValue, 3u, 0.012, 0.015);
    if (dBPM < 0.0) { color = mix(color, lcdColor, smoothstep(aa, 0.0, dBPM)); }

    let posY = displayY - 0.04;
    let lcdAmber = vec3<f32>(1.0, 0.7, 0.2);
    
    // Only draw current row/order if valid
    let dRow = drawNumber(p - vec2<f32>(0.10, posY), bez.currentRow, 2u, 0.01, 0.012);
    if (dRow < 0.0) { color = mix(color, lcdAmber, smoothstep(aa, 0.0, dRow)); }
    
    let dOrd = drawNumber(p - vec2<f32>(-0.10, posY), bez.currentOrder, 2u, 0.01, 0.012);
    if (dOrd < 0.0) { color = mix(color, lcdAmber, smoothstep(aa, 0.0, dOrd)); }

    // --- BUTTONS ---
    let btnSize = vec2<f32>(0.09, 0.09);
    let smBtnSize = vec2<f32>(0.07, 0.06);
    let iconCol = vec3<f32>(0.15); // Dark grey icons

    // LED Colors
    let ledPurple = vec3<f32>(0.8, 0.4, 1.0);
    let ledAmber = vec3<f32>(1.0, 0.6, 0.1);
    let ledGreen = vec3<f32>(0.2, 1.0, 0.4);
    let ledRed = vec3<f32>(1.0, 0.2, 0.3);
    let ledBlue = vec3<f32>(0.3, 0.6, 1.0);

    // LOOP (Top Left)
    let pLoop = p - vec2<f32>(-0.26, 0.42);
    let loopOn = (bez.isLooping == 1u) || (bez.clickedButton == 1u);
    let btnLoop = drawFrostedButton(pLoop, btnSize, ledPurple, loopOn, aa);
    color = mix(color, btnLoop.rgb, btnLoop.a);
    // Icon: Circle Arrow
    let dIconLoop = abs(length(pLoop) - 0.018) - 0.004;
    color = mix(color, iconCol, smoothstep(aa, 0.0, -dIconLoop) * btnLoop.a);

    // OPEN (Top Right) -> NEW!
    let pOpen = p - vec2<f32>(0.26, 0.42);
    let openOn = (bez.clickedButton == 2u);
    let btnOpen = drawFrostedButton(pOpen, btnSize, ledAmber, openOn, aa);
    color = mix(color, btnOpen.rgb, btnOpen.a);
    // Icon: Folder shape
    let folderBody = sdBox(pOpen - vec2<f32>(0.0, -0.005), vec2<f32>(0.02, 0.014));
    let folderTab = sdBox(pOpen - vec2<f32>(-0.01, 0.015), vec2<f32>(0.008, 0.004));
    let folder = min(folderBody, folderTab);
    color = mix(color, iconCol, smoothstep(aa, 0.0, -folder) * btnOpen.a);

    // PREV / NEXT (Below Display)
    let pPrev = p - vec2<f32>(-0.12, 0.32);
    let prevOn = (bez.clickedButton == 5u);
    let btnPrev = drawFrostedButton(pPrev, smBtnSize, ledBlue, prevOn, aa);
    color = mix(color, btnPrev.rgb, btnPrev.a);
    let iconPrev = sdTriangle((pPrev) * vec2<f32>(-1.0, 1.0) * 3.5, 0.01);
    color = mix(color, iconCol, smoothstep(aa, 0.0, -iconPrev) * btnPrev.a);

    let pNext = p - vec2<f32>(0.12, 0.32);
    let nextOn = (bez.clickedButton == 6u);
    let btnNext = drawFrostedButton(pNext, smBtnSize, ledBlue, nextOn, aa);
    color = mix(color, btnNext.rgb, btnNext.a);
    let iconNext = sdTriangle((pNext) * vec2<f32>(1.0, 1.0) * 3.5, 0.01);
    color = mix(color, iconCol, smoothstep(aa, 0.0, -iconNext) * btnNext.a);

    // PLAY (Bottom Left)
    let pPlay = p - vec2<f32>(-0.44, -0.45);
    let playOn = (bez.isPlaying > 0.5) || (bez.clickedButton == 3u);
    let btnPlay = drawFrostedButton(pPlay, btnSize, ledGreen, playOn, aa);
    color = mix(color, btnPlay.rgb, btnPlay.a);
    let iconPlay = sdTriangle((pPlay) * vec2<f32>(1.0, -1.0) * 1.5, 0.02);
    color = mix(color, iconCol, smoothstep(aa, 0.0, -iconPlay) * btnPlay.a);

    // STOP (Bottom Center-Left)
    let pStop = p - vec2<f32>(-0.34, -0.45);
    let stopOn = (bez.isPlaying < 0.5) || (bez.clickedButton == 4u);
    let btnStop = drawFrostedButton(pStop, btnSize, ledRed, stopOn, aa);
    color = mix(color, btnStop.rgb, btnStop.a);
    let iconStop = sdBox(pStop, vec2<f32>(0.015));
    color = mix(color, iconCol, smoothstep(aa, 0.0, -iconStop) * btnStop.a);

    // NO Global Dimming applied to final color 
    // We keep it bright as requested.

    return vec4<f32>(color, 1.0);
}
