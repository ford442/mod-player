// patternv0.46.wgsl
// Frosted Glass
// - Fixed: Full screen rendering to support UI and proper scaling
// - Fixed: Pattern playback logic
// - Added: Playback control buttons
// - Added: Translucent frosted glass caps with subsurface scattering

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
  gridRect: vec4<f32>,  // x, y, w, h (normalized)
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
  // Force single pass: discard extra instances if host uses instanced drawing
  if (iIdx > 0u) {
    return VertexOut(vec4<f32>(0.0), vec2<f32>(0.0));
  }

  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
  );

  var out: VertexOut;
  out.position = vec4<f32>(pos[vIdx], 0.0, 1.0);
  // UV 0,0 at Top-Left
  out.uv = pos[vIdx] * vec2<f32>(0.5, -0.5) + 0.5; 
  return out;
}

// --- SDF Primitives ---
fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
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

// --- Helpers ---
fn getNoteColor(note: u32) -> vec3<f32> {
    // Simple palette based on octave/note
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
  
  // Background (will show through transparent areas)
  var col = vec3<f32>(0.05, 0.05, 0.06);
  
  // --- LAYOUT using gridRect for precise bezel alignment ---
  // gridRect defines the exact grid area within the bezel
  let gridLeft = uniforms.gridRect.x;
  let gridRight = uniforms.gridRect.x + uniforms.gridRect.z;
  let gridTop = uniforms.gridRect.y;
  let gridBottom = uniforms.gridRect.y + uniforms.gridRect.w;
  
  // --- GRID RENDER ---
  if (uv.x > gridLeft && uv.x < gridRight && uv.y > gridTop && uv.y < gridBottom) {
      // Grid Coordinate System - normalize to 0-1 within grid area
      let localUV = vec2<f32>(
          (uv.x - gridLeft) / uniforms.gridRect.z,
          (uv.y - gridTop) / uniforms.gridRect.w
      );
      
      let nCols = 32.0; // Fixed 32 channels for this shader
      let nRows = 32.0; // Visible rows
      
      let colId = floor(localUV.x * nCols);
      let rowId = floor(localUV.y * nRows);
      
      let cellUV = fract(localUV * vec2<f32>(nCols, nRows));
      
      // Determine Pattern Row
      // Center playhead at row 16
      let centerRow = 16.0;
      let scrollOffset = uniforms.tickOffset; // 0..1 fraction of a row
      let visRow = rowId;
      
      // Actual pattern row index
      let patternRowIdx = i32(uniforms.playheadRow) + i32(visRow) - i32(centerRow);
      
      // Cell Shape
      let dBox = sdBox(cellUV - 0.5, vec2<f32>(0.42)); // Gap between keys
      let isCap = dBox < 0.0;
      
      if (isCap) {
          var capColor = vec3<f32>(0.15, 0.16, 0.18); // Inactive plastic
          var noteGlow = 0.0;
          
          // Fetch Data
          if (patternRowIdx >= 0 && patternRowIdx < i32(uniforms.numRows)) {
              if (colId < f32(uniforms.numChannels)) {
                  let dataIdx = u32(patternRowIdx) * uniforms.numChannels + u32(colId);
                  // Bounds check for safety
                  if (dataIdx < arrayLength(&cells) / 2u) {
                      let packedA = cells[dataIdx * 2u];
                      let note = (packedA >> 24) & 255u;
                      
                      if (note > 0u) {
                          let baseCol = getNoteColor(note);
                          capColor = mix(capColor, baseCol, 0.4);
                          
                          // Highlight if active row
                          if (i32(visRow) == i32(centerRow)) {
                              noteGlow = 1.0;
                              capColor = mix(capColor, vec3<f32>(1.0), 0.5);
                          }
                      }
                  }
              }
          }
          
          // Playhead Highlight Line
          if (i32(visRow) == i32(centerRow)) {
              capColor += vec3<f32>(0.1, 0.1, 0.15);
          }
          
          // --- TRANSLUCENT FROSTED GLASS CAPS ---
          // Calculate normal for fresnel effect
          let p = cellUV - 0.5;
          let n = normalize(vec3<f32>(p.x * 2.0, p.y * 2.0, 0.5));
          let viewDir = vec3<f32>(0.0, 0.0, 1.0);
          
          // Fresnel rim effect
          let fresnel = pow(1.0 - abs(dot(n, viewDir)), 2.0);
          
          // Subsurface scattering from note glow
          let thickness = 0.2;
          let subsurface = exp(-thickness * 5.0) * noteGlow;
          
          // Glass color mixing
          let bgColor = vec3<f32>(0.05, 0.05, 0.06);
          let glassColor = mix(bgColor * 0.3, capColor, 0.7);
          
          // Alpha with fresnel rim enhancement
          let edgeAlpha = smoothstep(0.0, 0.1, -dBox);
          let alpha = edgeAlpha * (0.6 + 0.4 * fresnel);
          
          // Diffuse light for 3D effect
          let light = vec3<f32>(0.5, -0.8, 1.0);
          let diff = max(0.0, dot(n, normalize(light)));
          let litGlassColor = glassColor * (0.5 + 0.5 * diff);
          
          // Composite with background
          var finalColor = mix(bgColor, litGlassColor, alpha);
          
          // Add subsurface glow
          finalColor += subsurface * capColor * 2.0;
          
          col = finalColor;
      }
  }
  
  // --- CONTROLS RENDER ---
  // Controls below the grid area
  let controlY = gridBottom + 0.02;
  if (uv.y > controlY) {
      let ctrlH = 1.0 - controlY;
      let ctrlUV = vec2<f32>(uv.x, (uv.y - controlY) / ctrlH);
      
      // Background strip
      col = mix(col, vec3<f32>(0.08, 0.08, 0.1), 1.0);
      
      // Buttons: Loop (Left), Play (Center), Stop (Right)
      let btnY = 0.5;
      
      // Play
      var pPlay = ctrlUV - vec2<f32>(0.5, btnY);
      pPlay.x *= aspect * (ctrlH / 1.0); // Correct aspect
      let dPlay = sdTriangle(pPlay * 4.0, 0.3);
      let isPlaying = uniforms.isPlaying == 1u;
      let playCol = select(vec3<f32>(0.0, 0.4, 0.0), vec3<f32>(0.2, 1.0, 0.2), isPlaying);
      col = mix(col, playCol, 1.0 - smoothstep(0.0, 0.05, dPlay));
      
      // Stop
      var pStop = ctrlUV - vec2<f32>(0.6, btnY);
      pStop.x *= aspect * (ctrlH / 1.0);
      let dStop = sdBox(pStop * 4.0, vec2<f32>(0.25));
      col = mix(col, vec3<f32>(0.8, 0.1, 0.1), 1.0 - smoothstep(0.0, 0.05, dStop));
      
      // Loop (Circle)
      var pLoop = ctrlUV - vec2<f32>(0.4, btnY);
      pLoop.x *= aspect * (ctrlH / 1.0);
      let dLoop = abs(sdCircle(pLoop * 4.0, 0.25)) - 0.05;
      col = mix(col, vec3<f32>(0.9, 0.6, 0.0), 1.0 - smoothstep(0.0, 0.05, dLoop));
  }
  
  return vec4<f32>(col * dimFactor, 1.0);
}
