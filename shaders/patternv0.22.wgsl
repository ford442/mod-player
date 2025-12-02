// patternv0.22.wgsl
// Concept: The Holographic Tank
// Features: Stationary Playhead, 3D Perspective, Physical Vibrato/Tremolo

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
// Bindings 2-5 unused in this mode but required for layout compatibility
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
  @location(5) @interpolate(linear) depth: f32, // Fade out distant notes
  @location(6) @interpolate(flat) isTremolo: u32,
};

fn toUpperAscii(code: u32) -> u32 {
    return select(code, code - 32u, (code >= 97u) & (code <= 122u));
}

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  // --- 1. DECODE DATA ---
  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;
  
  // Data access
  let idx = instanceIndex * 2u;
  let a = cells[idx];
  let b = cells[idx + 1u];

  // Decode Effect for Vertex Deformation (Vibrato)
  let effCode = (b >> 8) & 255u;
  let effParam = b & 255u;
  // '4' is Vibrato (ASCII 52), '7' is Tremolo (ASCII 55)
  let effChar = toUpperAscii(effCode);
  let isVibrato = (effChar == 52u); 
  let isTremolo = (effChar == 55u);

  // --- 2. STATIONARY PLAYHEAD LOGIC ---
  // Calculate "World Z" relative to playhead
  // Future rows are positive Z, Past rows are negative Z
  let playheadPos = f32(uniforms.playheadRow) + uniforms.tickOffset;
  let rowPos = f32(row);
  let dist = rowPos - playheadPos; // 0.0 = Current playing row

  // Only render a specific window of rows to save fill rate
  // Show 4 rows of history (-4.0) and 32 rows of future (32.0)
  // We can "squash" degenerate vertices to hide them
  var isActive = 1.0;
  if (dist < -4.0 || dist > 48.0) { isActive = 0.0; }

  // --- 3. 3D PERSPECTIVE CALCULATION ---
  // We want a "Highway" look. 
  // Z = depth into screen.
  // Y = vertical height (optional, maybe flat highway).
  // X = channel separation.

  // Perspective factor: Things get smaller as dist increases
  // "Camera" is slightly above and behind the playhead
  let perspective = 1.0 / (1.0 + max(0.0, dist) * 0.15); 
  
  // Base X position (Channel spacing)
  // Center the channels around 0.0
  let channelWidth = 0.25; 
  let totalWidth = f32(numChannels) * channelWidth;
  let offsetX = (f32(channel) * channelWidth) - (totalWidth * 0.5) + (channelWidth * 0.5);

  // Apply Vibrato Wiggle
  var vibOffset = 0.0;
  if (isActive > 0.5 && isVibrato && uniforms.isPlaying == 1u) {
      let speed = 15.0; // Fast wiggle
      let depth = 0.05 * (f32(effParam) / 255.0 + 0.2); 
      vibOffset = sin(uniforms.timeSec * speed + rowPos) * depth;
  }

  // Final Screen X
  // Apply perspective to X position
  let screenX = (offsetX + vibOffset) * perspective;

  // Final Screen Y
  // 0.0 is center. We want the playhead near the bottom (-0.8).
  // Future notes go UP (+Y) and shrink.
  // Past notes drop DOWN (-Y) and grow/fade.
  // Let's map 'dist' to Y.
  // We compress the distance logarithmically so the highway looks infinite
  let screenY = -0.6 + (dist * 0.08 * perspective); 

  // --- 4. QUAD EXPANSION ---
  // Standard quad vertices
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
  );
  let lp = quad[vertexIndex];

  // Scale the quad itself by perspective (notes get smaller in distance)
  let noteScale = 0.08 * perspective * isActive; // Scale down to box size
  
  let finalPos = vec2<f32>(
      screenX + lp.x * noteScale, // Aspect ratio fix might be needed here depending on canvas
      screenY + lp.y * noteScale * (uniforms.canvasW / uniforms.canvasH) // Correct aspect
  );

  var out: VertexOut;
  out.position = vec4<f32>(finalPos, 0.0, 1.0);
  out.row = row;
  out.channel = channel;
  out.uv = lp * 0.5 + 0.5; // 0..1
  out.packedA = a;
  out.packedB = b;
  out.depth = clamp(1.0 - (dist / 32.0), 0.0, 1.0); // 1.0 = near, 0.0 = far
  out.isTremolo = u32(isTremolo);
  
  return out;
}

// --- FRAGMENT SHADER ---

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

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
    // Unpack Note
    let noteChar = (in.packedA >> 24) & 255u;
    let inst = in.packedA & 255u;
    let hasNote = (noteChar >= 65u && noteChar <= 71u);

    // Coordinate system (-0.5 to 0.5)
    let uv = in.uv - 0.5;

    // 1. Cube Shape (Voxel Look)
    // We create a "fake" 3D cube look using 2D borders
    let box = sdBox(uv, vec2<f32>(0.4, 0.4));
    let innerBox = sdBox(uv, vec2<f32>(0.3, 0.3));
    
    var color = vec3<f32>(0.0);
    var alpha = 0.0;

    // 2. Playhead Scanner Line
    // If this row is effectively the current one (dist near 0)
    // We calculated dist in vertex, but let's re-calc approximate locally or just use row index
    let playheadPos = f32(uniforms.playheadRow); // Integer row
    let isCurrentRow = (abs(f32(in.row) - playheadPos) < 0.5);

    if (hasNote) {
        // Base Color from Instrument
        // Use hash of instrument to pick color from palette
        let hue = f32(inst) * 0.123 + 0.4;
        var noteColor = neonPalette(hue);

        // TREMOLO EFFECT (Pulsing Opacity/Brightness)
        if (in.isTremolo == 1u && uniforms.isPlaying == 1u) {
            let pulse = 0.5 + 0.5 * sin(uniforms.timeSec * 20.0);
            noteColor += vec3<f32>(pulse * 0.8); // Add white flash
        }

        // Draw Voxel Edges
        let edge = smoothstep(0.02, 0.0, abs(box)) * 0.8; // Outer glow
        let face = smoothstep(0.02, 0.0, innerBox); // Inner face

        // "Glass" fill
        color = noteColor * (edge + face * 0.3);
        
        // Active Hit Flash
        if (isCurrentRow) {
            color += vec3<f32>(1.0, 1.0, 1.0) * 0.8; // Flash white on hit
        }

        alpha = smoothstep(0.01, 0.0, box); // Hard edge for shape
    } else {
        // Empty slots - draw faint grid markers
        // Only drawing a tiny dot or dash to maintain the "grid" feel without clutter
        let dot = 1.0 - smoothstep(0.0, 0.05, length(uv));
        color = vec3<f32>(0.1, 0.1, 0.2) * dot * 0.5;
        alpha = dot;
    }

    // 3. Depth Fog
    // Fade out color based on depth passed from vertex
    color *= in.depth;
    alpha *= in.depth;

    // 4. Scanner Line Visual (Global)
    // If this is the current row, draw a horizontal laser line across the note
    if (isCurrentRow) {
        let laser = smoothstep(0.1, 0.0, abs(uv.y));
        color += vec3<f32>(0.0, 1.0, 1.0) * laser * 0.5;
        alpha = max(alpha, laser * in.depth);
    }

    // Pre-multiply alpha for additive/normal blend
    return vec4<f32>(color * alpha, alpha);
}
