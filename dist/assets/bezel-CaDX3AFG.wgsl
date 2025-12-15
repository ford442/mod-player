// bezel.wgsl
// Hardware Bezel Shader - Fullscreen background
// Supports circular recess (for ring shaders) and rounded-rect recess (for grid shaders)

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
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var<uniform> bez: BezelUniforms;

fn hash(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
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
  out.uv = pos * 0.5 + vec2<f32>(0.5, 0.5);
  return out;
}

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let center = vec2<f32>(0.5, 0.5);
    let minDim = min(bez.canvasW, bez.canvasH);
    let aspect = bez.canvasW / max(1.0, bez.canvasH);

    let p = uv - center;
    let p_aspect = vec2<f32>(p.x * aspect, p.y);
    let distCircle = length(vec2<f32>(p.x * (bez.canvasW / minDim), p.y * (bez.canvasH / minDim))) * 0.5;

    var color = vec3<f32>(bez.surfaceR, bez.surfaceG, bez.surfaceB);
    let bezelCol = vec3<f32>(bez.bezelR, bez.bezelG, bez.bezelB);
    let thickness = max(1.0, bez.bezelWidth) / minDim; // normalized

    // Global edge shading
    let edgeShade = smoothstep(0.45, 0.55, length(p));
    color *= 1.0 - edgeShade * 0.12;

    // Recess shape (circle for ring shaders; rounded-rect for grid shaders)
    let outerScale = max(0.5, bez.recessOuterScale);
    let innerScale = max(0.0, bez.recessInnerScale);
    var dRecess: f32;
    var dInner: f32;
    if (bez.recessKind < 0.5) {
      // Circular opening
      let outerR = 0.45 * outerScale;
      let innerR = 0.15 * max(0.0, innerScale);
      dRecess = distCircle - outerR;
      dInner = distCircle - innerR;
    } else {
      // Rounded-rect opening sized to fill wide grids without "cutting through" gaps
      let halfOuter = vec2<f32>(aspect * 0.90 * outerScale, 0.90 * outerScale);
      let cr = max(0.0, bez.recessCorner);
      dRecess = sdRoundedBox(p_aspect, halfOuter, cr);
      if (innerScale > 0.0) {
        let halfInner = vec2<f32>(aspect * 0.90 * outerScale * innerScale, 0.90 * outerScale * innerScale);
        dInner = sdRoundedBox(p_aspect, halfInner, max(0.0, cr - thickness * 0.25));
      } else {
        dInner = 1e6;
      }
    }

    // Bowl/recess shading
    let aa = fwidth(dRecess) * 1.2;
    let recessMask = 1.0 - smoothstep(0.0, aa, dRecess);
    let recessCol = mix(color, color * 0.92, 0.65);
    color = mix(color, recessCol, recessMask);

    // Bezel lip around the opening (this is what you can "enlarge" per-shader)
    let lipOuter = smoothstep(0.0, thickness, dRecess) * (1.0 - smoothstep(thickness, thickness * 4.0, dRecess));
    let lipInner = (1.0 - smoothstep(-thickness * 2.0, 0.0, dRecess)) * smoothstep(-thickness * 6.0, -thickness * 2.0, dRecess);
    color = mix(color, bezelCol, clamp(lipOuter * 0.65 + lipInner * 0.35, 0.0, 1.0));

    // Inner hole (center cut) darkening, only when relevant
    let innerMask = 1.0 - smoothstep(0.0, fwidth(dInner) * 1.2, dInner);
    color = mix(color, color * 0.65, innerMask * 0.8);

    // Subtle speckle texture
    let noise = hash(uv * vec2<f32>(bez.canvasW, bez.canvasH)) * 0.02;
    color += vec3<f32>(noise);

    // Screws (4 corners)
    let screwPos = vec2<f32>(0.08, 0.08);
    let s0 = distance(uv, center + screwPos * vec2<f32>( 1.0,  1.0));
    let s1 = distance(uv, center + screwPos * vec2<f32>( 1.0, -1.0));
    let s2 = distance(uv, center + screwPos * vec2<f32>(-1.0,  1.0));
    let s3 = distance(uv, center + screwPos * vec2<f32>(-1.0, -1.0));
    let screwMask = 1.0 - smoothstep(bez.screwRadius, bez.screwRadius + 0.02, vec4<f32>(s0, s1, s2, s3));
    let screwSum = screwMask.x + screwMask.y + screwMask.z + screwMask.w;
    color = mix(color, vec3<f32>(0.85, 0.85, 0.85), clamp(screwSum, 0.0, 1.0));

    // Vents (top/bottom) - keep subtle and outside the opening
    let ventBand = step(0.20, abs(p.y)) * (1.0 - recessMask);
    let ventX = step(0.01, fract(uv.x * 50.0)) * 0.08;
    color *= 1.0 - ventBand * ventX;

    return vec4<f32>(color, 1.0);
}
