// patternv0.44.wgsl
// Frosted Wall 64 (Square)

struct Uniforms {
  numRows: u32,
  numChannels: u32,
  playheadRow: f32,
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
@group(0) @binding(4) var buttonsSampler: sampler;
@group(0) @binding(5) var buttonsTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vIdx: u32, @builtin(instance_index) iIdx: u32) -> VertexOut {
  if (iIdx > 0u) {
    return VertexOut(vec4<f32>(0.0, 0.0, 0.0, 0.0), vec2<f32>(0.0, 0.0));
  }

  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
  );

  var out: VertexOut;
  out.position = vec4<f32>(pos[vIdx], 0.0, 1.0);
  out.uv = pos[vIdx] * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5); 
  return out;
}

fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec2<f32>(0.0, 0.0))) + min(max(d.x, d.y), 0.0);
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
    p2.x -= clamp(p2.x, -2.0 * r, 0.0);
    return -length(p2) * sign(p2.y);
}

fn getNoteColor(note: u32) -> vec3<f32> {
    let hue = f32(note % 12u) / 12.0;
    return vec3<f32>(
        0.5 + 0.5 * cos(6.28 * (hue + 0.0)),
        0.5 + 0.5 * cos(6.28 * (hue + 0.33)),
        0.5 + 0.5 * cos(6.28 * (hue + 0.67))
    );
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let aspect = uniforms.canvasW / uniforms.canvasH;
  let dimFactor = uniforms.dimFactor;
  
  var col = vec3<f32>(0.05, 0.05, 0.06);
  
  let gridBottom = 0.85;
  let margin = 0.05;
  
  if (uv.x > margin && uv.x < (1.0 - margin) && uv.y > margin && uv.y < gridBottom) {
      let gridW = 1.0 - 2.0 * margin;
      let gridH = gridBottom - margin;
      let localUV = vec2<f32>((uv.x - margin) / gridW, (uv.y - margin) / gridH);
      
      let nCols = 64.0;
      let nRows = 32.0; 
      
      let colId = floor(localUV.x * nCols);
      let rowId = floor(localUV.y * nRows);
      
      let cellUV = fract(localUV * vec2<f32>(nCols, nRows));
      
      let centerRow = 16.0;
      let scrollOffset = fract(uniforms.playheadRow);
      let visRow = rowId + scrollOffset;
      
      let baseRow = i32(floor(uniforms.playheadRow));
      let patternRowIdx = baseRow + i32(floor(visRow - centerRow));
      
      let dBox = sdBox(cellUV - vec2<f32>(0.5, 0.5), vec2<f32>(0.42, 0.42));
      let isCap = dBox < 0.0;
      
      if (isCap) {
          var capColor = vec3<f32>(0.15, 0.16, 0.18);
          var glow = 0.0;
          
          if (patternRowIdx >= 0 && patternRowIdx < i32(uniforms.numRows)) {
              if (colId < f32(uniforms.numChannels)) {
                  let dataIdx = u32(patternRowIdx) * uniforms.numChannels + u32(colId);
                  if (dataIdx < arrayLength(&cells) / 2u) {
                      let packedA = cells[dataIdx * 2u];
                      let note = (packedA >> 24) & 255u;
                      
                      if (note > 0u) {
                          let baseCol = getNoteColor(note);
                          capColor = mix(capColor, baseCol, 0.4);
                          
                          let playheadDist = abs(visRow - centerRow);
                          let playheadGlow = 1.0 - smoothstep(0.0, 1.2, playheadDist);
                          if (playheadGlow > 0.0) {
                              glow = playheadGlow;
                              capColor = mix(capColor, vec3<f32>(1.0, 1.0, 1.0), 0.5);
                          }
                      }
                  }
              }
          }
          
          let lineDist = abs(visRow - centerRow);
          let lineGlow = 1.0 - smoothstep(0.0, 1.0, lineDist);
          capColor += vec3<f32>(0.1, 0.1, 0.15) * lineGlow;
          
          let edge = smoothstep(0.0, 0.1, -dBox);
          let light = vec3<f32>(0.5, -0.8, 1.0);
          let n = normalize(vec3<f32>((cellUV.x - 0.5), (cellUV.y - 0.5), 0.5));
          let diff = max(0.0, dot(n, normalize(light)));
          
          capColor *= (0.5 + 0.5 * diff);
          capColor += vec3<f32>(glow * 0.5, glow * 0.5, glow * 0.5);
          
          col = mix(col, capColor, edge);
      }
  }
  
  if (uv.y > gridBottom) {
      let ctrlH = 1.0 - gridBottom;
      let ctrlUV = vec2<f32>(uv.x, (uv.y - gridBottom) / ctrlH);
      
      col = mix(col, vec3<f32>(0.08, 0.08, 0.1), 1.0);
      
      let btnY = 0.5;
      
      var pPlay = ctrlUV - vec2<f32>(0.5, btnY);
      pPlay.x *= aspect * (ctrlH / 1.0);
      let dPlay = sdTriangle(pPlay * 4.0, 0.3);
      let isPlaying = uniforms.isPlaying > 0u;
      let playCol = select(vec3<f32>(0.0, 0.4, 0.0), vec3<f32>(0.2, 1.0, 0.2), isPlaying);
      col = mix(col, playCol, 1.0 - smoothstep(0.0, 0.05, dPlay));
      
      var pStop = ctrlUV - vec2<f32>(0.6, btnY);
      pStop.x *= aspect * (ctrlH / 1.0);
      let dStop = sdBox(pStop * 4.0, vec2<f32>(0.25, 0.25));
      col = mix(col, vec3<f32>(0.8, 0.1, 0.1), 1.0 - smoothstep(0.0, 0.05, dStop));
      
      var pLoop = ctrlUV - vec2<f32>(0.4, btnY);
      pLoop.x *= aspect * (ctrlH / 1.0);
      let dLoop = abs(sdCircle(pLoop * 4.0, 0.25)) - 0.05;
      col = mix(col, vec3<f32>(0.9, 0.6, 0.0), 1.0 - smoothstep(0.0, 0.05, dLoop));
  }
  
  let pageProgress = fract(uniforms.playheadRow / 64.0);
  var boundaryFade = 1.0;
  if (pageProgress < 0.05) {
      boundaryFade = smoothstep(0.0, 0.05, pageProgress);
  } else if (pageProgress > 0.95) {
      boundaryFade = 1.0 - smoothstep(0.95, 1.0, pageProgress);
  }
  // Kick reactive glow
  let p = uv - 0.5;
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.3;
  col += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * uniforms.bloomIntensity;
  // Dithering for night mode
  let noise = fract(sin(dot(in.uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  col += (noise - 0.5) * 0.01;

  return vec4<f32>(col * dimFactor * boundaryFade, 1.0);
}
