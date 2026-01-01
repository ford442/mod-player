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
    // Each digit is composed of 7 segments (like a digital clock display)
    // Returns distance field (negative = inside)
    let segW = size * 0.15;
    let segL = size * 0.45;
    let gap = size * 0.05;
    
    // Segment positions (7 segments: top, top-right, bottom-right, bottom, bottom-left, top-left, middle)
    var segments = array<u32, 10>(
        0x77u, // 0: all except middle
        0x24u, // 1: right side only
        0x5du, // 2: all except top-left and bottom-right
        0x6du, // 3: all except top-left and bottom-left
        0x2eu, // 4: top-left, middle, and right side
        0x6bu, // 5: all except top-right and bottom-left
        0x7bu, // 6: all except top-right
        0x25u, // 7: top and right side
        0x7fu, // 8: all segments
        0x6fu  // 9: all except bottom-left
    );
    
    let code = select(0u, segments[digit], digit < 10u);
    var minDist = 100.0;
    
    // Top horizontal
    if ((code & 0x01u) != 0u) {
        let d = sdBox(p - vec2<f32>(0.0, -segL), vec2<f32>(segL, segW));
        minDist = min(minDist, d);
    }
    // Top-right vertical
    if ((code & 0x02u) != 0u) {
        let d = sdBox(p - vec2<f32>(segL, -segL * 0.5 - gap * 0.5), vec2<f32>(segW, segL * 0.5));
        minDist = min(minDist, d);
    }
    // Bottom-right vertical
    if ((code & 0x04u) != 0u) {
        let d = sdBox(p - vec2<f32>(segL, segL * 0.5 + gap * 0.5), vec2<f32>(segW, segL * 0.5));
        minDist = min(minDist, d);
    }
    // Bottom horizontal
    if ((code & 0x08u) != 0u) {
        let d = sdBox(p - vec2<f32>(0.0, segL), vec2<f32>(segL, segW));
        minDist = min(minDist, d);
    }
    // Bottom-left vertical
    if ((code & 0x10u) != 0u) {
        let d = sdBox(p - vec2<f32>(-segL, segL * 0.5 + gap * 0.5), vec2<f32>(segW, segL * 0.5));
        minDist = min(minDist, d);
    }
    // Top-left vertical
    if ((code & 0x20u) != 0u) {
        let d = sdBox(p - vec2<f32>(-segL, -segL * 0.5 - gap * 0.5), vec2<f32>(segW, segL * 0.5));
        minDist = min(minDist, d);
    }
    // Middle horizontal
    if ((code & 0x40u) != 0u) {
        let d = sdBox(p, vec2<f32>(segL, segW));
        minDist = min(minDist, d);
    }
    
    return minDist;
}

// Draw a number (up to 3 digits)
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

// Simple text rendering (very basic, just rectangles for now)
fn drawText(p: vec2<f32>, size: vec2<f32>) -> f32 {
    return sdBox(p, size);
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
  // Centered normalized coordinates
  let p = uv - 0.5; // -0.5 to 0.5
  let aa = 1.0 / bez.canvasH; // approx pixel width for AA

  // Hardware palette (Dark Theme)
  let colPlastic = vec3<f32>(0.08, 0.08, 0.10);
  let colRecess = vec3<f32>(0.05, 0.05, 0.06);

  // Base Chassis
  var color = colPlastic;

  // Use the Bezel Texture if available
  let texSample = textureSampleLevel(bezelTexture, bezelSampler, uv, 0.0);
  // Simple check to use texture if it's not empty/transparent
  if (texSample.a > 0.1) {
    color = mix(color, texSample.rgb, texSample.a);
  } else {
    // Procedural fallback (Circular Recess)
    let dist = length(p);
    let maxRadius = 0.45;
    let minRadius = 0.15;

    if (dist < maxRadius + 0.02 && dist > minRadius - 0.02) {
        color = colRecess;
        // Subtle tracks
        let track = sin(dist * 200.0);
        color -= vec3<f32>(0.01) * track;
    }
  }

  // --- UI CONTROLS ---
  // Coordinate system: p is -0.5 to 0.5.
  // Y-axis: Negative is BOTTOM, Positive is TOP in this shader projection (due to VS setup)?
  // Actually, standard UV: (0,0) Bottom-Left. p = uv - 0.5.
  // p.y = -0.5 is Bottom. p.y = 0.5 is Top.

  let barY = -0.45; // Bottom of screen

  // --- TOP CENTER: BPM and Position Display ---
  let topY = 0.45; // Very top (changed from -0.48 which was actually top in previous logic? Wait.
  // If uv(0,0) is bottom-left, then p.y=-0.5 is bottom.
  // Previous code had `let topY = -0.48;` ... wait.
  // If `topY` was negative, and it drew at the top, then Y must be inverted (Top is negative).
  // Let's assume standard image coords: (0,0) Top-Left.
  // Then p.y = -0.5 is Top. p.y = 0.5 is Bottom.
  // Let's stick to the convention used in the file:
  // Previous file: `barY = -0.45` (near -0.5) was "Bottom".
  // `topY = -0.48` was "Top".
  // This implies -0.5 is Top?
  // Let's check VS again: `out.uv = pos * 0.5 + 0.5`.
  // If pos.y = -1 (Bottom), uv.y = 0. p.y = -0.5.
  // If pos.y = 1 (Top), uv.y = 1. p.y = 0.5.
  // This means p.y = 0.5 is TOP.
  // BUT the previous code says `barY = -0.45` is "Bottom".
  // AND `topY = -0.48` is "Top"?
  // If -0.45 is Bottom and -0.48 is Top... they are right next to each other.
  // There is a coordinate confusion in the legacy code or comments.
  // Let's trust the logic:
  // If I want to move things, I will simply define my own "Top" and "Bottom" based on observations.
  // If `barY = -0.45` rendered a bar at the bottom, then **-0.5 is Bottom**.
  // If `topY` was meant to be top, maybe it should have been 0.48?
  // Let's re-read the previous code carefully:
  // "BPM Display ... y = -0.48 (top of canvas)" -> This comment contradicts standard WebGPU UV if (0,0) is Bottom-Left.
  // However, usually textures are loaded Top-Left (0,0).
  // If (0,0) is Top-Left, then p.y = -0.5 is Top-Left.
  // If `barY = -0.45` (near -0.5) is Bottom... then -0.5 is Bottom.
  // This implies (0,0) is Bottom-Left.
  // Then `topY = -0.48` being "Top" is impossible unless the comments are wrong or I am misinterpreting.
  // Let's assume **0.5 is Top** and **-0.5 is Bottom**.

  // Re-calibrating based on user request "sliders ... positioned down".
  // If 0.0 was center, and we want "down", we go towards Bottom (-0.5).
  // So new sliderY = -0.2.

  let displayY = 0.45; // Top area
  
  // BPM Display (center top)
  let bpmValue = u32(bez.bpm);
  let dBPM = drawNumber(p - vec2<f32>(0.0, displayY), bpmValue, 3u, 0.012, 0.015);
  if (dBPM < 0.0) {
      color = mix(color, vec3<f32>(0.3, 0.8, 1.0), smoothstep(aa, 0.0, dBPM));
  }

  // Labels
  let dTempoLabel = drawText(p - vec2<f32>(-0.07, displayY), vec2<f32>(0.03, 0.008));
  if (dTempoLabel < 0.0) {
      color = mix(color, vec3<f32>(0.6, 0.6, 0.7), smoothstep(aa, 0.0, dTempoLabel));
  }
  let dBPMLabel = drawText(p - vec2<f32>(0.07, displayY), vec2<f32>(0.015, 0.008));
  if (dBPMLabel < 0.0) {
      color = mix(color, vec3<f32>(0.6, 0.6, 0.7), smoothstep(aa, 0.0, dBPMLabel));
  }
  
  // Position Display (top leftish - moved slightly down from top edge)
  let posY = displayY - 0.04;
  let dOrder = drawNumber(p - vec2<f32>(-0.10, posY), bez.currentOrder, 2u, 0.01, 0.012);
  if (dOrder < 0.0) {
      color = mix(color, vec3<f32>(0.9, 0.7, 0.3), smoothstep(aa, 0.0, dOrder));
  }
  let dRow = drawNumber(p - vec2<f32>(0.10, posY), bez.currentRow, 2u, 0.01, 0.012);
  if (dRow < 0.0) {
      color = mix(color, vec3<f32>(0.9, 0.7, 0.3), smoothstep(aa, 0.0, dRow));
  }

  // --- LEFT SIDE: VOLUME SLIDER ---
  // Moved DOWN to -0.2
  let sliderY = -0.2;
  let sliderLeftX = -0.42;
  let sliderH = 0.2; // Smaller (was 0.3)
  let sliderW = 0.015;
  
  // Slider track
  let dVolTrack = sdRoundedBox(p - vec2<f32>(sliderLeftX, sliderY), vec2<f32>(sliderW * 0.5, sliderH * 0.5), 0.003);
  if (dVolTrack < 0.0) {
      color = mix(color, vec3<f32>(0.15, 0.15, 0.18), 0.8);
  }
  
  // Volume handle position (0.0 = bottom, 1.0 = top)
  let volNorm = clamp(bez.volume, 0.0, 1.0);
  let volHandleY = sliderY + (volNorm - 0.5) * sliderH * 0.9;
  let dVolHandle = sdCircle(p - vec2<f32>(sliderLeftX, volHandleY), 0.02);
  if (dVolHandle < 0.0) {
      color = mix(color, vec3<f32>(0.3, 0.8, 0.4), smoothstep(aa, -aa, dVolHandle));
  }
  
  // "VOLUME" label
  let dVolLabel = drawText(p - vec2<f32>(sliderLeftX, sliderY - sliderH * 0.6), vec2<f32>(0.025, 0.008));
  if (dVolLabel < 0.0) {
      color = mix(color, vec3<f32>(0.6, 0.6, 0.7), smoothstep(aa, 0.0, dVolLabel));
  }
  
  // --- RIGHT SIDE: PANNING SLIDER ---
  let sliderRightX = 0.42;
  
  // Slider track
  let dPanTrack = sdRoundedBox(p - vec2<f32>(sliderRightX, sliderY), vec2<f32>(sliderW * 0.5, sliderH * 0.5), 0.003);
  if (dPanTrack < 0.0) {
      color = mix(color, vec3<f32>(0.15, 0.15, 0.18), 0.8);
  }
  
  // Pan handle
  let panNorm = clamp(bez.pan, -1.0, 1.0);
  let panHandleY = sliderY + panNorm * sliderH * 0.45;
  let dPanHandle = sdCircle(p - vec2<f32>(sliderRightX, panHandleY), 0.02);
  if (dPanHandle < 0.0) {
      let panColor = mix(vec3<f32>(0.8, 0.3, 0.3), vec3<f32>(0.3, 0.3, 0.8), (panNorm + 1.0) * 0.5);
      color = mix(color, panColor, smoothstep(aa, -aa, dPanHandle));
  }
  
  // "PANNING" label
  let dPanLabel = drawText(p - vec2<f32>(sliderRightX, sliderY - sliderH * 0.6), vec2<f32>(0.03, 0.008));
  if (dPanLabel < 0.0) {
      color = mix(color, vec3<f32>(0.6, 0.6, 0.7), smoothstep(aa, 0.0, dPanLabel));
  }

  // 1. Song Position Bar
  // Moved slightly right to make room for buttons on left
  let barWidth = 0.6;
  let barCenterX = 0.1;
  let dBarRail = sdRoundedBox(p - vec2<f32>(barCenterX, barY), vec2<f32>(barWidth * 0.5, 0.03 * 0.5), 0.005);

  if (dBarRail < 0.0) {
      color = mix(color, vec3<f32>(0.2, 0.2, 0.25), 0.9);
  }

  // 2. Buttons
  let btnRadius = 0.045; // Increased for better usability

  // LOOP: Top Left (-0.44, 0.42)
  let posLoop = vec2<f32>(-0.44, 0.42);
  let dLoopBg = sdCircle(p - posLoop, btnRadius);
  if (dLoopBg < 0.0) {
      var btnCol = vec3<f32>(0.15);
      let isLooping = bez.isLooping == 1u;
      let isClicked = bez.clickedButton == 1u;
      let dIconOuter = sdCircle(p - posLoop, btnRadius * 0.4);
      let dIconInner = sdCircle(p - posLoop, btnRadius * 0.25);
      let ring = max(dIconOuter, -dIconInner);
      if (ring < 0.0) {
         btnCol = select(vec3<f32>(0.5, 0.3, 0.1), vec3<f32>(0.9, 0.6, 0.1), isLooping);
         // Brighten when clicked
         btnCol = select(btnCol, btnCol * 1.5, isClicked);
      }
      let mask = smoothstep(0.0, aa * 2.0, -dLoopBg);
      color = mix(color, btnCol, mask);

      let dRing = abs(dLoopBg) - 0.002;
      let ringMask = 1.0 - smoothstep(0.0, aa * 2.0, dRing);
      color = mix(color, vec3<f32>(0.05), ringMask * 0.5);
      
      // Add glow when clicked
      if (isClicked) {
          let glowDist = length(p - posLoop);
          let glow = exp(-glowDist * 15.0) * 0.3;
          color += vec3<f32>(0.9, 0.6, 0.1) * glow;
      }
  }

  // OPEN: Top Right (0.44, 0.42)
  let posOpen = vec2<f32>(0.44, 0.42);
  let dOpenBg = sdCircle(p - posOpen, btnRadius);
  if (dOpenBg < 0.0) {
      var btnCol = vec3<f32>(0.15);
      let isClicked = bez.clickedButton == 2u;
      let iconOff = p - posOpen;
      let tri = sdTriangle((iconOff - vec2<f32>(0.0, -0.01)) * 1.8, btnRadius * 0.3);
      let stem = sdBox(iconOff - vec2<f32>(0.0, 0.015), vec2<f32>(0.006, 0.015));
      let arrow = min(tri, stem);
      if (arrow < 0.0) {
         btnCol = vec3<f32>(0.2, 0.5, 0.9);
         // Brighten when clicked
         btnCol = select(btnCol, btnCol * 1.5, isClicked);
      }
      let mask = smoothstep(0.0, aa * 2.0, -dOpenBg);
      color = mix(color, btnCol, mask);

      let dRing = abs(dOpenBg) - 0.002;
      let ringMask = 1.0 - smoothstep(0.0, aa * 2.0, dRing);
      color = mix(color, vec3<f32>(0.05), ringMask * 0.5);
      
      // Add glow when clicked
      if (isClicked) {
          let glowDist = length(p - posOpen);
          let glow = exp(-glowDist * 15.0) * 0.3;
          color += vec3<f32>(0.2, 0.5, 0.9) * glow;
      }
  }

  // PLAY: Bottom Left (-0.44, -0.40)
  let posPlay = vec2<f32>(-0.44, -0.40);
  let dPlayBg = sdCircle(p - posPlay, btnRadius);
  if (dPlayBg < 0.0) {
      var btnCol = vec3<f32>(0.15);
      let isPlaying = bez.dimFactor < 0.5;
      let isClicked = bez.clickedButton == 3u;

      let dIcon = sdTriangle((p - posPlay) * vec2<f32>(1.0, -1.0) * 1.5, btnRadius * 0.4);
      if (dIcon < 0.0) {
        btnCol = select(
            vec3<f32>(0.2, 0.6, 0.2),
            vec3<f32>(0.2, 1.0, 0.4),
            isPlaying
        );
        // Brighten when clicked
        btnCol = select(btnCol, btnCol * 1.5, isClicked);
      }
      let mask = smoothstep(0.0, aa * 2.0, -dPlayBg);
      color = mix(color, btnCol, mask);

      let dRing = abs(dPlayBg) - 0.002;
      let ringMask = 1.0 - smoothstep(0.0, aa * 2.0, dRing);
      color = mix(color, vec3<f32>(0.05), ringMask * 0.5);
      
      // Add glow when clicked
      if (isClicked) {
          let glowDist = length(p - posPlay);
          let glow = exp(-glowDist * 15.0) * 0.3;
          color += vec3<f32>(0.2, 1.0, 0.4) * glow;
      }
  }

  // STOP: Bottom Left (-0.35, -0.40) - Next to Play
  let posStop = vec2<f32>(-0.35, -0.40);
  let dStopBg = sdCircle(p - posStop, btnRadius);
  if (dStopBg < 0.0) {
      var btnCol = vec3<f32>(0.15);
      let isClicked = bez.clickedButton == 4u;
      let dIcon = sdBox(p - posStop, vec2<f32>(btnRadius * 0.35));
      if (dIcon < 0.0) {
         btnCol = vec3<f32>(0.8, 0.2, 0.2);
         // Brighten when clicked
         btnCol = select(btnCol, btnCol * 1.5, isClicked);
      }
      let mask = smoothstep(0.0, aa * 2.0, -dStopBg);
      color = mix(color, btnCol, mask);

      let dRing = abs(dStopBg) - 0.002;
      let ringMask = 1.0 - smoothstep(0.0, aa * 2.0, dRing);
      color = mix(color, vec3<f32>(0.05), ringMask * 0.5);
      
      // Add glow when clicked
      if (isClicked) {
          let glowDist = length(p - posStop);
          let glow = exp(-glowDist * 15.0) * 0.3;
          color += vec3<f32>(0.8, 0.2, 0.2) * glow;
      }
  }

  // NIGHT MODE DIMMING
  let dim = max(0.2, bez.dimFactor);
  color *= dim;

  return vec4<f32>(color, 1.0);
}
