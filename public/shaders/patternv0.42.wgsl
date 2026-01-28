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
  bloomIntensity: f32,
  bloomThreshold: f32,
  invertChannels: u32,
  dimFactor: f32,
};

@group(0) @binding(1) var<uniform> params: Uniforms;

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
    let r = length(p) * 2.0; // 0 at center, 1 at edge
    let a = atan2(p.y, p.x);
    
    // Draw concentric rings for tracks
    let numTracks = f32(params.numChannels);
    let trackW = 0.45 / numTracks; // 0.45 radius max
    
    let ringIndex = floor((r - 0.15) / (0.45 - 0.15) * numTracks);
    
    // Only draw if inside valid ring area
    if (r < 0.15 || r > 0.6) {
        return vec4<f32>(0.0);
    }
    
    // Radial dividers (Time steps)
    let steps = 64.0;
    let angleSector = fract(a / (6.28318 / steps));
    let spoke = 1.0 - smoothstep(0.45, 0.5, abs(angleSector - 0.5));
    
    // Ring borders
    let localR = fract((r - 0.15) / (0.45 - 0.15) * numTracks);
    let ringBorder = 1.0 - smoothstep(0.05, 0.1, abs(localR - 0.5));
    
    let alpha = (spoke * 0.05) + (ringBorder * 0.02);
    let col = vec3<f32>(0.4, 0.5, 0.6);
    
    // Transparent background so chassis shows through
    return vec4<f32>(col, alpha * params.dimFactor);
}