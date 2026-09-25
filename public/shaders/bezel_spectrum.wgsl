// bezel_spectrum.wgsl — hardware bezel whose plate lights up from the GPU FFT
// spectrum (v0.60). Static look is bezel_audio.wgsl / bezel.wgsl; on top of it
// SPECTRUM_CHASSIS_BINS radial bars grow out of the window rim, bass at the
// bottom → treble at the top, mirrored left/right.
//
// Data comes straight from the compute pass's bins buffer (binding 4,
// read-only-storage) — no CPU readback, no AudioReactive uniform. When the
// buffer is the host's zeroed placeholder, or PCM has stopped, every level is 0
// and this renders exactly the static chassis.
//
// Bezel uniform slots 0..15 are shared with bezel.wgsl; slots 16..22 are the
// embedded-UI fields (unused here); slot 23 is `spectrumEnabled`, written by
// frameDraw.ts from the Reactive/Static toggle for spectrum shaders only.

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
  dimFactor: f32,
  isPlaying: f32,
  _ui0: f32,
  _ui1: f32,
  _ui2: f32,
  _ui3: f32,
  _ui4: f32,
  _ui5: f32,
  _ui6: f32,
  spectrumEnabled: f32,
};

@group(0) @binding(0) var<uniform> bez: BezelUniforms;
@group(0) @binding(1) var bezelSampler: sampler;
@group(0) @binding(2) var bezelTexture: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> spectrum: array<f32>;

// lib/spectrum_chassis.wgsl — read the GPU spectrum bins and turn them into
// display levels + colour, for chassis / bezel shaders (v0.60 family).
//
// Include-only. The including shader must declare the storage binding itself
// (the slot is fixed by the host — SPECTRUM_BACKGROUND_BINDING = 4 in
// src/renderers/webgpu/bindGroup.ts):
//
//   @group(0) @binding(4) var<storage, read> spectrum: array<f32>;
//
// `spectrum` holds SPECTRUM_CHASSIS_BINS raw peak FFT magnitudes written by
// compute_analysis.wgsl (`binsOut`): Hann-windowed, coherent-gain normalised so
// a full-scale sine reads ~1.0, log-spaced 20 Hz .. 16 kHz, NOT smoothed. Before
// ComputeAnalysis exists — or after PCM stops — the host binds / writes zeros,
// which this lib maps to level 0, so silence always renders the static chassis.
//
// SPECTRUM_CHASSIS_BINS duplicates SPECTRUM_BIN_COUNT (computeAnalysis.ts and
// lib/spectrum_bands.wgsl); tests/spectrumChassis.test.ts pins all three.

const SPECTRUM_CHASSIS_BINS: u32 = 32u;

/// Display range for the dB mapping. A full-scale sine is 0 dB; quiet tracker
/// mixes put most bins between -60 and -20 dB.
const SPECTRUM_DB_FLOOR: f32 = -72.0;
const SPECTRUM_DB_RANGE: f32 = 60.0;
/// Music falls off with frequency (~-3 dB/oct), so lift the top of the range
/// or the treble bars never leave the floor. Applied linearly in `t`.
const SPECTRUM_TILT_DB: f32 = 14.0;
/// Contrast curve — >1 keeps the floor dark and makes peaks read as peaks.
const SPECTRUM_LEVEL_GAMMA: f32 = 1.35;

/// 20 * log10(x) = SPECTRUM_DB_PER_LOG2 * log2(x); WGSL has no log10.
const SPECTRUM_DB_PER_LOG2: f32 = 6.0205999;

/// Display level in [0, 1] for bin `i` (clamped to the valid range).
/// `t` is the bin's position along the frequency axis in [0, 1], used only for
/// the high-frequency tilt.
fn spectrumLevel(i: i32, t: f32) -> f32 {
    let idx = u32(clamp(i, 0, i32(SPECTRUM_CHASSIS_BINS) - 1));
    let mag = max(spectrum[idx], 1e-5);
    let db = SPECTRUM_DB_PER_LOG2 * log2(mag) + SPECTRUM_TILT_DB * t;
    let lin = clamp((db - SPECTRUM_DB_FLOOR) / SPECTRUM_DB_RANGE, 0.0, 1.0);
    return pow(lin, SPECTRUM_LEVEL_GAMMA);
}

/// Level for the bin under frequency-axis position `t` in [0, 1], stepped
/// (one flat level per bin — reads as discrete LED bars).
fn spectrumLevelAt(t: f32) -> f32 {
    let n = f32(SPECTRUM_CHASSIS_BINS);
    let i = i32(floor(clamp(t, 0.0, 0.9999) * n));
    return spectrumLevel(i, (f32(i) + 0.5) / n);
}

/// Mean level across bins [lo, hi] inclusive — for coarse "bass" / "treble" drivers.
fn spectrumBandLevel(lo: i32, hi: i32) -> f32 {
    let n = f32(SPECTRUM_CHASSIS_BINS);
    var sum = 0.0;
    for (var i: i32 = lo; i <= hi; i = i + 1) {
        sum = sum + spectrumLevel(i, (f32(i) + 0.5) / n);
    }
    return sum / f32(max(1, hi - lo + 1));
}

/// Bass → treble colour ramp (matches the v0.58 reactive palette: cyan, violet, pink).
fn spectrumColor(t: f32) -> vec3<f32> {
    let bass = vec3<f32>(0.0, 0.85, 1.0);
    let mid = vec3<f32>(0.55, 0.3, 1.0);
    let high = vec3<f32>(1.0, 0.45, 0.75);
    return mix(mix(bass, mid, smoothstep(0.0, 0.5, t)), high, smoothstep(0.5, 1.0, t));
}

// Window geometry of public/bezel.png in uv space (y up): centre and per-axis
// radii of the circular window, measured from the image. The plate is the
// bright region outside it.
const WINDOW_CENTER: vec2<f32> = vec2<f32>(0.5, 0.4924);
const WINDOW_RADII: vec2<f32> = vec2<f32>(0.431, 0.455);
/// Mean window radius in uv units — converts the normalised ring distance to uv.
const WINDOW_MEAN_RADIUS: f32 = 0.443;
/// Longest a bar grows past the rim, in uv units.
const BAR_REACH: f32 = 0.065;
const PI: f32 = 3.14159265;

// The two rounded-square buttons on the top corners of bezel.png.
const BUTTON_LEFT: vec2<f32> = vec2<f32>(0.120, 0.894);
const BUTTON_RIGHT: vec2<f32> = vec2<f32>(0.877, 0.894);
const BUTTON_HALF: f32 = 0.026;

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
    let thickness = max(1.0, bez.bezelWidth) / minDim;

    let edgeShade = smoothstep(0.45, 0.55, length(p));
    color *= 1.0 - edgeShade * 0.12;

    let outerScale = max(0.5, bez.recessOuterScale);
    let innerScale = max(0.0, bez.recessInnerScale);
    var dRecess: f32;
    var dInner: f32;
    if (bez.recessKind < 0.5) {
      let outerR = 0.45 * outerScale;
      let innerR = 0.15 * max(0.0, innerScale);
      dRecess = distCircle - outerR;
      dInner = distCircle - innerR;
    } else {
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

    let aa = fwidth(dRecess) * 1.2;
    let recessMask = 1.0 - smoothstep(0.0, aa, dRecess);
    let recessCol = mix(color, color * 0.92, 0.65);
    color = mix(color, recessCol, recessMask);

    let lipOuter = smoothstep(0.0, thickness, dRecess) * (1.0 - smoothstep(thickness, thickness * 4.0, dRecess));
    let lipInner = (1.0 - smoothstep(-thickness * 2.0, 0.0, dRecess)) * smoothstep(-thickness * 6.0, -thickness * 2.0, dRecess);
    color = mix(color, bezelCol, clamp(lipOuter * 0.65 + lipInner * 0.35, 0.0, 1.0));

    let innerMask = 1.0 - smoothstep(0.0, fwidth(dInner) * 1.2, dInner);
    color = mix(color, color * 0.65, innerMask * 0.8);

    let noise = hash(uv * vec2<f32>(bez.canvasW, bez.canvasH)) * 0.02;
    color += vec3<f32>(noise);

    let screwPos = vec2<f32>(0.08, 0.08);
    let s0 = distance(uv, center + screwPos * vec2<f32>( 1.0,  1.0));
    let s1 = distance(uv, center + screwPos * vec2<f32>( 1.0, -1.0));
    let s2 = distance(uv, center + screwPos * vec2<f32>(-1.0,  1.0));
    let s3 = distance(uv, center + screwPos * vec2<f32>(-1.0, -1.0));
    let screwMask = 1.0 - smoothstep(vec4<f32>(bez.screwRadius), vec4<f32>(bez.screwRadius + 0.02), vec4<f32>(s0, s1, s2, s3));
    let screwSum = screwMask.x + screwMask.y + screwMask.z + screwMask.w;
    color = mix(color, vec3<f32>(0.85, 0.85, 0.85), clamp(screwSum, 0.0, 1.0));

    let ventBand = step(0.20, abs(p.y)) * (1.0 - recessMask);
    let ventX = step(0.01, fract(uv.x * 50.0)) * 0.08;
    color *= 1.0 - ventBand * ventX;

    let texSample = textureSampleLevel(bezelTexture, bezelSampler, uv, 0.0);
    let luminance = dot(texSample.rgb, vec3<f32>(0.299, 0.587, 0.114));
    if (texSample.a > 0.01 && luminance < 0.98) {
        color = texSample.rgb;
    }

    // ── Spectrum chassis ──────────────────────────────────────────────────────
    // The plate is near-white, so additive light would clip invisibly: the bars
    // are mixed *into* the plate colour instead, like light shining through it.
    if (bez.spectrumEnabled > 0.5) {
      // Bright plate only: the window (~0.02) and the grey logo / bevel shading (< ~0.7)
      // must stay untouched or the bars paint over the XASM-1 lettering.
      let plate = smoothstep(0.72, 0.88, luminance);

      let q = (uv - WINDOW_CENTER) / WINDOW_RADII;
      let rn = length(q);
      // 0 at the bottom of the window, ±PI at the top → t: 0 = bass, 1 = treble.
      let t = abs(atan2(q.x, -q.y)) / PI;
      let n = f32(SPECTRUM_CHASSIS_BINS);
      let lvl = spectrumLevelAt(t);
      let tint = spectrumColor(t);

      // Distance outward from the window rim, in uv units (negative inside).
      let dOut = (rn - 1.0) * WINDOW_MEAN_RADIUS;

      // Discrete bars with a small gap between neighbours.
      let cell = fract(t * n) - 0.5;
      let barMask = 1.0 - smoothstep(0.34, 0.47, abs(cell));

      let reach = lvl * BAR_REACH;
      let along = clamp(dOut / max(reach, 1e-4), 0.0, 1.0);
      let bar = step(0.0, dOut) * (1.0 - smoothstep(0.55, 1.0, along)) * step(0.004, lvl) * barMask;
      // Soft spill beyond the bar tip + a faint rim line while there is any signal.
      let halo = exp(-max(dOut, 0.0) / (0.012 + reach * 0.6)) * lvl * 0.35 * step(0.0, dOut);
      let rim = exp(-abs(dOut) * 140.0) * lvl * 0.55;

      let alpha = clamp(bar * 0.92 + halo + rim, 0.0, 1.0) * plate;
      color = mix(color, tint, alpha);

      // Corner buttons: left follows the bass bins, right the treble bins.
      let bass = spectrumBandLevel(0, 5);
      let treble = spectrumBandLevel(26, 31);
      let dL = sdRoundedBox(uv - BUTTON_LEFT, vec2<f32>(BUTTON_HALF), 0.008);
      let dR = sdRoundedBox(uv - BUTTON_RIGHT, vec2<f32>(BUTTON_HALF), 0.008);
      let btnL = (1.0 - smoothstep(-0.004, 0.003, dL)) * bass;
      let btnR = (1.0 - smoothstep(-0.004, 0.003, dR)) * treble;
      color = mix(color, spectrumColor(0.0), btnL * 0.85);
      color = mix(color, spectrumColor(1.0), btnR * 0.85);
    }

    return vec4<f32>(color, 1.0);
}
