//#include "lib/color_preserve.wgsl"
fn calculateTopIntensity(
  isNoteOn: bool,
  isExprOnly: bool,
  isSustain: bool,
  isMuted: bool,
  trigger: u32,
  bloom: f32,
  beat: f32
) -> f32 {
  var intensity = 0.0;
  if (isNoteOn) {
    intensity = 1.0 + bloom * 2.0;
    if (trigger > 0u) { intensity += beat * 0.3; }
  } else if (isExprOnly) {
    intensity = 1.0 + bloom * 2.0;
  } else if (isSustain) {
    intensity = 0.1 + bloom * 0.2;
  }
  if (isMuted) { intensity *= 0.2; }
  return intensity;
}
