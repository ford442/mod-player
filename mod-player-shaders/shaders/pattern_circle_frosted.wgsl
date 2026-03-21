// pattern_circle_frosted.wgsl
// Frosted Glass Circle Shader - Best of v0.48/49 with cleanup
// Features:
// - Concentric ring layout (64 steps)
// - Frosted glass material with subsurface scattering
// - Dual-color lighting: Blue (idle) / Orange (active)
// - Gaussian diffusion (no sharp LED dot)
// - 15 effect visualization support
// - Channel mute visual feedback

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
  padTopChannel: u32,      // If 1, channel 0 is indicator
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
  @location(0) @interpolate(flat) row: u32,
  @location(1) @interpolate(flat) channel: u32,
  @location(2) @interpolate(linear) uv: vec2<f32>,
  @location(3) @interpolate(flat) packedA: u32,
  @location(4) @interpolate(flat) packedB: u32,
};

// ============================================================================
// VERTEX SHADER - Radial Layout (same as other finalized shaders)
// ============================================================================

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  let invertedChannel = numChannels - 1u - channel;
  let ringIndex = select(invertedChannel, channel, uniforms.invertChannels == 1u);

  let center = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let minDim = min(uniforms.canvasW, uniforms.canvasH);

  let maxRadius = minDim * 0.45;
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

  var out: VertexOut;
  out.position = vec4<f32>(clipX, clipY, 0.0, 1.0);
  out.row = row;
  out.channel = channel;
  out.uv = lp;
  out.packedA = a;
  out.packedB = b;
  return out;
}

// ============================================================================
// SDF FUNCTIONS
// ============================================================================

fn sdCircle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

fn sdRoundedBox(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// ============================================================================
// COLOR & LIGHTING
// ============================================================================

fn neonPalette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.0, 0.33, 0.67);
  let beatDrift = uniforms.beatPhase * 0.1;
  return a + b * cos(6.28318 * (c * (t + beatDrift) + d));
}

fn pitchClassFromIndex(note: u32) -> f32 {
  if (note == 0u) { return 0.0; }
  let semi = (note - 1u) % 12u;
  return f32(semi) / 12.0;
}

// Gaussian falloff for frosted diffusion
fn gaussianFalloff(dist: f32, sigma: f32) -> f32 {
  return exp(-(dist * dist) / (2.0 * sigma * sigma));
}

struct LightingResult {
  color: vec3<f32>,
  glow: f32,
  lightColor: vec3<f32>,
}

// Dual-color lighting: Blue (idle) / Orange (active)
fn calculateDualLighting(
  hasNote: bool,
  onPlayhead: bool,
  playheadGlow: f32,
  radialDist: f32,
  note: u32,
  inst: u32,
  ch: ChannelState
) -> LightingResult {
  var result: LightingResult;
  
  let pitchHue = pitchClassFromIndex(note);
  let baseNoteColor = neonPalette(pitchHue);
  let instBand = inst & 15u;
  let instBright = 0.85 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.15;
  
  let linger = exp(-ch.noteAge * 1.2);
  let flash = f32(ch.trigger) * 1.0;
  let beatBoost = 1.0 + uniforms.kickTrigger * 0.5;
  
  var lightAmount = (flash + linger * 2.5) * clamp(ch.volume, 0.0, 1.2) * beatBoost;
  if (ch.isMuted == 1u) { lightAmount *= 0.2; }
  
  // DUAL-COLOR LIGHTING SYSTEM
  if (onPlayhead) {
    // ORANGE FLASH: Playhead crosses note
    result.lightColor = vec3<f32>(1.0, 0.6, 0.1);
    result.glow = playheadGlow * 2.5 + lightAmount;
    result.color = baseNoteColor * instBright;
  } else {
    // BLUE AMBIENT: Note present but idle
    result.lightColor = vec3<f32>(0.2, 0.4, 1.0);
    // Gaussian scatter for scattered light (no sharp dot)
    let scatter = gaussianFalloff(radialDist, 0.6);
    result.glow = 0.7 * scatter + lightAmount * 0.3;
    result.color = baseNoteColor * instBright * 0.85;
  }
  
  return result;
}

// ============================================================================
// FROSTED GLASS RENDERING
// ============================================================================

struct FrostedConstants {
  bgColor: vec3<f32>,
  glassBase: vec3<f32>,
  borderColor: vec3<f32>,
};

fn getFrostedConstants() -> FrostedConstants {
  var c: FrostedConstants;
  c.bgColor = vec3<f32>(0.04, 0.04, 0.05);
  c.glassBase = vec3<f32>(0.12, 0.13, 0.15);
  c.borderColor = vec3<f32>(0.02, 0.02, 0.03);
  return c;
}

fn drawFrostedGlassCap(
  uv: vec2<f32>,
  p: vec2<f32>,
  aa: f32,
  lighting: LightingResult,
  hasNote: bool,
  onPlayhead: bool,
  fc: FrostedConstants
) -> vec4<f32> {
  // Main cap shape (slightly smaller than cell for border)
  let dCap = sdCircle(p, 0.38);
  let capMask = 1.0 - smoothstep(0.0, aa * 2.0, dCap);
  
  if (dCap > aa * 2.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }
  
  let radialDist = length(p) / 0.38; // Normalized 0-1 from center to edge
  
  // Normal for fresnel (approximated from position)
  let n = normalize(vec3<f32>(p.x * 2.0, p.y * 2.0, 0.4));
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  
  // Softer fresnel for frosted look
  let fresnel = pow(1.0 - abs(dot(n, viewDir)), 1.8);
  
  // FROSTED DIFFUSION: Gaussian scatter profile
  let scatterSigma = 0.5;
  let scatterProfile = gaussianFalloff(radialDist, scatterSigma);
  
  // Subsurface thickness
  let thickness = 0.15;
  let subsurface = exp(-thickness * 3.0) * lighting.glow * scatterProfile;
  
  // Glass color mixing
  var glassColor = fc.glassBase;
  
  if (hasNote) {
    // Mix base glass with note color
    glassColor = mix(glassColor, lighting.color, 0.35);
    
    // Add light color based on glow
    glassColor = mix(glassColor, lighting.lightColor, lighting.glow * 0.25);
  }
  
  // Edge alpha with wider smoothstep for softer edge
  let edgeAlpha = smoothstep(-0.12, 0.12, -dCap);
  let alpha = edgeAlpha * (0.6 + 0.4 * fresnel);
  
  // Diffuse lighting
  let lightDir = vec3<f32>(0.5, -0.8, 1.0);
  let diff = max(0.0, dot(n, normalize(lightDir)));
  let litGlass = glassColor * (0.5 + 0.5 * diff);
  
  // Composite with background
  var finalColor = mix(fc.bgColor, litGlass, alpha);
  
  // VOLUME-SCATTERED LIGHT: Fills cap, no sharp dot
  if (hasNote) {
    let volumeScatter = subsurface * lighting.lightColor * 2.5;
    finalColor += volumeScatter * (1.0 - radialDist * 0.25);
    
    // Additional bloom for active notes
    if (onPlayhead && lighting.glow > 1.5) {
      finalColor += lighting.lightColor * (lighting.glow - 1.5) * 0.25;
    }
  }
  
  // Rim highlight
  finalColor += lighting.lightColor * fresnel * lighting.glow * 0.2;
  
  return vec4<f32>(finalColor, capMask);
}

// ============================================================================
// INDICATOR RENDERING (Channel 0 when padTopChannel=1)
// ============================================================================

fn drawIndicator(
  p: vec2<f32>,
  aa: f32,
  playheadActivation: f32,
  fc: FrostedConstants
) -> vec4<f32> {
  let dCircle = sdCircle(p, 0.22);
  let circleMask = 1.0 - smoothstep(0.0, aa * 2.0, dCircle);
  
  if (dCircle > aa * 2.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }
  
  let onPlayhead = playheadActivation > 0.5;
  
  // Dual-color for indicator too
  var indColor: vec3<f32>;
  var glow: f32;
  
  if (onPlayhead) {
    // Orange when active
    indColor = vec3<f32>(1.0, 0.6, 0.1);
    glow = playheadActivation * 2.0;
  } else {
    // Blue idle
    indColor = vec3<f32>(0.2, 0.4, 1.0);
    let radialDist = length(p) / 0.22;
    glow = 0.5 * gaussianFalloff(radialDist, 0.6);
  }
  
  let n = normalize(vec3<f32>(p.x * 4.0, p.y * 4.0, 0.5));
  let fresnel = pow(1.0 - abs(dot(n, vec3<f32>(0.0, 0.0, 1.0))), 2.0);
  
  let edgeAlpha = smoothstep(-0.1, 0.1, -dCircle);
  let alpha = edgeAlpha * (0.7 + 0.3 * fresnel);
  
  var col = mix(fc.bgColor, indColor, alpha);
  
  // Scattered glow
  let radialDist = length(p) / 0.22;
  let scatter = gaussianFalloff(radialDist, 0.5);
  col += indColor * glow * scatter * 1.5;
  
  if (playheadActivation > 0.0) {
    let beatPulse = 1.0 + uniforms.kickTrigger * 0.5;
    col += indColor * uniforms.bloomIntensity * 2.0 * playheadActivation * beatPulse;
  }
  
  return vec4<f32>(col, circleMask);
}

// ============================================================================
// EFFECT DOT RENDERING
// ============================================================================

fn drawEffectDot(
  p: vec2<f32>,
  aa: f32,
  effCmd: u32,
  effVal: u32,
  activeEffect: u32,
  isMuted: bool
) -> vec3<f32> {
  if (isMuted) { return vec3<f32>(0.0); }
  
  let dotPos = vec2<f32>(0.24, 0.24);
  let dDot = sdCircle(p - dotPos, 0.07);
  let dotMask = 1.0 - smoothstep(0.0, aa * 2.0, dDot);
  
  if (dotMask <= 0.0) { return vec3<f32>(0.0); }
  
  var effColor: vec3<f32>;
  
  // Use activeEffect if available (0-15), otherwise fall back to effCmd
  let effectId = select(effCmd, activeEffect, activeEffect > 0u);
  
  if (effectId > 0u) {
    // Color based on effect type
    effColor = neonPalette(f32(effectId) / 16.0);
  } else if (effCmd > 0u) {
    effColor = neonPalette(f32(effCmd) / 32.0);
  } else {
    effColor = vec3<f32>(0.9, 0.9, 0.9);
  }
  
  let strength = clamp(f32(effVal) / 255.0, 0.3, 1.0);
  return effColor * strength * (1.0 + uniforms.bloomIntensity) * dotMask;
}

// ============================================================================
// FRAGMENT SHADER
// ============================================================================

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let p = uv - vec2<f32>(0.5);
  let aa = fwidth(p.y) * 0.5;
  
  if (in.channel >= uniforms.numChannels) { 
    return vec4<f32>(0.0, 0.0, 0.0, 0.0); 
  }
  
  let fc = getFrostedConstants();
  
  // Decode packed data
  let note = (in.packedA >> 24) & 255u;
  let inst = (in.packedA >> 16) & 255u;
  let volCmd = (in.packedA >> 8) & 255u;
  let volVal = in.packedA & 255u;
  let effCmd = (in.packedB >> 8) & 255u;
  let effVal = in.packedB & 255u;
  let activeEffect = (in.packedB >> 24) & 255u; // High byte for effect ID
  
  let ch = channels[in.channel];
  let hasNote = note > 0u;
  let hasEffect = effCmd > 0u || volCmd > 0u || activeEffect > 0u;
  let isMuted = ch.isMuted == 1u;
  
  // Playhead calculation (wider range for diffusion)
  let playheadStep = uniforms.playheadRow - floor(uniforms.playheadRow / 64.0) * 64.0;
  let rowDistRaw = abs(f32(in.row % 64u) - playheadStep);
  let rowDist = min(rowDistRaw, 64.0 - rowDistRaw);
  let playheadActivation = 1.0 - smoothstep(0.0, 2.0, rowDist);
  let onPlayhead = playheadActivation > 0.3;
  
  // Check if this is the indicator channel
  let isIndicatorChannel = (uniforms.padTopChannel == 1u && in.channel == 0u);
  
  var result: vec4<f32>;
  
  if (isIndicatorChannel) {
    result = drawIndicator(p, aa, playheadActivation, fc);
  } else {
    // Calculate lighting
    var lighting: LightingResult;
    if (hasNote) {
      let radialDist = length(p) / 0.38;
      lighting = calculateDualLighting(
        hasNote, onPlayhead, playheadActivation, radialDist,
        note, inst, ch
      );
    } else {
      lighting.color = fc.glassBase;
      lighting.glow = 0.0;
      lighting.lightColor = vec3<f32>(0.0);
    }
    
    // Apply mute dimming
    if (isMuted) {
      lighting.glow *= 0.3;
      lighting.color *= 0.5;
    }
    
    result = drawFrostedGlassCap(uv, p, aa, lighting, hasNote, onPlayhead, fc);
    
    // Add effect dot
    if (hasEffect && !isMuted) {
      let effGlow = drawEffectDot(p, aa, effCmd, effVal, activeEffect, isMuted);
      result.rgb += effGlow;
    }
  }
  
  var col = result.rgb;
  let alpha = result.a;
  
  // Global bloom boost for active elements
  if (onPlayhead && hasNote && !isMuted) {
    col *= (1.0 + uniforms.bloomIntensity * 0.3);
  }
  
  // Kick reactive glow
  let kickPulse = uniforms.kickTrigger * exp(-length(p) * 3.0) * 0.25;
  col += vec3<f32>(0.9, 0.2, 0.4) * kickPulse * uniforms.bloomIntensity;
  
  // Dithering for smooth gradients
  let noise = fract(sin(dot(uv * uniforms.timeSec, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  col += (noise - 0.5) * 0.008;
  
  return vec4<f32>(col, alpha);
}
