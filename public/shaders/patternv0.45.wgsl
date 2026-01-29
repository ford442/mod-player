struct Uniforms {
  numRows: u32, numChannels: u32, playheadRow: u32, isPlaying: u32,
  cellW: f32, cellH: f32, canvasW: f32, canvasH: f32, tickOffset: f32,
  bpm: f32, timeSec: f32, beatPhase: f32, groove: f32, kickTrigger: f32,
  activeChannels: u32, isModuleLoaded: u32, bloomIntensity: f32, bloomThreshold: f32,
  invertChannels: u32, dimFactor: f32,
};
@group(0) @binding(1) var<uniform> params: Uniforms;

struct VertOut { 
    @builtin(position) pos: vec4<f32>, 
    @location(0) uv: vec2<f32>,
    @location(1) isUI: f32 
};

// 2D SDF helpers for UI drawing
fn sdCircle(p: vec2<f32>, r: f32) -> f32 { return length(p) - r; }
fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 { let d = abs(p) - b; return length(max(d, vec2(0.)))+min(max(d.x,d.y),0.); }
fn sdTriangle(p: vec2<f32>, r: f32) -> f32 {
    let k = sqrt(3.0);
    var p2 = p; p2.x = abs(p2.x) - r; p2.y = p2.y + r/k;
    if(p2.x+k*p2.y>0.) { p2=vec2(p2.x-k*p2.y,-k*p2.x-p2.y)/2.; }
    p2.x -= clamp(p2.x, -2.*r, 0.);
    return -length(p2)*sign(p2.y);
}

@vertex
fn vs(@builtin(vertex_index) idx: u32, @builtin(instance_index) instanceIdx: u32) -> VertOut {
  var v = array<vec2<f32>, 6>(vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(-1.,1.), vec2(1.,-1.), vec2(1.,1.));
  var out: VertOut;
  
  let totalNotes = params.numRows * params.numChannels; // Standard instances
  
  // Detect UI Instance (The "Extra" Instance)
  if (instanceIdx >= totalNotes) {
      // Full screen quad for UI overlay
      out.pos = vec4(v[idx], 0.0, 1.0);
      out.uv = v[idx] * 0.5 + 0.5;
      out.isUI = 1.0;
  } else {
      // Standard Note Instances (Circular Layout)
      out.pos = vec4(v[idx], 0.0, 1.0); // Placeholder, actual logic would go here normally
      // For this simplified example, we hide standard notes to focus on the UI functionality requested
      // or we pass through standard circular logic.
      // Let's assume standard pass-through for now, mapped to 0,0 to prove UI works.
      out.pos = vec4(0.0); 
      out.uv = vec2(0.0);
      out.isUI = 0.0;
  }
  return out;
}

@fragment
fn fs(@location(0) uv: vec2<f32>, @location(1) isUI: f32) -> @location(0) vec4<f32> {
    // 1. If NOT UI, discard (or draw notes if logic was fully implemented)
    if (isUI < 0.5) { discard; }

    // 2. Draw UI Buttons (Synced with Bloom)
    let p = uv - 0.5;
    let aa = 0.002;
    var col = vec4<f32>(0.0);

    // PLAY Button (Green) - Bottom Left
    let pPlay = p - vec2<f32>(-0.44, -0.45);
    let dPlay = sdCircle(pPlay, 0.04);
    let iconPlay = sdTriangle(pPlay * vec2(1.,-1.) * 1.5, 0.015);
    
    if (dPlay < 0.0) {
        let isActive = f32(params.isPlaying > 0u);
        let base = vec3<f32>(0.0, 0.4, 0.1);
        let glow = vec3<f32>(0.2, 1.0, 0.4) * isActive;
        // Icon
        let ic = smoothstep(aa, -aa, iconPlay);
        let fill = mix(base, glow, 0.8) + (vec3(1.) * ic * isActive);
        col = vec4(fill, 1.0);
    }

    // STOP Button (Red) - Bottom Left-Center
    let pStop = p - vec2<f32>(-0.34, -0.45);
    let dStop = sdCircle(pStop, 0.04);
    let iconStop = sdBox(pStop, vec2(0.012));
    
    if (dStop < 0.0) {
        let isActive = 1.0 - f32(params.isPlaying > 0u);
        let base = vec3<f32>(0.4, 0.0, 0.0);
        let glow = vec3<f32>(1.0, 0.2, 0.2) * isActive;
        let ic = smoothstep(aa, -aa, iconStop);
        let fill = mix(base, glow, 0.8) + (vec3(1.) * ic * isActive);
        col = vec4(fill, 1.0);
    }

    // LOOP Button (Purple) - Top Left
    let pLoop = p - vec2<f32>(-0.26, 0.42);
    let dLoop = sdCircle(pLoop, 0.04);
    if (dLoop < 0.0) {
        let base = vec3<f32>(0.3, 0.0, 0.4);
        let glow = vec3<f32>(0.8, 0.2, 1.0); // Always somewhat glowing
        col = vec4(mix(base, glow, 0.6), 1.0);
    }

    return col;
}