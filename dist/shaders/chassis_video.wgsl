struct BezelUniforms {
  canvasW: f32, canvasH: f32, bezelWidth: f32, surfaceR: f32, surfaceG: f32, surfaceB: f32,
  bezelR: f32, bezelG: f32, bezelB: f32, screwRadius: f32, recessKind: f32,
  recessOuterScale: f32, recessInnerScale: f32, recessCorner: f32, dimFactor: f32,
  isPlaying: f32, volume: f32, pan: f32, bpm: f32, isLooping: u32,
  currentOrder: u32, currentRow: u32, clickedButton: u32, _pad2: f32,
};
@group(0) @binding(0) var<uniform> bez: BezelUniforms;

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
fn sdTriangle(p: vec2<f32>, r: f32) -> f32 {
    let k = sqrt(3.0);
    var p2 = p;
    p2.x = abs(p2.x) - r; p2.y = p2.y + r / k;
    if (p2.x + k * p2.y > 0.0) { p2 = vec2<f32>(p2.x - k * p2.y, -k * p2.x - p2.y) / 2.0; }
    p2.x = p2.x - clamp(p2.x, -2.0 * r, 0.0);
    return -length(p2) * sign(p2.y);
}
fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
    let d = abs(p) - b; return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

struct VertOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) idx: u32) -> VertOut {
  var v = array<vec2<f32>, 6>(vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(-1.,1.), vec2(1.,-1.), vec2(1.,1.));
  var out: VertOut; out.pos = vec4(v[idx], 0.0, 1.0); out.uv = v[idx] * 0.5 + 0.5; return out;
}

@fragment fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let p = uv - 0.5;
    let aa = 1.5 / bez.canvasH;
    
    // --- 1. CHASSIS (Slim White) ---
    var col = vec3<f32>(0.92, 0.93, 0.94); // Polar White
    
    // The Screen Window (Large)
    let screenBox = sdRoundedBox(p - vec2<f32>(0.0, 0.1), vec2<f32>(0.46, 0.375), 0.01);
    let screenMask = smoothstep(aa, -aa, screenBox);
    
    // Dark inner fill
    col = mix(col, vec3<f32>(0.1), screenMask);
    
    // --- 2. CONTROLS (Bottom Strip) ---
    // Play (Green)
    let pPlay = p - vec2<f32>(-0.1, -0.4);
    let playBg = sdRoundedBox(pPlay, vec2<f32>(0.04, 0.03), 0.01);
    let playIcon = sdTriangle(pPlay * vec2<f32>(1.0,-1.0) * 1.5, 0.015);
    var btnCol = vec3<f32>(0.2, 0.2, 0.2);
    if (bez.isPlaying > 0.5) { btnCol = vec3<f32>(0.2, 1.0, 0.4); } // Lit Green
    col = mix(col, btnCol, smoothstep(aa, -aa, playBg));
    col = mix(col, vec3<f32>(1.0), smoothstep(aa, -aa, playIcon));

    // Stop (Red)
    let pStop = p - vec2<f32>(0.1, -0.4);
    let stopBg = sdRoundedBox(pStop, vec2<f32>(0.04, 0.03), 0.01);
    let stopIcon = sdBox(pStop, vec2<f32>(0.012));
    btnCol = vec3<f32>(0.2, 0.2, 0.2);
    if (bez.isPlaying < 0.5) { btnCol = vec3<f32>(1.0, 0.2, 0.2); } // Lit Red
    col = mix(col, btnCol, smoothstep(aa, -aa, stopBg));
    col = mix(col, vec3<f32>(1.0), smoothstep(aa, -aa, stopIcon));

    return vec4<f32>(col, 1.0);
}
