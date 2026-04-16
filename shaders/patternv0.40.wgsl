// patternv0.40.wgsl
// Horizontal Paged Grid Shader (Time = X, Channels = Y)

struct Uniforms {
  numRows: u32,
  numChannels: u32,
  playheadRow: f32, // CRITICAL FIX: Changed from u32 to f32
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
  gridRect: vec4<f32>, 
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

  let stepsPerPage = 32.0;
  // Use floor on the float, then multiply to get the page start
  let pageStart = floor(uniforms.playheadRow / stepsPerPage) * stepsPerPage;
  let localRow = f32(row) - pageStart;
  
  let px = localRow * uniforms.cellW;
  let py = f32(channel) * uniforms.cellH;
  
  var isVisible = 1.0;
  if (localRow < 0.0 || localRow >= stepsPerPage) {
      isVisible = 0.0;
  }
  
  let effectiveChannel = f32(channel);
  let hasHeader = uniforms.numChannels > 1u && uniforms.gridRect.y > 0.15;
  let dataChannels = f32(uniforms.numChannels) - select(0.0, 1.0, hasHeader);
  let channelIndex = select(effectiveChannel, effectiveChannel - 1.0, hasHeader && effectiveChannel > 0.0);
  
  let gridX = uniforms.gridRect.x + (localRow / stepsPerPage) * uniforms.gridRect.z;
  let gridY = uniforms.gridRect.y + (channelIndex / max(1.0, dataChannels)) * uniforms.gridRect.w;
  
  let cellWidth = uniforms.gridRect.z / stepsPerPage;
  let cellHeight = uniforms.gridRect.w / max(1.0, dataChannels);
  
  let clipX = gridX * 2.0 - 1.0 + quad[vertexIndex].x * cellWidth * 2.0;
  let clipY = 1.0 - (gridY * 2.0) - quad[vertexIndex].y * cellHeight * 2.0;
  
  let finalPos = select(vec4<f32>(0.0, 0.0, 0.0, 0.0), vec4<f32>(clipX, clipY, 0.0, 1.0), isVisible > 0.5);

  let idx = instanceIndex * 2u;
  var a = 0u;
  var b = 0u;
  // Bounds check safety
  if (idx + 1u < arrayLength(&cells)) {
      a = cells[idx];
      b = cells[idx + 1u];
  }

  var out: VertexOut;
  out.position = finalPos;
  out.row = row;
  out.channel = channel;
  out.uv = quad[vertexIndex];
  out.packedA = a;
  out.packedB = b;
  return out;
}

fn neonPalette(t: f32) -> vec3<f32> {
    let a = vec3<f32>(0.5, 0.5, 0.5);
    let b = vec3<f32>(0.5, 0.5, 0.5);
    let c = vec3<f32>(1.0, 1.0, 1.0);
    let d = vec3<f32>(0.0, 0.33, 0.67);
    let beatDrift = uniforms.beatPhase * 0.1;
    return a + b * cos(6.28318 * (c * (t + beatDrift) + d));
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return length(max(q, vec2<f32>(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
}

struct FragmentConstants {
  bgColor: vec3<f32>,
  ledOnColor: vec3<f32>,
  ledOffColor: vec3<f32>,
  borderColor: vec3<f32>,
};

fn getFragmentConstants() -> FragmentConstants {
    var c: FragmentConstants;
    c.bgColor = vec3<f32>(0.10, 0.11, 0.13); 
    c.ledOnColor = vec3<f32>(0.0, 0.85, 0.95);
    c.ledOffColor = vec3<f32>(0.08, 0.12, 0.15);
    c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
    return c;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  // Compute derivatives in uniform control flow (before any early returns)
  let uv = in.uv;
  let p = uv - vec2<f32>(0.5, 0.5);
  let aa = fwidth(p.y) * 0.75;
  
  if (in.channel >= uniforms.numChannels) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }
  let fs = getFragmentConstants();

  if (in.channel == 0u) {
      var col = fs.bgColor * 0.8;
      return vec4<f32>(col, 1.0);
  }

  let dBox = sdRoundedBox(p, vec2<f32>(0.45, 0.40), 0.05);
  var col = fs.bgColor;
  
  col += smoothstep(0.0, 0.1, dBox + 0.5) * 0.02;

  let onPlayhead = (in.row == u32(uniforms.playheadRow));
  
  let note = (in.packedA >> 24) & 255u;
  let volCmd = (in.packedA >> 8) & 255u;
  let effCmd = (in.packedB >> 8) & 255u;
  let hasNote = note > 0u;
  let hasExpression = (volCmd > 0u) || (effCmd > 0u);
  let ch = channels[in.channel];

  if (hasNote) {
      let noteCol = neonPalette(f32(note % 12u) / 12.0);
      let dist = length(p);
      let glow = exp(-dist * 4.0);
      col += noteCol * glow * 1.5;
      // Trigger flash: pulse on the exact playhead row
      if (ch.trigger > 0u && onPlayhead) {
          col += noteCol * 1.5;
      }
  }

  // Expression indicator: subtle cyan tint for cells with vol/effect commands
  if (hasExpression && ch.isMuted == 0u) {
      col += vec3<f32>(0.0, 0.04, 0.08) * uniforms.bloomIntensity;
  }

  if (onPlayhead) {
      col += vec3<f32>(0.2, 0.2, 0.25) * 0.8;
  }

  col = mix(col, fs.borderColor, smoothstep(0.0, aa, dBox));
  col *= uniforms.dimFactor;

  // Kick reactive glow
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.3;
  col += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * uniforms.bloomIntensity;
  // Dithering for night mode
  let noise = fract(sin(dot(in.uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  col += (noise - 0.5) * 0.01;

  return vec4<f32>(col, 1.0);
}
