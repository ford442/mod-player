// chassis_frosted.wgsl
// Frosted glass hardware chassis with modern UI controls
// Simplified frosted background for pattern shaders

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
  clickedButton: u32,
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

fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

// Frosted glass effect
fn frostedGlass(uv: vec2<f32>, intensity: f32) -> vec3<f32> {
    let noise = hash(uv * 200.0) * 0.1;
    let baseColor = vec3<f32>(0.92, 0.93, 0.95);
    return baseColor * (1.0 - noise * intensity);
}

// Subtle brushed metal texture
fn brushedMetal(uv: vec2<f32>) -> vec3<f32> {
    let grain = hash(uv * vec2<f32>(800.0, 50.0)) * 0.04;
    let base = vec3<f32>(0.88, 0.89, 0.91);
    return base - vec3<f32>(grain);
}

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

// White Square Button Style with frosted look
fn drawFrostedButton(uv: vec2<f32>, size: vec2<f32>, glowColor: vec3<f32>, isOn: bool, aa: f32) -> vec4<f32> {
  let halfSize = size * 0.5;
  let d = sdRoundedBox(uv, halfSize, 0.02);

  // Frosted glass base
  var col = frostedGlass(uv * 5.0, 0.5);
  
  // Add subtle gradient
  col *= 0.95 + 0.05 * sin(uv.y * 20.0);

  var alpha = 0.0;
  let bodyMask = 1.0 - smoothstep(0.0, aa, d);
  
  if (isOn) {
      col = mix(col, vec3<f32>(1.0, 1.0, 1.0), 0.3);
      col = mix(col, glowColor, 0.15);
  } else {
      col = col * 0.9;
  }

  if (bodyMask > 0.0) { alpha = 0.95; }

  if (isOn) {
      let glowDist = max(0.0, d);
      let glow = exp(-glowDist * 15.0) * glowColor * 1.2;
      if (d > 0.0) {
        col = glow;
        alpha = smoothstep(0.0, 0.3, length(glow));
      } else {
        col += glow * 0.3;
      }
  }

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
  
  // Base brushed metal background
  var color = brushedMetal(uv * vec2<f32>(1.0, 2.0));
  
  // Apply dim factor for night mode
  let dim = max(0.15, bez.dimFactor);
  color *= dim;

  // Checkered texture overlay for retro feel
  let checkSize = 0.02;
  let check = step(checkSize * 0.5, fract(p.x / checkSize)) == step(checkSize * 0.5, fract(p.y / checkSize));
  color = mix(color, color * 0.97, 0.3 * f32(check));

  // --- DISPLAY RECESS (square cutout for pattern display) ---
  let recessCenter = vec2<f32>(0.05, 0.05);
  let recessSize = vec2<f32>(0.38, 0.38);
  let dRecess = sdRoundedBox(p - recessCenter, recessSize, 0.02);
  
  // Dark recessed area behind the display
  if (dRecess < 0.0) {
      color = mix(color, vec3<f32>(0.02, 0.02, 0.03), 0.9);
  }
  
  // Recess border highlight
  let recessBorder = smoothstep(0.0, aa * 2.0, abs(dRecess));
  if (dRecess > 0.0 && dRecess < 0.015) {
      color = mix(color, vec3<f32>(0.6, 0.6, 0.65), 0.3);
  }

  // --- CONTROLS ---
  
  // Volume and pan are handled by the pattern shader overlay
  // We just provide the chassis background

  // --- NIGHT MODE DIMMING ---
  let uvFactor = (1.0 - dim) * 1.5;

  // --- EMISSIVE UI ELEMENTS ---
  
  // LED indicators (small status lights)
  let ledColorBase = vec3<f32>(0.0, 0.8, 0.4);
  let ledColor = ledColorBase + (ledColorBase * uvFactor);
  
  // Play indicator LED
  let playLedPos = vec2<f32>(-0.48, 0.48);
  let dPlayLed = sdCircle(p - playLedPos, 0.012);
  if (dPlayLed < 0.0) {
      let isPlaying = bez.isPlaying > 0.5;
      let ledGlow = exp(-length(p - playLedPos) * 30.0);
      if (isPlaying) {
          color = mix(color, ledColor, smoothstep(aa, -aa, dPlayLed));
          color += ledColor * ledGlow * 2.0;
      } else {
          color = mix(color, vec3<f32>(0.2, 0.2, 0.2), smoothstep(aa, -aa, dPlayLed));
      }
  }

  // Loop indicator LED
  let loopLedPos = vec2<f32>(-0.45, 0.48);
  let dLoopLed = sdCircle(p - loopLedPos, 0.012);
  if (dLoopLed < 0.0) {
      let isLooping = bez.isLooping == 1u;
      let loopColor = vec3<f32>(0.8, 0.4, 0.0);
      let loopLedColor = loopColor + (loopColor * uvFactor);
      if (isLooping) {
          let ledGlow = exp(-length(p - loopLedPos) * 30.0);
          color = mix(color, loopLedColor, smoothstep(aa, -aa, dLoopLed));
          color += loopLedColor * ledGlow * 2.0;
      } else {
          color = mix(color, vec3<f32>(0.2, 0.2, 0.2), smoothstep(aa, -aa, dLoopLed));
      }
  }

  // BPM display (small digital readout)
  let bpmDisplayPos = vec2<f32>(0.42, 0.45);
  let bpmValue = u32(bez.bpm);
  let dBPM = drawNumber(p - bpmDisplayPos, bpmValue, 3u, 0.008, 0.012);
  if (dBPM < 0.0) {
      let bpmColor = vec3<f32>(0.3, 0.85, 1.0) + (vec3<f32>(0.3, 0.85, 1.0) * uvFactor);
      let mask = smoothstep(aa, 0.0, dBPM);
      color = mix(color, bpmColor, mask);
  }

  // Position display
  let posDisplayPos = vec2<f32>(0.42, 0.40);
  let orderValue = bez.currentOrder;
  let rowValue = bez.currentRow;
  let dOrder = drawNumber(p - posDisplayPos, orderValue, 2u, 0.006, 0.008);
  let dRow = drawNumber(p - (posDisplayPos + vec2<f32>(0.03, 0.0)), rowValue, 2u, 0.006, 0.008);
  
  let posColor = vec3<f32>(1.0, 0.7, 0.2) + (vec3<f32>(1.0, 0.7, 0.2) * uvFactor);
  if (dOrder < 0.0) {
      color = mix(color, posColor, smoothstep(aa, 0.0, dOrder) * 0.8);
  }
  if (dRow < 0.0) {
      color = mix(color, posColor, smoothstep(aa, 0.0, dRow) * 0.8);
  }

  // --- CORNER SCREWS (mechanical aesthetic) ---
  let screwRadius = 0.015;
  let screwInset = 0.46;
  let screws = array<vec2<f32>, 4>(
      vec2<f32>(-screwInset, -screwInset),
      vec2<f32>(screwInset, -screwInset),
      vec2<f32>(-screwInset, screwInset),
      vec2<f32>(screwInset, screwInset)
  );
  
  for (var i = 0u; i < 4u; i = i + 1u) {
      let dScrew = sdCircle(p - screws[i], screwRadius);
      if (dScrew < 0.02) {
          // Screw head
          let screwColor = vec3<f32>(0.75, 0.75, 0.78);
          let screwShadow = vec3<f32>(0.4, 0.4, 0.42);
          let sd = smoothstep(0.0, aa, dScrew);
          color = mix(screwColor, screwShadow, sd * 0.5);
          
          // Screw slot
          let slotW = screwRadius * 1.2;
          let slotH = screwRadius * 0.15;
          let dSlot = sdBox(p - screws[i], vec2<f32>(slotW, slotH));
          if (dSlot < 0.0) {
              color = vec3<f32>(0.2, 0.2, 0.22);
          }
      }
  }

  // --- BEZEL EDGE HIGHLIGHT ---
  let edgeDist = max(abs(p.x), abs(p.y));
  if (edgeDist > 0.48 && edgeDist < 0.495) {
      let edgeAlpha = smoothstep(0.495, 0.48, edgeDist);
      color = mix(color, vec3<f32>(0.95, 0.95, 0.97), edgeAlpha * 0.3);
  }

  return vec4<f32>(color, 1.0);
}
