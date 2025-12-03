// patternv0.22.wgsl
// Concept: "The Glass Brick Wall" (Side-scrolling)
// Features: Horizontal Flow, Glass/Voxel Aesthetic, Physical Vibrato

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
  @location(5) @interpolate(linear) dist: f32,
  @location(6) @interpolate(flat) isTremolo: u32,
};

fn toUpperAscii(code: u32) -> u32 {
    return select(code, code - 32u, (code >= 97u) & (code <= 122u));
}

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  let idx = instanceIndex * 2u;
  let a = cells[idx];
  let b = cells[idx + 1u];

  let effCode = (b >> 8) & 255u;
  let effParam = b & 255u;
  let effChar = toUpperAscii(effCode);
  let isVibrato = (effChar == 52u); // '4'
  let isTremolo = (effChar == 55u); // '7'

  // --- HORIZONTAL SCROLLING ---
  let playheadPos = f32(uniforms.playheadRow) + uniforms.tickOffset;
  let rowPos = f32(row);
  let dist = rowPos - playheadPos;

  // Culling window (-8 to +48)
  var isActive = 1.0;
  if (dist < -8.0 || dist > 48.0) { isActive = 0.0; }

  // --- POSITIONING & ASPECT RATIO ---
  // To prevent "Too Tall" look, we scale Y based on channel count

  // X Axis (Time)
  let spacingX = 0.07; // Tighter horizontal spacing
  let startX = -0.7;   // Playhead position on screen
  let screenX = startX + (dist * spacingX);

  // Y Axis (Channels)
  // Fit all channels within -0.8 to 0.8
  let safeAreaY = 1.6;
  let chHeight = safeAreaY / f32(max(numChannels, 1u));
  // Center the stack
  let totalH = chHeight * f32(numChannels);
  let startY = -totalH * 0.5 + (chHeight * 0.5);
  let screenY = startY + (f32(channel) * chHeight);

  // --- BRICK SIZE ---
  // Ensure bricks are roughly square/cubic
  // We use the canvas aspect ratio to correct the quad shape
  let aspect = uniforms.canvasW / uniforms.canvasH;
  let baseSize = 0.06; // Global scale of bricks

  let brickW = baseSize;
  let brickH = baseSize * aspect; // Correct for aspect ratio so it's square

  // Clamp height if channels are too dense
  let maxSizeY = chHeight * 0.9;
  if (brickH > maxSizeY) {
      brickH = maxSizeY;
      brickW = brickH / aspect; // Shrink width to maintain squareness
  }

  // Vibrato Effect (Vertical Wiggle)
  var vibOffset = 0.0;
  if (isActive > 0.5 && isVibrato && uniforms.isPlaying == 1u) {
      let speed = 15.0;
      let depth = brickH * 0.5; // Proportional to brick size
      vibOffset = sin(uniforms.timeSec * speed + rowPos) * depth;
  }

  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
  );
  let lp = quad[vertexIndex];

  let finalPos = vec2<f32>(
      screenX + lp.x * brickW * isActive,
      screenY + lp.y * brickH * isActive + vibOffset
  );

  var out: VertexOut;
  out.position = vec4<f32>(finalPos, 0.0, 1.0);
  out.row = row;
  out.channel = channel;
  out.uv = lp * 0.5 + 0.5;
  out.packedA = a;
  out.packedB = b;
  out.dist = dist;
  out.isTremolo = u32(isTremolo);

  return out;
}

// --- FRAGMENT SHADER ---

fn palette(t: f32) -> vec3<f32> {
    // Glassy Palette: Cyan, Magenta, Amber, Blue
    let a = vec3<f32>(0.5, 0.5, 0.5);
    let b = vec3<f32>(0.5, 0.5, 0.5);
    let c = vec3<f32>(1.0, 1.0, 1.0);
    let d = vec3<f32>(0.0, 0.33, 0.67);
    return a + b * cos(6.28318 * (c * t + d));
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
    let noteChar = (in.packedA >> 24) & 255u;
    let inst = in.packedA & 255u;
    let hasNote = (noteChar > 0u);

    let uv = in.uv - 0.5;

    // --- KEY FIX: UNCONDITIONAL SDF CALCULATION ---
    // fwidth must be called in uniform control flow
    // We calculate the shape for every pixel, even if empty
    let boxSize = vec2<f32>(0.42, 0.42);
    let dBox = sdRoundedBox(uv, boxSize, 0.08);
    let aa = fwidth(dBox);
    // ---------------------------------------------

    var color = vec3<f32>(0.02, 0.02, 0.03); // Dark void background
    var alpha = 0.0;

    if (hasNote) {
        let hue = f32(inst) * 0.123 + 0.5;
        var baseColor = palette(hue);

        if (in.isTremolo == 1u && uniforms.isPlaying == 1u) {
            let pulse = 0.5 + 0.5 * sin(uniforms.timeSec * 20.0);
            baseColor += vec3<f32>(pulse * 0.5);
        }

        // Glass Material Shading
        // 1. Soft Fill
        let fill = smoothstep(0.0, -0.1, dBox);

        // 2. Sharp Bevel (Rim)
        let border = 1.0 - smoothstep(0.0, aa * 1.5, dBox);
        let inner = 1.0 - smoothstep(-0.06, -0.06 + aa * 1.5, dBox);
        let rim = border - inner;

        // 3. Inner Gloss/Refraction
        let gloss = smoothstep(0.1, 0.0, length(uv - vec2<f32>(0.1, 0.1)));

        color = mix(color, baseColor * 0.3, fill); // Translucent body
        color = mix(color, baseColor + vec3<f32>(0.4), rim * 0.9); // Bright rim
        color += vec3<f32>(1.0) * gloss * fill * 0.4; // Highlight

        alpha = border;
    } else {
        // Empty Slot: Tiny faint dot
        let dot = 1.0 - smoothstep(0.0, 0.03, length(uv));
        color += vec3<f32>(0.15) * dot;
        alpha = dot * 0.5;
    }

    // --- PLAYHEAD EFFECTS ---
    // Laser Line at x = -0.7 (dist = 0)
    // Map dist to UV space approx to draw line
    let hit = 1.0 - smoothstep(0.0, 0.5, abs(in.dist));

    // Impact Flash
    if (hit > 0.01 && hasNote) {
        color += vec3<f32>(0.8, 0.9, 1.0) * hit * 0.6;
    }

    // Draw the Laser Line (Global)
    // We render this on every tile but fade it based on distance from 0
    let laserW = 0.08;
    let laser = 1.0 - smoothstep(0.0, laserW, abs(in.dist));
    // Dotted line effect
    let laserPattern = step(0.5, sin(uv.y * 20.0));

    color += vec3<f32>(0.0, 1.0, 1.0) * laser * laserPattern * 0.4;

    // Distance Fog
    let fog = clamp(1.0 - (in.dist / 40.0), 0.0, 1.0);
    color *= fog;
    alpha *= fog;

    return vec4<f32>(color * alpha, alpha);
}