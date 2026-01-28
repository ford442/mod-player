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
    // 1. Setup Grid Geometry (Matching v0.40 WebGL overlay)
    // The WebGL overlay uses specific offsets, we try to match the "active area"
    // roughly centered.
    
    // Convert UV to approximate grid coords
    let cols = 32.0; // View window size
    let rows = f32(params.numChannels);
    
    // We want to draw a subtle grid where the notes *will* appear.
    // The chassis has a dark recess, so we just add very faint slot markers.
    
    // Inset to match the WebGL overlay area roughly
    // Map uv 0..1 to grid - but we want to leave margins.
    // Let's rely on the chassis for the "container" and just draw faint lines.
    
    let gridX = fract(uv.x * cols);
    let gridY = fract(uv.y * rows);
    
    // Draw simple dots/crosses at intersections
    let dX = abs(gridX - 0.5);
    let dY = abs(gridY - 0.5);
    
    // Faint slot center dot
    let dot = 1.0 - smoothstep(0.02, 0.05, length(vec2<f32>(dX, dY)));
    
    // Faint horizontal track lines
    let line = 1.0 - smoothstep(0.48, 0.49, dY);
    
    var color = vec3<f32>(0.3, 0.35, 0.4);
    let alpha = (dot * 0.1) + (line * 0.05); // Very subtle
    
    // Transparent background so chassis shows through
    return vec4<f32>(color, alpha * params.dimFactor);
}