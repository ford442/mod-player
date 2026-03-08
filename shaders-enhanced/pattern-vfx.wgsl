// Enhanced Pattern Display Shader v1.0
// Features: PBR lighting, bloom, ambient occlusion, specular highlights

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
  gridRect: vec4<f32>,
  // VFX additions
  colorTemp: f32,      // Color temperature (-1 to 1, warm to cool)
  contrast: f32,       // Contrast (0 to 2)
  saturation: f32,     // Saturation (0 to 2)
  vignette: f32,       // Vignette intensity (0 to 1)
  crtEffect: f32,      // CRT scanline intensity (0 to 1)
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

// PBR Material struct
struct PBRMaterial {
  albedo: vec3<f32>,
  metallic: f32,
  roughness: f32,
  ao: f32,        // Ambient occlusion
  emissive: vec3<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) row: u32,
  @location(1) @interpolate(flat) channel: u32,
  @location(2) @interpolate(linear) uv: vec2<f32>,
  @location(3) @interpolate(flat) packedA: u32,
  @location(4) @interpolate(flat) packedB: u32,
  @location(5) @interpolate(linear) worldPos: vec3<f32>,
  @location(6) @interpolate(linear) normal: vec3<f32>,
};

// ========== UTILITY FUNCTIONS ==========

fn hash2(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i + vec2<f32>(0.0, 0.0)), hash2(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash2(i + vec2<f32>(0.0, 1.0)), hash2(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

// ========== PBR LIGHTING ==========

fn fresnelSchlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
  return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

fn distributionGGX(N: vec3<f32>, H: vec3<f32>, roughness: f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let NdotH = max(dot(N, H), 0.0);
  let NdotH2 = NdotH * NdotH;
  let num = a2;
  let denom = (NdotH2 * (a2 - 1.0) + 1.0);
  return num / (3.14159265359 * denom * denom);
}

fn geometrySmith(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, roughness: f32) -> f32 {
  let NdotV = max(dot(N, V), 0.0);
  let NdotL = max(dot(N, L), 0.0);
  let ggx1 = geometrySchlickGGX(NdotV, roughness);
  let ggx2 = geometrySchlickGGX(NdotL, roughness);
  return ggx1 * ggx2;
}

fn geometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
  let r = (roughness + 1.0);
  let k = (r * r) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}

// Calculate PBR lighting
fn calculatePBR(
  material: PBRMaterial,
  N: vec3<f32>,
  V: vec3<f32>,
  L: vec3<f32>,
  lightColor: vec3<f32>,
  lightIntensity: f32
) -> vec3<f32> {
  let H = normalize(V + L);
  
  // Fresnel
  let F0 = mix(vec3<f32>(0.04), material.albedo, material.metallic);
  let F = fresnelSchlick(max(dot(H, V), 0.0), F0);
  
  // Distribution
  let NDF = distributionGGX(N, H, material.roughness);
  
  // Geometry
  let G = geometrySmith(N, V, L, material.roughness);
  
  // Cook-Torrance BRDF
  let numerator = NDF * G * F;
  let denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.001;
  let specular = numerator / denominator;
  
  // Energy conservation
  let kS = F;
  let kD = (vec3<f32>(1.0) - kS) * (1.0 - material.metallic);
  
  // Diffuse
  let NdotL = max(dot(N, L), 0.0);
  let diffuse = material.albedo / 3.14159265359;
  
  // Combine
  let radiance = lightColor * lightIntensity;
  let Lo = (kD * diffuse + specular) * radiance * NdotL;
  
  // Ambient with AO
  let ambient = vec3<f32>(0.03) * material.albedo * material.ao;
  
  return ambient + Lo + material.emissive;
}

// ========== SCREEN-SPACE EFFECTS ==========

// Vignette effect
fn applyVignette(color: vec3<f32>, uv: vec2<f32>, intensity: f32) -> vec3<f32> {
  let center = vec2<f32>(0.5, 0.5);
  let dist = distance(uv, center);
  let vignette = 1.0 - dist * intensity;
  return color * vignette;
}

// CRT scanline effect
fn applyScanlines(color: vec3<f32>, uv: vec2<f32>, intensity: f32, time: f32) -> vec3<f32> {
  let scanline = sin(uv.y * 800.0 + time * 10.0) * 0.5 + 0.5;
  let scan = mix(1.0, scanline, intensity * 0.3);
  return color * scan;
}

// Chromatic aberration
fn applyChromaticAberration(
  tex: texture_2d<f32>,
  sampler: sampler,
  uv: vec2<f32>,
  intensity: f32
) -> vec3<f32> {
  let shift = intensity * 0.01;
  let r = textureSample(tex, sampler, uv + vec2<f32>(shift, 0.0)).r;
  let g = textureSample(tex, sampler, uv).g;
  let b = textureSample(tex, sampler, uv - vec2<f32>(shift, 0.0)).b;
  return vec3<f32>(r, g, b);
}

// Color grading
fn applyColorGrading(color: vec3<f32>, temp: f32, contrast: f32, saturation: f32) -> vec3<f32> {
  // Color temperature
  let warm = vec3<f32>(1.0, 0.9, 0.8);
  let cool = vec3<f32>(0.8, 0.9, 1.0);
  let tempColor = mix(warm, cool, temp * 0.5 + 0.5);
  
  // Apply temperature
  var graded = color * tempColor;
  
  // Contrast
  graded = (graded - 0.5) * contrast + 0.5;
  
  // Saturation
  let luminance = dot(graded, vec3<f32>(0.299, 0.587, 0.114));
  graded = mix(vec3<f32>(luminance), graded, saturation);
  
  return graded;
}

// ========== BLOOM EFFECTS ==========

// Simple bloom threshold
fn bloomThreshold(color: vec3<f32>, threshold: f32) -> vec3<f32> {
  let brightness = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
  return color * max(0.0, brightness - threshold);
}

// ========== VERTEX SHADER ==========

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  let stepsPerPage = 32.0;
  let pageStart = floor(uniforms.playheadRow / stepsPerPage) * stepsPerPage;
  let localRow = f32(row) - pageStart;
  
  // Calculate visibility
  var isVisible = 1.0;
  if (localRow < 0.0 || localRow >= stepsPerPage) {
    isVisible = 0.0;
  }
  
  // Grid positioning
  let effectiveChannel = f32(channel);
  let hasHeader = uniforms.numChannels > 1u && uniforms.gridRect.y > 0.15;
  let dataChannels = f32(uniforms.numChannels) - select(0.0, 1.0, hasHeader);
  let channelIndex = select(effectiveChannel, effectiveChannel - 1.0, hasHeader && effectiveChannel > 0.0);
  
  let gridX = uniforms.gridRect.x + (localRow / stepsPerPage) * uniforms.gridRect.z;
  let gridY = uniforms.gridRect.y + (channelIndex / max(1.0, dataChannels)) * uniforms.gridRect.w;
  
  let cellWidth = uniforms.gridRect.z / stepsPerPage;
  let cellHeight = uniforms.gridRect.w / max(1.0, dataChannels);
  
  // Calculate clip space position
  let clipX = gridX * 2.0 - 1.0 + quad[vertexIndex].x * cellWidth * 2.0;
  let clipY = 1.0 - (gridY * 2.0) - quad[vertexIndex].y * cellHeight * 2.0;
  
  let finalPos = select(vec4<f32>(0.0, 0.0, 0.0, 0.0), vec4<f32>(clipX, clipY, 0.0, 1.0), isVisible > 0.5);

  // Calculate cell data
  let idx = instanceIndex * 2u;
  var a = 0u;
  var b = 0u;
  if (idx + 1u < arrayLength(&cells)) {
    a = cells[idx];
    b = cells[idx + 1u];
  }

  // Calculate normal for PBR (pointing toward camera)
  let normal = vec3<f32>(0.0, 0.0, 1.0);
  
  // World position for lighting
  let worldPos = vec3<f32>(gridX + quad[vertexIndex].x * cellWidth, gridY + quad[vertexIndex].y * cellHeight, 0.0);

  var out: VertexOut;
  out.position = finalPos;
  out.row = row;
  out.channel = channel;
  out.uv = quad[vertexIndex];
  out.packedA = a;
  out.packedB = b;
  out.worldPos = worldPos;
  out.normal = normal;
  
  return out;
}

// ========== FRAGMENT SHADER ==========

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  // Decode cell data
  let note = (in.packedA >> 24u) & 0xFFu;
  let inst = (in.packedA >> 16u) & 0xFFu;
  let volCmd = (in.packedA >> 8u) & 0xFFu;
  let volVal = in.packedA & 0xFFu;
  
  let effCmd = (in.packedB >> 8u) & 0xFFu;
  let effVal = in.packedB & 0xFFu;
  
  let hasNote = note > 0u;
  let hasEffect = effCmd > 0u || effVal > 0u;
  
  // Sample button texture
  let texColor = textureSample(buttonsTexture, buttonsSampler, in.uv);
  
  // Base color from theme
  let baseColor = vec3<f32>(0.1, 0.12, 0.15);
  
  // Playhead distance for glow effect
  let playheadDist = abs(f32(in.row) - uniforms.playheadRow);
  let isNearPlayhead = playheadDist < 2.0;
  let playheadFactor = 1.0 - smoothstep(0.0, 2.0, playheadDist);
  
  // Active channel highlight
  let channelMask = 1u << in.channel;
  let isActiveChannel = (uniforms.activeChannels & channelMask) != 0u;
  
  // Beat trigger flash
  let beatFlash = uniforms.beatPhase * uniforms.kickTrigger;
  
  // PBR Material setup
  var material: PBRMaterial;
  material.albedo = baseColor;
  material.metallic = 0.8;
  material.roughness = 0.3;
  material.ao = 1.0;
  material.emissive = vec3<f32>(0.0);
  
  // Note visualization
  if (hasNote) {
    // Active note - cyan glow
    let noteColor = vec3<f32>(0.0, 0.8, 1.0);
    material.emissive = noteColor * 0.5 * playheadFactor;
    material.albedo = mix(material.albedo, noteColor, 0.3);
  } else if (hasEffect) {
    // Effect - amber
    let effectColor = vec3<f32>(1.0, 0.6, 0.0);
    material.emissive = effectColor * 0.2;
  }
  
  // Playhead highlight
  if (isNearPlayhead) {
    let highlightColor = vec3<f32>(1.0, 0.9, 0.7);
    material.emissive = material.emissive + highlightColor * playheadFactor * 0.3;
  }
  
  // Active channel pulse
  if (isActiveChannel) {
    material.emissive = material.emissive + vec3<f32>(0.1, 0.2, 0.4) * beatFlash;
  }
  
  // PBR lighting calculation
  let N = in.normal;
  let V = normalize(vec3<f32>(0.0, 0.0, 1.0) - in.worldPos);
  
  // Main light (top-right)
  let L1 = normalize(vec3<f32>(1.0, 1.0, 1.0));
  let lightColor1 = vec3<f32>(1.0, 0.98, 0.95);
  let lightIntensity1 = 2.0;
  
  // Rim light (bottom-left, blue-tinted)
  let L2 = normalize(vec3<f32>(-0.5, -0.5, 0.5));
  let lightColor2 = vec3<f32>(0.6, 0.7, 1.0);
  let lightIntensity2 = 0.5;
  
  // Calculate lighting
  var color = calculatePBR(material, N, V, L1, lightColor1, lightIntensity1);
  color = color + calculatePBR(material, N, V, L2, lightColor2, lightIntensity2);
  
  // Apply bloom threshold for bright areas
  let bloom = bloomThreshold(color, uniforms.bloomThreshold) * uniforms.bloomIntensity;
  color = color + bloom;
  
  // Add button texture detail
  color = mix(color, texColor.rgb, texColor.a * 0.5);
  
  // Tone mapping (ACES approximation)
  color = color * (2.51 * color + 0.03) / (2.43 * color + 0.59 * color * color + 0.14);
  
  // Gamma correction
  color = pow(color, vec3<f32>(1.0 / 2.2));
  
  // Apply color grading
  color = applyColorGrading(color, uniforms.colorTemp, uniforms.contrast, uniforms.saturation);
  
  // Apply vignette
  color = applyVignette(color, in.uv, uniforms.vignette);
  
  // Apply CRT scanlines
  color = applyScanlines(color, in.uv, uniforms.crtEffect, uniforms.timeSec);
  
  // Apply dim factor
  color = color * uniforms.dimFactor;
  
  // Alpha
  let alpha = select(0.0, 1.0, hasNote || hasEffect || isNearPlayhead || texColor.a > 0.1);
  
  return vec4<f32>(color, alpha);
}
