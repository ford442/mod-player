
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

fn drawChromeIndicator(
    uv: vec2<f32>,
    size: vec2<f32>,
    color: vec3<f32>,
    isOn: bool,
    aa: f32
) -> vec4<f32> {
    // 1. Shapes
    let r = min(size.x, size.y) * 0.45;
    let dBase = sdRoundedBox(uv, size * 0.5, r); // Now this will work!

    // Bezel Thickness
    let bezelW = 0.035;
    let dBezel = dBase + bezelW;

    // 2. Chrome Bezel Rendering
    let angle = atan2(uv.y, uv.x);
    let metalReflect = 0.5 + 0.5 * sin(angle * 8.0 + uv.x * 20.0);
    let ridge = smoothstep(aa, -aa, abs(dBezel + bezelW * 0.5) - bezelW * 0.3);

    let chromeCol = vec3(0.6, 0.65, 0.70) * metalReflect + vec3(0.4) * ridge;

    // 3. Glass Lens Rendering
    let dLens = dBase - 0.005;
    var glassCol = vec3(0.05, 0.06, 0.08);

    if (isOn) {
        let glow = exp(-max(dLens, 0.0) * 12.0);
        glassCol = mix(glassCol, color, 0.8);
        glassCol += color * glow * 1.5;
        glassCol += vec3(1.0) * smoothstep(0.08, 0.0, length(uv * vec2(1.0, 2.0))) * 0.6;
    }

    // 4. Specular Highlight
    let highlightPos = uv - vec2(-size.x * 0.2, -size.y * 0.2);
    let hDist = length(highlightPos) - (min(size.x, size.y) * 0.12);
    let highlight = smoothstep(aa * 2.0, -aa, hDist);
    glassCol = mix(glassCol, vec3(0.95), highlight * 0.7);

    // 5. Compositing
    let bezelMask = smoothstep(aa, -aa, dBezel);
    let lensMask = smoothstep(aa, -aa, dLens);

    var outCol = vec3(0.0);
    outCol = mix(outCol, chromeCol, bezelMask);
    outCol = mix(outCol, vec3(0.02), lensMask);
    outCol = mix(outCol, glassCol, smoothstep(aa, -aa, dBase));

    return vec4(outCol, bezelMask);
}

// --- MAIN FRAGMENT SHADER ---
@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
    let fs = getFragmentConstants();
    let uv = in.uv;
    let p = uv - 0.5; // Centered Cell Coordinates (-0.5 to 0.5)

    // Pixel-perfect AA based on screen derivatives
    let aa = fwidth(p.y) * 0.8;

    // --- INDICATOR RING (Channel 0) ---
    // (Kept simple to focus on the main grid changes, or apply the chrome logic here too if desired)
    if (in.channel == 0u) {
        var col = fs.bgColor * 0.5;
        let onPlayhead = (in.row == uniforms.playheadRow);

        // Use the new Chrome function for the indicator ring too!
        let indSize = vec2(0.3, 0.3);
        let indColor = select(vec3(0.2), fs.ledOnColor, onPlayhead);
        let indLed = drawChromeIndicator(p, indSize, indColor, onPlayhead, aa);

        col = mix(col, indLed.rgb, indLed.a);

        // Playhead Glow Bloom
        if (onPlayhead) {
            col += fs.ledOnColor * 0.5 * exp(-length(p) * 4.0);
        }

        return vec4(col, 1.0);
    }

    // --- PATTERN ROWS (The Main Grid) ---

    // 1. Base Plastic Housing
    let dHousing = sdRoundedBox(p, fs.housingSize * 0.5, 0.06);
    let housingMask = 1.0 - smoothstep(0.0, aa * 2.0, dHousing);

    var finalColor = fs.bgColor;
    // Machined plastic gradient
    finalColor += vec3(0.04) * (0.5 - uv.y);

    // 2. Texture Overlay (Carbon/Plastic Texture)
    let btnScale = 1.05;
    let btnUV = (uv - 0.5) * btnScale + 0.5;
    var inButton = 0.0;

    if (btnUV.x > 0.0 && btnUV.x < 1.0 && btnUV.y > 0.0 && btnUV.y < 1.0) {
        let texColor = textureSampleLevel(buttonsTexture, buttonsSampler, btnUV, 0.0).rgb;
        // Blend texture softly into background
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

        // --- COMPONENT 1: ACTIVITY LIGHT (Top) ---
        // Positioned at top of button
        let topUV = btnUV - vec2(0.5, 0.15);
        let topSize = vec2(0.18, 0.08); // Small pill
        let isActive = (step(0.1, exp(-ch.noteAge * 2.0)) > 0.5) && !isMuted;
        let topColor = vec3(0.0, 0.9, 1.0); // Cyan

        let topLed = drawChromeIndicator(topUV, topSize, topColor, isActive, aa);
        finalColor = mix(finalColor, topLed.rgb, topLed.a);

        // --- COMPONENT 2: MAIN NOTE LIGHT (Middle) ---
        // Positioned in center
        let mainUV = btnUV - vec2(0.5, 0.5);
        let mainSize = vec2(0.55, 0.45); // Large pad

        var noteColor = vec3(0.2); // Default dim grey
        var isNoteOn = false;
        var lightAmount = 0.0;

        if (hasNote) {
            let pitchHue = pitchClassFromPacked(in.packedA);
            let baseColor = neonPalette(pitchHue);
            // Instrument brightness variation
            let instBand = inst & 15u;
            let instBright = 0.8 + (select(0.0, f32(instBand) / 15.0, instBand > 0u)) * 0.2;

            noteColor = baseColor * instBright;

            // Animation Physics
            let flash = f32(ch.trigger) * 0.8;
            let activeLevel = exp(-ch.noteAge * 3.0);
            lightAmount = (activeLevel * 0.8 + flash) * clamp(ch.volume, 0.0, 1.2);

            if (isMuted) { lightAmount *= 0.2; }
            isNoteOn = true; // Always "draw" the note glass, but vary intensity
        }

        // Pass the calculated intensity into the color for the chrome function
        let displayColor = noteColor * max(lightAmount, 0.1); // Keep it dim if not active
        let isLit = (lightAmount > 0.05);

        let mainPad = drawChromeIndicator(mainUV, mainSize, displayColor, isLit, aa);
        finalColor = mix(finalColor, mainPad.rgb, mainPad.a);

        // --- COMPONENT 3: EFFECT LIGHT (Bottom) ---
        let botUV = btnUV - vec2(0.5, 0.85); // Near bottom
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

        // --- COMPONENT 4: PLAYHEAD GLANCE ---
        // Since we are using physical buttons, we simulate a light passing over the plastic
        let rA = i32(in.row);
        let rB = i32(uniforms.playheadRow);

        // Circular wrap distance
        let distDirect = abs(rA - rB);
        let distWrap = 128 - distDirect; // Using 128 as per V0.25 logic
        let rowDist = min(distDirect, distWrap);

        if (rowDist == 0) {
            // A subtle white "glint" over the whole housing when playhead passes
            // This acts like a light attached to the playhead arm
            finalColor += vec3(0.15, 0.2, 0.25) * housingMask * 0.4;
        }
    }

    // Border Gap (Transparent)
    if (housingMask < 0.5) {
        return vec4(fs.borderColor, 0.0);
    }

    return vec4(finalColor, 1.0);
}
