
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
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );

  let numChannels = uniforms.numChannels;
  let row = instanceIndex / numChannels;
  let channel = instanceIndex % numChannels;

  let center = vec2<f32>(uniforms.canvasW * 0.5, uniforms.canvasH * 0.5);
  let minDim = min(uniforms.canvasW, uniforms.canvasH);

  let maxRadius = minDim * 0.45;
  let minRadius = minDim * 0.15;
  let ringDepth = (maxRadius - minRadius) / f32(numChannels);

  let radius = minRadius + f32(channel) * ringDepth;

  // 64 steps around the full circle
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

fn effectColorFromCode(code: u32, fallback: vec3<f32>) -> vec3<f32> {
  let c = toUpperAscii(code & 255u);
  switch c {
    case 49u: { return mix(fallback, vec3<f32>(0.2, 0.85, 0.4), 0.75); }
    case 50u: { return mix(fallback, vec3<f32>(0.85, 0.3, 0.3), 0.75); }
    case 52u: { return mix(fallback, vec3<f32>(0.4, 0.7, 1.0), 0.6); }
    case 55u: { return mix(fallback, vec3<f32>(0.9, 0.6, 0.2), 0.6); }
    case 65u: { return mix(fallback, vec3<f32>(0.95, 0.9, 0.25), 0.7); }
    default: { return fallback; }
  }
}

struct FragmentConstants {
  bgColor: vec3<f32>,
  ledOnColor: vec3<f32>,
  ledOffColor: vec3<f32>,
  borderColor: vec3<f32>,
  housingSize: vec2<f32>,
};

fn getFragmentConstants() -> FragmentConstants {
  var c: FragmentConstants;
  // Dark chiclet keys to contrast with the white chassis pass
  c.bgColor = vec3<f32>(0.15, 0.16, 0.18);
  c.ledOnColor = vec3<f32>(0.0, 0.85, 0.95);
  c.ledOffColor = vec3<f32>(0.08, 0.08, 0.10);
  c.borderColor = vec3<f32>(0.0, 0.0, 0.0);
  c.housingSize = vec2<f32>(0.92, 0.92);
  return c;
}

// --- 2. CHROME & GLASS RENDERING (Depends on sdRoundedBox) ---

// Physical glass + bezel model (lens dome, normals, diffuse+specular)
// Also includes a small metal bezel pass when outside the lens radius.
// The function expects `uv` in centered coordinates (e.g., -0.5..0.5) and `size` in UV units.
fn drawChromeIndicator(
    uv: vec2<f32>,
    size: vec2<f32>,
    color: vec3<f32>,
    isOn: bool,
    aa: f32
) -> vec4<f32> {
    // Convert from centered coordinates (-0.5..0.5) into 0..1 quad space
    let uv01 = (uv / size) + vec2<f32>(0.5);

    // Geometry radii (normalized in 0..1 space where 0 = center, 1 = outer)
    let lensR = 0.7;   // inner dome radius
    let bezelR = 0.9;  // bezel outer radius
    let center = vec2<f32>(0.5, 0.5);

    // Normalized radial distance (0 at center, ~1 at edge of quad)
    let dist = length(uv01 - center) * 2.0;

    var col = vec3<f32>(0.0);
    var alpha = 0.0;

    if (dist < bezelR) {
        if (dist > lensR) {
            // BEZEL (metal)
            // subtle angular specular to give a machined rim
            let angle = atan2(uv01.y - center.y, uv01.x - center.x);
            let rim = 0.2 + 0.8 * abs(sin(angle * 10.0));
            col = vec3<f32>(0.25, 0.28, 0.30) * rim; // dark metal
            alpha = 1.0;
        } else {
            // LENS (dome)
            let lensNormR = dist / lensR;
            // Dome height (z) for a unit hemisphere
            let z = sqrt(max(0.0, 1.0 - lensNormR * lensNormR));

            // Reconstruct normal in local lens space (scale xy by lensR)
            let localXY = (uv01 - center) / lensR;
            let normal = normalize(vec3<f32>(localXY.x, localXY.y, z));

            // Lighting
            let lightDir = normalize(vec3<f32>(-0.5, 0.5, 1.0));
            let diffuse = max(0.0, dot(normal, lightDir));
            let reflectDir = reflect(-lightDir, normal);
            let specular = pow(max(0.0, dot(reflectDir, vec3<f32>(0.0, 0.0, 1.0))), 10.0);

            // Combine
            let baseColor = color;
            col = baseColor * (0.5 + 0.8 * diffuse);
            col += vec3<f32>(1.0) * specular * 0.5;

            // Soft bloom inside the lens
            let rimGlow = exp(-pow(lensNormR, 2.0) * 6.0);
            col += baseColor * rimGlow * 0.25;

            alpha = 1.0;
        }
    } else {
        // Outside bezel: transparent / discard-like behavior
        return vec4<f32>(vec3<f32>(0.0), 0.0);
    }

    // Soft vignette near bezel to blend into housing
    let vignette = smoothstep(bezelR * 0.95, bezelR, dist);
    col = mix(col * (1.0 - 0.08 * vignette), vec3<f32>(0.02), vignette);

    return vec4<f32>(col, alpha);
}

// ---------------------------
// WebGL2 Vertex Shader Snippet (GLSL adaptation):
// Placed here for reference: adapt "Energy Trail" maths to your WebGL2 vertex shader.
//
// // In your WebGL2 Vertex Shader
// // OLD: Linear distance check
// // float dist = abs(xOffset - blipPos);
// // float activeVal = 1.0 - smoothstep(0.0, 0.15, dist);
//
// // NEW: Energy Trail Logic (Adapted from WGSL)
// float dx = xOffset - blipPos; // Signed distance
// // 1. The "Spark" (Inverse square law for hot core)
// float coreDist = abs(dx);
// float energy = 0.01 / (coreDist + 0.01); // Tuned for LED spacing
// // 2. The "Tail" (Exponential decay only behind the movement)
// // Assuming movement is positive-x. If direction changes, flip sign of dx.
// float directionSign = (speed > 0.0) ? 1.0 : -1.0;
// float trail = exp(-8.0 * max(0.0, -dx * directionSign));
// // Combine them
// float activeVal = clamp(pow(energy, 1.5) + trail, 0.0, 1.0);
// // Use activeVal to mix colors as before...
// ---------------------------
@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let fs = getFragmentConstants();
  let uv = in.uv;
  let p = uv - 0.5; // Centered Cell Coordinates (-0.5 to 0.5)

  // Pixel-perfect AA based on screen derivatives
  let aa = fwidth(p.y) * 0.8;

  // --- INDICATOR RING (Channel 0) ---
  // MODIFIED: Background is now transparent (alpha 0.0) unless the LED is drawn
  if (in.channel == 0u) {
    let onPlayhead = (in.row == uniforms.playheadRow);

    // Use the Chrome function for the indicator ring
    let indSize = vec2(0.3, 0.3);
    let indColor = select(vec3(0.2), fs.ledOnColor, onPlayhead);

    // drawChromeIndicator returns alpha 1.0 inside the bezel, 0.0 outside
    let indLed = drawChromeIndicator(p, indSize, indColor, onPlayhead, aa);

    var col = indLed.rgb;
    var alpha = indLed.a;

    // Playhead Glow Bloom
    if (onPlayhead) {
      // Calculate bloom color
      let glow = fs.ledOnColor * 0.5 * exp(-length(p) * 4.0);
      col += glow;

      // Ensure the bloom is visible by boosting alpha slightly where glow is strong
      // (This prevents the glow from being clipped by alpha=0.0 regions)
      alpha = max(alpha, smoothstep(0.0, 0.2, length(glow)));
    }

    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
  }

  // --- PATTERN ROWS (The Main Grid) ---
  // (This logic remains unchanged, handling the main button grid)

  // 1. Base Plastic Housing
  let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
  let housingMask = 1.0 - smoothstep(0.0, aa * 2.0, dHousing);

  var finalColor = fs.bgColor;
  // Machined plastic gradient
  finalColor += vec3(0.04) * (0.5 - uv.y);

  // 2. Texture Overlay
  let btnScale = 1.05;
  let btnUV = (uv - 0.5) * btnScale + 0.5;
  var inButton = 0.0;

  if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
    let texColor = textureSampleLevel(buttonsTexture, buttonsSampler, btnUV, 0.0).rgb;
    finalColor = mix(finalColor, texColor * 0.5, 0.8);
    inButton = 1.0;
  }

  // --- CHROME HARDWARE INDICATORS ---
  if (inButton > 0.5) {
    // Data Extraction
    let noteChar = (in.packedA >> 24) & 255u;
    let inst = in.packedA & 255u;
    let effCode = (in.packedB >> 8) & 255u;
    let effParam = in.packedB & 255u;

    let hasNote = (noteChar >= 65u && noteChar <= 71u);
    let hasEffect = (effParam > 0u);
    let ch = channels[in.channel];
    let isMuted = (ch.isMuted == 1u);

    // COMPONENT 1: ACTIVITY LIGHT
    let topUV = btnUV - vec2(0.5, 0.15);
    let topSize = vec2(0.18, 0.08);
    let isActive = (step(0.1, exp(-ch.noteAge * 2.0)) > 0.5) && !isMuted;
    let topColor = vec3(0.0, 0.9, 1.0);

    let topLed = drawChromeIndicator(topUV, topSize, topColor, isActive, aa);
    finalColor = mix(finalColor, topLed.rgb, topLed.a);

    // COMPONENT 2: MAIN NOTE LIGHT
    let mainUV = btnUV - vec2(0.5, 0.5);
    let mainSize = vec2(0.55, 0.45);

    var noteColor = vec3(0.2);
    var lightAmount = 0.0;
    var isNoteOn = false;

    if (hasNote) {
      let pitchHue = pitchClassFromPacked(in.packedA);
      let baseColor = neonPalette(pitchHue);
      let instBand = inst & 15u;
      let instBright = 0.8 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.2;
      noteColor = baseColor * instBright;

      let flash = f32(ch.trigger) * 0.8;

      var d = f32(in.row) + uniforms.tickOffset - f32(uniforms.playheadRow);
      let totalSteps = 64.0;
      if (d > totalSteps * 0.5) { d = d - totalSteps; }
      if (d < -totalSteps * 0.5) { d = d + totalSteps; }

      let dx = d;
      let coreDist = abs(dx);
      let energy = 0.02 / (coreDist + 0.001);
      let directionSign = 1.0;
      let trail = exp(-10.0 * max(0.0, -dx * directionSign));
      let activeVal = clamp(pow(energy, 1.5) + trail, 0.0, 1.0);

      lightAmount = (activeVal * 0.8 + flash) * clamp(ch.volume, 0.0, 1.2);
      if (isMuted) { lightAmount *= 0.2; }
      isNoteOn = true;
    }

    let displayColor = noteColor * max(lightAmount, 0.1);
    let isLit = (lightAmount > 0.05);
    let mainPad = drawChromeIndicator(mainUV, mainSize, displayColor, isLit, aa);
    finalColor = mix(finalColor, mainPad.rgb, mainPad.a);

    // COMPONENT 3: EFFECT LIGHT
    let botUV = btnUV - vec2(0.5, 0.85);
    let botSize = vec2(0.18, 0.08);

    var effColor = vec3(0.0);
    var isEffOn = false;

    if (hasEffect) {
      effColor = effectColorFromCode(effCode, vec3(0.9, 0.8, 0.2));
      let strength = clamp(f32(effParam) / 255.0, 0.2, 1.0);
      if (!isMuted) {
        effColor *= strength;
        isEffOn = true;
      }
    }

    let botLed = drawChromeIndicator(botUV, botSize, effColor, isEffOn, aa);
    finalColor = mix(finalColor, botLed.rgb, botLed.a);

    // COMPONENT 4: PLAYHEAD GLANCE
    let rA = i32(in.row);
    let rB = i32(uniforms.playheadRow);
    let distDirect = abs(rA - rB);
    let distWrap = 128 - distDirect;
    let rowDist = min(distDirect, distWrap);

    if (rowDist == 0) {
      finalColor += vec3(0.15, 0.2, 0.25) * housingMask * 0.4;
    }
  }

  // Border Gap (Transparent)
  if (housingMask < 0.5) {
    return vec4(fs.borderColor, 0.0);
  }

  return vec4(finalColor, 1.0);
}
