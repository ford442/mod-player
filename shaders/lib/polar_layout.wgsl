// polar_layout.wgsl — shared circular / ring geometry for night-family pattern shaders
// Matches v0.51+ trap-lens polar placement (min 15% / max 45% of min canvas dim).

const POLAR_TAU: f32 = 6.2831853;
const POLAR_NEG_HALF_PI: f32 = -1.5707963;
const POLAR_MIN_RADIUS_FRAC: f32 = 0.15;
const POLAR_MAX_RADIUS_FRAC: f32 = 0.45;
const POLAR_BTN_FILL: f32 = 0.95;
const POLAR_UI_Y_CUTOFF: f32 = 0.88;

struct PolarRingGeom {
  center: vec2<f32>,
  minDim: f32,
  minRadius: f32,
  maxRadius: f32,
  ringDepth: f32,
  radius: f32,
  theta: f32,
  btnW: f32,
  btnH: f32,
}

fn polarRingIndex(channel: u32, numChannels: u32, invertChannels: u32) -> u32 {
  let inverted = numChannels - 1u - channel;
  return select(inverted, channel, invertChannels == 1u);
}

fn polarComputeRing(
  canvasW: f32,
  canvasH: f32,
  row: u32,
  ringIndex: u32,
  numChannels: u32,
  numRows: u32
) -> PolarRingGeom {
  var g: PolarRingGeom;
  g.center = vec2<f32>(canvasW * 0.5, canvasH * 0.5);
  g.minDim = min(canvasW, canvasH);
  g.maxRadius = g.minDim * POLAR_MAX_RADIUS_FRAC;
  g.minRadius = g.minDim * POLAR_MIN_RADIUS_FRAC;
  g.ringDepth = (g.maxRadius - g.minRadius) / f32(numChannels);
  g.radius = g.minRadius + f32(ringIndex) * g.ringDepth;
  let totalSteps = f32(numRows);
  let anglePerStep = POLAR_TAU / totalSteps;
  g.theta = POLAR_NEG_HALF_PI + f32(row % numRows) * anglePerStep;
  let circumference = POLAR_TAU * g.radius;
  let arcLength = circumference / totalSteps;
  g.btnW = arcLength * POLAR_BTN_FILL;
  g.btnH = g.ringDepth * POLAR_BTN_FILL;
  return g;
}

/** Map unit-quad UV (0..1) through ring orientation into canvas pixel space. */
fn polarLocalToWorld(lp: vec2<f32>, g: PolarRingGeom) -> vec2<f32> {
  let localPos = (lp - 0.5) * vec2<f32>(g.btnW, g.btnH);
  let rotAng = g.theta + 1.5707963;
  let cA = cos(rotAng);
  let sA = sin(rotAng);
  let rotX = localPos.x * cA - localPos.y * sA;
  let rotY = localPos.x * sA + localPos.y * cA;
  return vec2<f32>(
    g.center.x + cos(g.theta) * g.radius + rotX,
    g.center.y + sin(g.theta) * g.radius + rotY
  );
}

fn polarWorldToClip(world: vec2<f32>, canvasW: f32, canvasH: f32) -> vec2<f32> {
  let clipX = (world.x / canvasW) * 2.0 - 1.0;
  let clipY = 1.0 - (world.y / canvasH) * 2.0;
  return vec2<f32>(clipX, clipY);
}

fn polarPlayheadAngle(playheadRow: f32, numRows: f32) -> f32 {
  return POLAR_NEG_HALF_PI + (playheadRow / numRows) * POLAR_TAU;
}

fn polarRingRadii(minDim: f32) -> vec2<f32> {
  return vec2<f32>(minDim * POLAR_MIN_RADIUS_FRAC, minDim * POLAR_MAX_RADIUS_FRAC);
}
