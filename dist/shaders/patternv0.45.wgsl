// patternv0.45.wgsl
// Frosted Bloom
// - Instanced rings (like v0.35)
// - Frosted cap material (like v0.43)

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
  @location(5) @interpolate(flat) isUI: u32,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let totalInstances = uniforms.numRows * uniforms.numChannels;
  var out: VertexOut;

  // --- UI PASS (Composite) ---
  if (instanceIndex >= totalInstances) {
      var pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
        vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
      );
      out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
      out.uv = pos[vertexIndex] * vec2<f32>(0.5, -0.5) + 0.5;
      out.isUI = 1u;
      return out;
  }

  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  var ringIndex = channel;
  if (uniforms.invertChannels == 0u) {
      ringIndex = numChannels - 1u - channel;
  }

  let center = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let minDim = min(uniforms.canvasW, uniforms.canvasH);

  let maxRadius = minDim * 0.40; // Reduced from 0.45 to make room for buttons
  let minRadius = minDim * 0.15;
  let ringDepth = (maxRadius - minRadius) / f32(numChannels);

  let radius = minRadius + f32(ringIndex) * ringDepth;

  let totalSteps = 64.0;
  let anglePerStep = 6.2831853 / totalSteps;
  let theta = -1.570796 + f32(row % 64u) * anglePerStep;

  let circumference = 2.0 * 3.14159265 * radius;
  let arcLength = circumference / totalSteps;

  let btnW = arcLength * 0.92;
  let btnH = ringDepth * 0.92;

  let lp = quad[vertexIndex];
  let localPos = (lp - 0.5) * vec2<f32>(btnW, btnH);

  let rotAng = theta + 1.570796;
  let cA = cos(rotAng);
  let sA = sin(rotAng);

  let rotX = localPos.x * cA - localPos.y * sA;
  let rotY = localPos.x * sA + localPos.y * cA;

  let worldX = center.x + cos(theta) * radius + rotX;
  let worldY = center.y + sin(theta) * radius + rotY;

  let clipX = (worldX / uniforms.canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (worldY / uniforms.canvasH) * 2.0;

  let idx = instanceIndex * 2u;
  let a = cells[idx];
  let b = cells[idx + 1u];

  out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
  out.row = row;
  out.channel = channel;
  out.uv = lp;
  out.packedA = a;
  out.packedB = b;
  out.isUI = 0u;
  return out;
}

fn neonPalette(t: f32) -> vec3<f32> {
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

fn toUpperAscii(code: u32) -> u32 {
  return select(code, code - 32u, (code >= 97u) & (code <= 122u));
}

fn pitchClassFromPacked(packed: u32) -> f32 {
  let c0 = toUpperAscii((packed >> 24) & 255u);
  var semitone: i32 = 0;
  var valid = true;
  switch (c0) {
    case 65u: { semitone = 9; }
    case 66u: { semitone = 11; }
    case 67u: { semitone = 0; }
    case 68u: { semitone = 2; }
    case 69u: { semitone = 4; }
    case 70u: { semitone = 5; }
    case 71u: { semitone = 7; }
    default: { valid = false; }
  }
  if (!valid) { return 0.0; }
  let c1 = toUpperAscii((packed >> 16) & 255u);
  if ((c1 == 35u) || (c1 == 43u)) {
    semitone = (semitone + 1) % 12;
  } else if (c1 == 66u) {
    semitone = (semitone + 11) % 12;
  }
  return f32(semitone) / 12.0;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let dimFactor = uniforms.dimFactor;
  let bloom = uniforms.bloomIntensity;
  let isPlaying = (uniforms.isPlaying == 1u);

  let uv = in.uv;

  // --- UI RENDER ---
  if (in.isUI == 1u) {
      let gridBottom = 0.85;
      if (uv.y <= gridBottom) {
          discard;
      }

      var col = vec3<f32>(0.0);
      let aspect = uniforms.canvasW / uniforms.canvasH;
      let ctrlH = 1.0 - gridBottom;
      let ctrlUV = vec2<f32>(uv.x, (uv.y - gridBottom) / ctrlH);

      // Buttons: Loop (Left), Play (Center), Stop (Right)
      let btnY = 0.5;

      // Play
      var pPlay = ctrlUV - vec2<f32>(0.5, btnY);
      pPlay.x *= aspect * (ctrlH / 1.0);
      let dPlay = sdTriangle(pPlay * 4.0, 0.3);
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
      return vec4<f32>(col * dimFactor, 1.0);
  }

  // Frosted Cap Shape
  let dBox = sdRoundedBox(uv - 0.5, vec2<f32>(0.42), 0.1);
  let isCap = dBox < 0.0;

  if (!isCap) {
      discard;
  }

  var capColor = vec3<f32>(0.15, 0.16, 0.18); // Inactive plastic
  var glow = 0.0;

  let noteChar = (in.packedA >> 24) & 255u;
  let hasNote = (noteChar >= 65u && noteChar <= 122u); // Simple check

  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / 64.0) * 64.0;
  let rowDistRaw = abs(f32(in.row % 64u) - playheadStep);
  let rowDist = min(rowDistRaw, 64.0 - rowDistRaw);
  let playheadActivation = 1.0 - smoothstep(0.0, 1.5, rowDist);
  if (hasNote) {
      let pitchHue = pitchClassFromPacked(in.packedA);
      let baseCol = neonPalette(pitchHue);
      capColor = mix(capColor, baseCol, 0.4);

      // Highlight if active row
      if (playheadActivation > 0.0) {
          glow = playheadActivation;
          capColor = mix(capColor, vec3<f32>(1.0), 0.5);
      }

      // Trigger flash
      let ch = channels[in.channel];
      if (ch.trigger > 0u && playheadActivation > 0.5) {
          glow += 1.0;
          capColor += vec3<f32>(0.5);
      }
  }

  // Playhead Highlight Line
  if (playheadActivation > 0.0) {
      capColor += vec3<f32>(0.1, 0.1, 0.15) * playheadActivation;
      if (isPlaying && playheadActivation > 0.5) {
          glow += 0.2;
      }
  }

  // Frosted Effect
  let edge = smoothstep(0.0, 0.1, -dBox);
  let light = vec3<f32>(0.5, -0.8, 1.0);
  let n = normalize(vec3<f32>((uv.x - 0.5), (uv.y - 0.5), 0.5));
  let diff = max(0.0, dot(n, normalize(light)));

  capColor *= (0.5 + 0.5 * diff);
  capColor += vec3<f32>(glow * 0.5);

  // Bloom boost
  if (glow > 0.0) {
      capColor *= (1.0 + bloom);
  }

  return vec4<f32>(capColor * dimFactor, edge);
}
