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

@fragment fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    // Frosted Wall: A clean, dense grid that fits the WebGL caps
    let cols = 32.0; // Viewport width in steps
    let rows = f32(params.numChannels);
    
    // Grid Lines
    let gridX = fract(uv.x * cols);
    let gridY = fract(uv.y * rows);
    
    let lineX = smoothstep(0.45, 0.5, abs(gridX - 0.5));
    let lineY = smoothstep(0.45, 0.5, abs(gridY - 0.5));
    
    // Subtle "Tech" background pattern
    let cellHash = sin(floor(uv.x * cols) * 12.9898 + floor(uv.y * rows) * 78.233);
    let techNoise = smoothstep(0.8, 1.0, sin(params.timeSec + cellHash * 10.0));
    
    // Base Color (Cool Dark Grey to contrast with White Chassis)
    var col = vec3<f32>(0.2, 0.22, 0.25);
    
    // Add grid lines
    col += vec3<f32>(0.1) * (lineX + lineY);
    
    // Add active "data" noise
    if (params.isPlaying > 0u) {
        col += vec3<f32>(0.05, 0.1, 0.15) * techNoise;
    }

    return vec4<f32>(col, 0.6 * params.dimFactor); // Semi-transparent
}