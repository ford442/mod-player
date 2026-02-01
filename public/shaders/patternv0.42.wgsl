struct Uniforms {
  numRows: u32, numChannels: u32, playheadRow: u32, isPlaying: u32,
  cellW: f32, cellH: f32, canvasW: f32, canvasH: f32, tickOffset: f32,
  bpm: f32, timeSec: f32, beatPhase: f32, groove: f32, kickTrigger: f32,
  activeChannels: u32, isModuleLoaded: u32, bloomIntensity: f32, bloomThreshold: f32,
  invertChannels: u32, dimFactor: f32,
};
@group(0) @binding(1) var<uniform> params: Uniforms;

struct VertOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) idx: u32) -> VertOut {
  var v = array<vec2<f32>, 6>(vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(-1.,1.), vec2(1.,-1.), vec2(1.,1.));
  var out: VertOut; out.pos = vec4(v[idx], 0.0, 1.0); out.uv = v[idx] * 0.5 + 0.5; return out;
}

@fragment fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let p = uv - 0.5;
    let r = length(p) * 2.0; // 0..1 (Center to Edge)
    let a = atan2(p.y, p.x);
    
    // Geometry Params matching WebGL Mode 1
    let maxRadius = 0.45 * 2.0; // 0.9 in shader space (since we mult r by 2) -> 0.9
    let minRadius = 0.15 * 2.0; // 0.3

    // Only draw in the track annulus
    if (r < minRadius || r > maxRadius) { return vec4<f32>(0.0); }

    let numTracks = f32(params.numChannels);
    
    // Map radius to Track ID (0..N)
    // r goes from 0.3 to 0.9
    let normR = (r - minRadius) / (maxRadius - minRadius); // 0..1 across band
    let trackVal = normR * numTracks;
    
    // Track Dividers
    let trackLine = 1.0 - smoothstep(0.0, 0.1, abs(fract(trackVal) - 0.5));
    
    // Time Spoke Dividers (64 steps)
    let steps = 64.0;
    // Angle normalized
    let angNorm = fract(a / (6.28318 / steps));
    let spokeLine = 1.0 - smoothstep(0.4, 0.5, abs(angNorm - 0.5));
    
    var col = vec3<f32>(0.25, 0.28, 0.32);
    
    // Add structure
    col += vec3<f32>(0.15) * trackLine;
    col += vec3<f32>(0.05) * spokeLine;

    // Playhead Highlight (Ring)
    let activeRow = params.playheadRow % 64u;
    // Angle for active row starts at -PI/2 (top) and goes clockwise
    // atan2 returns -PI..PI. Top is -PI/2.
    // We need to match the WebGL rotation: theta = -1.57 + row * anglePerStep
    let stepAngle = 6.28318 / steps;
    let currentAngle = -1.570796 + f32(activeRow) * stepAngle;

    // Simple angle distance check
    let diff = abs(atan2(sin(a - currentAngle), cos(a - currentAngle)));
    if (diff < (stepAngle * 0.5)) {
        col += vec3<f32>(0.2, 0.4, 0.5); // Blue highlight wedge
    }

    return vec4<f32>(col, 0.6 * params.dimFactor);
}
