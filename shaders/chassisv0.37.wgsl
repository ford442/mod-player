// chassisv0.37.wgsl
// White Hardware Chassis Pass (fullscreen) + Global UI Controls (Play/Stop/etc)
// Drawn via the existing background pass slot (uniform @binding(0)).

struct BezelUniforms {
  canvasW: f32,
  canvasH: f32,
  bezelWidth: f32,
  surfaceR: f32,
  surfaceG: f32,
  surfaceB: f32,
  bezelR: f32,
  bezelG: f32,
  bezelB: f32,
  screwRadius: f32,
  recessKind: f32,
  recessOuterScale: f32,
  recessInnerScale: f32,
  recessCorner: f32,
  dimFactor: f32,   // 1.0 = Stop, 0.35 = Playing (Night Mode) - We can invert logic if needed
  _pad1: f32,
};

@group(0) @binding(0) var<uniform> bez: BezelUniforms;
@group(0) @binding(1) var bezelSampler: sampler;
@group(0) @binding(2) var bezelTexture: texture_2d<f32>;

fn hash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
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
    p2.x = p2.x - clamp(p2.x, -2.0 * r, 0.0);
    return -length(p2) * sign(p2.y);
}

fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

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
  // Centered normalized coordinates
  let p = uv - 0.5; // -0.5 to 0.5
  let aa = 1.0 / bez.canvasH; // approx pixel width for AA

  // Hardware palette (Dark Theme)
  let colPlastic = vec3<f32>(0.08, 0.08, 0.10);
  let colRecess = vec3<f32>(0.05, 0.05, 0.06);

  // Base Chassis
  var color = colPlastic;

  // Use the Bezel Texture if available
  let texSample = textureSampleLevel(bezelTexture, bezelSampler, uv, 0.0);
  // Simple check to use texture if it's not empty/transparent
  if (texSample.a > 0.1) {
    color = mix(color, texSample.rgb, texSample.a);
  } else {
    // Procedural fallback (Circular Recess)
    let dist = length(p);
    let maxRadius = 0.45;
    let minRadius = 0.15;

    if (dist < maxRadius + 0.02 && dist > minRadius - 0.02) {
        color = colRecess;
        // Subtle tracks
        let track = sin(dist * 200.0);
        color -= vec3<f32>(0.01) * track;
    }
  }

  // --- UI CONTROLS ---
  // Coordinate system: p is -0.5 to 0.5.
  // WebGPU UV (0,0) is usually Bottom-Left in clip-space generation (vs output).
  // So p.y = -0.5 is Bottom.

  let barY = -0.45; // Bottom of screen (shifted down from -0.42)

  // 1. Song Position Bar
  let barWidth = 0.8;
  let barHeight = 0.03;
  let dBarRail = sdRoundedBox(p - vec2<f32>(0.0, barY), vec2<f32>(barWidth * 0.5, barHeight * 0.5), 0.005);

  if (dBarRail < 0.0) {
      color = mix(color, vec3<f32>(0.2, 0.2, 0.25), 0.9);
  }

  // 2. Buttons
  // Place buttons slightly above the bar (higher Y value)
  let btnY = barY + 0.05; // -0.40 (Lower than previous -0.36)
  let btnRadius = 0.035;

  // Play (Triangle) - Scooted out to -0.13
  let posPlay = vec2<f32>(-0.13, btnY);
  let dPlayBg = sdCircle(p - posPlay, btnRadius);
  if (dPlayBg < 0.0) {
      var btnCol = vec3<f32>(0.15); // Dark grey off

      // Check 'isPlaying' state via dimFactor hack
      // In PatternDisplay: buf[14] = isPlaying ? 0.35 : 1.0;
      // So if dimFactor < 0.5, we are playing.
      let isPlaying = bez.dimFactor < 0.5;

      let dIcon = sdTriangle((p - posPlay) * vec2<f32>(1.0, -1.0) * 1.5, btnRadius * 0.4);
      if (dIcon < 0.0) {
        btnCol = select(
            vec3<f32>(0.2, 0.6, 0.2),
            vec3<f32>(0.2, 1.0, 0.4),
            isPlaying
        );
      }

      let mask = smoothstep(0.0, aa * 2.0, -dPlayBg);
      color = mix(color, btnCol, mask);

      // Outline ring
      let dRing = abs(dPlayBg) - 0.002;
      let ringMask = 1.0 - smoothstep(0.0, aa * 2.0, dRing);
      color = mix(color, vec3<f32>(0.05), ringMask * 0.5);
  }

  // Stop (Square) - Scooted out to 0.13
  let posStop = vec2<f32>(0.13, btnY);
  let dStopBg = sdCircle(p - posStop, btnRadius);
  if (dStopBg < 0.0) {
      var btnCol = vec3<f32>(0.15);
      let dIcon = sdBox(p - posStop, vec2<f32>(btnRadius * 0.35));
      if (dIcon < 0.0) {
         btnCol = vec3<f32>(0.8, 0.2, 0.2);
      }
      let mask = smoothstep(0.0, aa * 2.0, -dStopBg);
      color = mix(color, btnCol, mask);

      let dRing = abs(dStopBg) - 0.002;
      let ringMask = 1.0 - smoothstep(0.0, aa * 2.0, dRing);
      color = mix(color, vec3<f32>(0.05), ringMask * 0.5);
  }

  // Loop (Circle/Ring) - Scooted out to -0.32
  let posLoop = vec2<f32>(-0.32, btnY);
  let dLoopBg = sdCircle(p - posLoop, btnRadius);
  if (dLoopBg < 0.0) {
      var btnCol = vec3<f32>(0.15);
      let dIconOuter = sdCircle(p - posLoop, btnRadius * 0.4);
      let dIconInner = sdCircle(p - posLoop, btnRadius * 0.25);
      let ring = max(dIconOuter, -dIconInner);
      if (ring < 0.0) {
         btnCol = vec3<f32>(0.9, 0.6, 0.1);
      }
      let mask = smoothstep(0.0, aa * 2.0, -dLoopBg);
      color = mix(color, btnCol, mask);

      let dRing = abs(dLoopBg) - 0.002;
      let ringMask = 1.0 - smoothstep(0.0, aa * 2.0, dRing);
      color = mix(color, vec3<f32>(0.05), ringMask * 0.5);
  }

  // Open (Arrow) - Scooted out to 0.32
  let posOpen = vec2<f32>(0.32, btnY);
  let dOpenBg = sdCircle(p - posOpen, btnRadius);
  if (dOpenBg < 0.0) {
      var btnCol = vec3<f32>(0.15);
      let iconOff = p - posOpen;
      let tri = sdTriangle((iconOff - vec2<f32>(0.0, -0.01)) * 1.8, btnRadius * 0.3);
      let stem = sdBox(iconOff - vec2<f32>(0.0, 0.015), vec2<f32>(0.006, 0.015));
      let arrow = min(tri, stem);
      if (arrow < 0.0) {
         btnCol = vec3<f32>(0.2, 0.5, 0.9);
      }
      let mask = smoothstep(0.0, aa * 2.0, -dOpenBg);
      color = mix(color, btnCol, mask);

      let dRing = abs(dOpenBg) - 0.002;
      let ringMask = 1.0 - smoothstep(0.0, aa * 2.0, dRing);
      color = mix(color, vec3<f32>(0.05), ringMask * 0.5);
  }

  // NIGHT MODE DIMMING
  // Apply uniform dimming to the whole chassis
  let dim = max(0.2, bez.dimFactor);
  color *= dim;

  return vec4<f32>(color, 1.0);
}
