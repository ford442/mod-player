// patternv0.24.wgsl
// Mode: "Cyberpunk HUD"
// Features: Vector brackets, Data Bars, Scanlines, RAINBOW Palette, Tunnel fallback

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

struct ChannelState { 
  volume: f32, 
  pan: f32, 
  freq: f32, 
  trigger: u32, 
  noteAge: f32, 
  activeEffect: u32, 
  effectValue: f32, 
  isMuted: u32 
};
@group(0) @binding(3) var<storage, read> channels: array<ChannelState>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) row: u32,
  @location(1) @interpolate(flat) channel: u32,
  @location(2) @interpolate(linear) uv: vec2<f32>,
  @location(3) @interpolate(flat) packedA: u32,
  @location(4) @interpolate(flat) packedB: u32,
};

// ── Vertex Shader (Fits inside chassis window) ──
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

// ── Helpers ──
fn neonPalette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.263, 0.416, 0.557);
  return a + b * cos(6.28318 * (c * t + d));
}

fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

fn sdBracket(p: vec2<f32>, b: vec2<f32>, thickness: f32, len: f32) -> f32 {
  let dBox = abs(sdBox(p, b)) - thickness;
  let q = abs(p);
  let maskX = step(q.x, b.x - len);
  let maskY = step(q.y, b.y - len);
  if (maskX > 0.5 || maskY > 0.5) {
    return 1.0;
  }
  return dBox;
}

// ── Fragment Shader ──
@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p = uv - 0.5;
  let aa = fwidth(p.y);

  let bgCol = vec3<f32>(0.05, 0.05, 0.06);
  let gridCol = vec3<f32>(0.12, 0.13, 0.15);
  var col = bgCol;

  // Background grid
  let grid = abs(fract(uv * 10.0 - 0.5) - 0.5);
  let gridLine = 1.0 - smoothstep(0.0, aa * 2.0, min(grid.x, grid.y));
  col = mix(col, gridCol, gridLine * 0.3);

  // Decode note data
  let noteChar = (in.packedA >> 24) & 255u;
  let inst = in.packedA & 255u;
  let effCode = (in.packedB >> 8) & 255u;
  let effParam = in.packedB & 255u;
  let hasNote = (noteChar >= 65u && noteChar <= 71u);
  let hasEffect = (effParam > 0u);

  let ch = channels[in.channel];
  let isPlayhead = (in.row == uniforms.playheadRow);

  // Main housing brackets
  let boxSize = vec2<f32>(0.45, 0.45);
  let dBracket = sdBracket(p, boxSize, 0.015, 0.15);
  var bracketCol = vec3<f32>(0.25);
  if (isPlayhead) {
    bracketCol = vec3<f32>(0.8, 0.8, 0.8);
  }

  if (hasNote) {
    let pitchHue = f32((noteChar - 65u) % 12u) / 12.0;
    let base_note_color = neonPalette(pitchHue);
    let instMod = 0.8 + (f32(inst & 15u) / 15.0) * 0.2;
    let dataCol = base_note_color * instMod;

    // Volume bar
    let vol = clamp(ch.volume, 0.0, 1.0);
    let barHeight = vol * 0.8;
    let barBottom = -boxSize.y + 0.05;
    if (p.y > barBottom && p.y < barBottom + barHeight && abs(p.x) < boxSize.x - 0.05) {
      let scan = step(0.5, fract(uv.y * 40.0));
      col = mix(col, dataCol, 0.9 * scan);
    }

    // Note indicator
    let noteBox = sdBox(p - vec2<f32>(0.0, 0.25), vec2<f32>(0.1, 0.02));
    if (noteBox < 0.0) {
      col = mix(dataCol, vec3<f32>(1.0), 0.5);
    }

    if (ch.trigger > 0u) {
      bracketCol = mix(bracketCol, dataCol, 0.8);
      col += dataCol * 0.3;
    }
  }

  // Draw bracket
  let bracketAlpha = 1.0 - smoothstep(0.0, aa, dBracket);
  col = mix(col, bracketCol, bracketAlpha);

  // Effect LED
  if (hasEffect) {
    let dDot = length(p - vec2<f32>(0.35, -0.35)) - 0.03;
    let dotAlpha = 1.0 - smoothstep(0.0, aa, dDot);
    col = mix(col, vec3<f32>(1.0, 1.0, 1.0), dotAlpha);
  }

  // Playhead line
  if (isPlayhead) {
    let lineDist = abs(p.y);
    let lineAlpha = 1.0 - smoothstep(0.005, 0.005 + aa, lineDist);
    let centerMask = smoothstep(0.3, 0.35, abs(p.x));
    col += vec3<f32>(1.0, 1.0, 1.0) * lineAlpha * centerMask * 0.4;
  }

  // Global scanline + vignette
  let globalScan = 0.9 + 0.1 * sin(uv.y * 800.0 + uniforms.timeSec * 10.0);
  col *= globalScan;
  let vig = 1.0 - length(p) * 0.5;
  col *= vig;

  return vec4<f32>(col, 1.0);
}