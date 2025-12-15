// patternv0.24.wgsl
// Mode: "Cyberpunk HUD"
// Features: Vector brackets, Data Bars, Scanlines, RAINBOW Palette

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

  let px = f32(row) * uniforms.cellW;
  let py = f32(channel) * uniforms.cellH;

  let lp = quad[vertexIndex];
  let worldX = px + lp.x * uniforms.cellW;
  let worldY = py + lp.y * uniforms.cellH;

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

// --- COLOR & HELPERS ---

fn neonPalette(t: f32) -> vec3<f32> {
    let a = vec3<f32>(0.5, 0.5, 0.5);
    let b = vec3<f32>(0.5, 0.5, 0.5);
    let c = vec3<f32>(1.0, 1.0, 1.0);
    let d = vec3<f32>(0.263, 0.416, 0.557);
    return a + b * cos(6.28318 * (c * t + d));
}

fn toUpperAscii(code: u32) -> u32 {
    return select(code, code - 32u, (code >= 97u) & (code <= 122u));
}

fn pitchClassFromPacked(packed: u32) -> f32 {
    let c0 = toUpperAscii((packed >> 24) & 255u);
    var semitone: i32 = 0;
    var valid = true;
    switch (c0) {
        case 65u: { semitone = 9; }
        case 66u: { semitone = 11; }
        case 67u: { semitone = 0; }
        case 68u: { semitone = 2; }
        case 69u: { semitone = 4; }
        case 70u: { semitone = 5; }
        case 71u: { semitone = 7; }
        default: { valid = false; }
    }
    if (!valid) { return 0.0; }
    let c1 = toUpperAscii((packed >> 16) & 255u);
    if ((c1 == 35u) || (c1 == 43u)) {
        semitone = (semitone + 1) % 12;
    } else if (c1 == 66u) {
        semitone = (semitone + 11) % 12;
    }
    return f32(semitone) / 12.0;
}

// --- SHAPE FUNCTIONS ---

fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

// Corner Brackets (Viewfinder shape)
fn sdBracket(p: vec2<f32>, b: vec2<f32>, thickness: f32, len: f32) -> f32 {
    let dBox = abs(sdBox(p, b)) - thickness;
    // Mask the middle of sides
    let q = abs(p);
    let maskX = step(q.x, b.x - len);
    let maskY = step(q.y, b.y - len);
    
    if (maskX > 0.5 || maskY > 0.5) {
        return 1.0;
    }
    return dBox;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y);

  // Constants
  let bgCol = vec3<f32>(0.05, 0.05, 0.06); 
  let gridCol = vec3<f32>(0.12, 0.13, 0.15);
  
  var col = bgCol;

  // 1. BACKGROUND GRID (Sub-pixel mesh)
  let grid = abs(fract(uv * 10.0 - 0.5) - 0.5);
  let gridLine = 1.0 - smoothstep(0.0, aa * 2.0, min(grid.x, grid.y));
  col = mix(col, gridCol, gridLine * 0.3); 

  // --- DATA DECODE ---
  let noteChar = (in.packedA >> 24) & 255u;
  let inst = in.packedA & 255u;
  let effCode = (in.packedB >> 8) & 255u;
  let effParam = in.packedB & 255u;
  let hasNote = (noteChar >= 65u && noteChar <= 71u);
  let hasEffect = (effParam > 0u);
  let ch = channels[in.channel];

  // --- 2. MAIN HOUSING (Brackets) ---
  let boxSize = vec2<f32>(0.45, 0.45);
  let dBracket = sdBracket(p, boxSize, 0.015, 0.15); 
  
  var bracketCol = vec3<f32>(0.25); 
  
  // Highlight bracket on playhead row
  let isPlayhead = (in.row == uniforms.playheadRow);
  if (isPlayhead) {
      bracketCol = vec3<f32>(0.8, 0.8, 0.8);
  }
  
  // --- 3. ACTIVE DATA VISUALIZATION ---
  if (hasNote) {
      // Calculate Neon Color
      let pitchHue = pitchClassFromPacked(in.packedA);
      let base_note_color = neonPalette(pitchHue);
      
      // Instrument variation (brightness/saturation tweak)
      let instBand = inst & 15u;
      let instMod = 0.8 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.2;
      let dataCol = base_note_color * instMod;

      // A. The "Bar Graph" (Volume)
      let vol = clamp(ch.volume, 0.0, 1.0);
      let barHeight = vol * 0.8; // Max height inside box
      let barBottom = -boxSize.y + 0.05;
      
      // Draw bar
      if (p.y > barBottom && p.y < barBottom + barHeight && abs(p.x) < boxSize.x - 0.05) {
          // Scanline effect on the bar
          let scan = step(0.5, fract(uv.y * 40.0));
          col = mix(col, dataCol, 0.9 * scan); 
      }
      
      // B. Note Indicator (Top Text/Block)
      let noteBox = sdBox(p - vec2<f32>(0.0, 0.25), vec2<f32>(0.1, 0.02));
      if (noteBox < 0.0) {
          // Header matches note color but brighter
          col = mix(dataCol, vec3<f32>(1.0), 0.5); 
      }
      
      // C. Trigger Flash (Tint the bracket)
      if (ch.trigger > 0u) {
          bracketCol = mix(bracketCol, dataCol, 0.8);
          col += dataCol * 0.3; // Screen flash
      }
  }

  // Draw the bracket now that bracketCol is finalized
  let bracketAlpha = 1.0 - smoothstep(0.0, aa, dBracket);
  col = mix(col, bracketCol, bracketAlpha);

  // --- 4. EFFECT INDICATOR (Tiny LED) ---
  if (hasEffect) {
      let dDot = length(p - vec2<f32>(0.35, -0.35)) - 0.03;
      let dotAlpha = 1.0 - smoothstep(0.0, aa, dDot);
      col = mix(col, vec3<f32>(1.0, 1.0, 1.0), dotAlpha); // White LED for contrast
  }

  // --- 5. PLAYHEAD CURSOR LINE ---
  if (isPlayhead) {
      let lineDist = abs(p.y);
      let lineAlpha = 1.0 - smoothstep(0.005, 0.005 + aa, lineDist);
      let centerMask = smoothstep(0.3, 0.35, abs(p.x)); 
      col += vec3<f32>(1.0, 1.0, 1.0) * lineAlpha * centerMask * 0.4;
  }

  // --- 6. GLOBAL SCANLINE & VIGNETTE ---
  let globalScan = 0.9 + 0.1 * sin(uv.y * 800.0 + uniforms.timeSec * 10.0);
  col *= globalScan;

  let vig = 1.0 - length(p) * 0.5;
  col *= vig;

  return vec4<f32>(col, 1.0);
}