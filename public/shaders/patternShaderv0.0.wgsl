// Pattern grid instanced shader
// Two u32 per cell packed in storage buffer:
// a = note0<<24 | note1<<16 | note2<<8 | instrumentByte
// b = effect0<<24 | effect1<<16 | effect2<<8 | flags (currently unused)

struct Uniforms {
  numRows: u32,
  numChannels: u32,
  playheadRow: u32,
  pad: u32,
  cellW: f32,
  cellH: f32,
  canvasW: f32,
  canvasH: f32,
};

@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) row: u32,
  @location(1) @interpolate(flat) channel: u32,

  // --- FIX ---
  // Added @interpolate(linear).
  // All floating-point values passed from vertex to fragment
  // MUST specify an interpolation type (e.g., linear, flat, perspective).
  @location(2) @interpolate(linear) uv: vec2<f32>,
  // -----------

  @location(3) @interpolate(flat) packedA: u32, // Note/Inst
  @location(4) @interpolate(flat) packedB: u32, // Vol/Effect/Param
};

fn decodeA(a: u32) -> vec4<u32> {
  let n0 = (a >> 24) & 255u;
  let n1 = (a >> 16) & 255u;
  let n2 = (a >> 8) & 255u;
  let inst = a & 255u;
  return vec4<u32>(n0, n1, n2, inst);
}

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  // 6 vertices per quad (two triangles): indices 0..5
  // Define local quad positions (0,0) .. (1,1)
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  let cellW = uniforms.cellW;
  let cellH = uniforms.cellH;
  let canvasW = uniforms.canvasW;
  let canvasH = uniforms.canvasH;

  let px = f32(channel) * cellW;
  let py = f32(row) * cellH;

  let lp = quad[vertexIndex];
  let worldX = px + lp.x * cellW;
  let worldY = py + lp.y * cellH;

  // Convert to clip space (origin top-left)
  let clipX = (worldX / canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / canvasH) * 2.0;

  let a = cells[instanceIndex * 2u]; // first packed

  var out: VertexOut;
  out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
  out.row = row;
  out.channel = channel;
  out.uv = lp; // local 0..1
  out.packedA = a;
  return out;
}

fn hueToRgb(h: f32) -> vec3<f32> {
  let r = abs(h * 6.0 - 3.0) - 1.0;
  let g = 2.0 - abs(h * 6.0 - 2.0);
  let b = 2.0 - abs(h * 6.0 - 4.0);
  return clamp(vec3<f32>(r, g, b), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn hashInstrument(inst: u32) -> f32 {
  // Simple hash then normalize
  let h = inst * 2654435761u; // Knuth multiplicative hash
  return f32(h & 255u) / 255.0;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let decoded = decodeA(in.packedA);
  let noteChar = decoded.x; // first note symbol ASCII
  let inst = decoded.w;
  let hasNote = (noteChar >= 65u && noteChar <= 71u); // 'A'-'G'

  var base = vec3<f32>(0.15, 0.16, 0.18); // empty cell base
  if (hasNote || inst > 0u) {
    let hue = hashInstrument(inst);
    base = hueToRgb(hue);
    // Slight saturation boost for note presence
    var boost = 0.1;
    if (hasNote) { boost = 0.25; }
    base = mix(base, normalize(base + 0.0001), boost);
  }

  // Playhead highlight
  if (in.row == uniforms.playheadRow) {
    base = clamp(base * 1.35 + vec3<f32>(0.12, 0.10, 0.08), vec3<f32>(0.0), vec3<f32>(1.0));
  }

  // Grid border using uv
  let border = 0.08;
  let onBorder = (in.uv.x < border || in.uv.x > 1.0 - border || in.uv.y < border || in.uv.y > 1.0 - border);
  if (onBorder) {
    base = mix(base, vec3<f32>(0.05, 0.05, 0.06), 0.6);
  }

  return vec4<f32>(base, 1.0);
}
