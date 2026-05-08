// ============================================================
// patternv0.40.wgsl — Source file
// Minimal circular pattern with neon palette
//
// Assembled via build-shaders.mjs from:
//   #include "common.wgsl"
//   #include "sdf_primitives.wgsl"
//   #include "color_palettes.wgsl"
//   #include "bloom_effects.wgsl"
// ============================================================

#include "common.wgsl"
#include "sdf_primitives.wgsl"
#include "color_palettes.wgsl"
#include "bloom_effects.wgsl"

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  // Compute derivatives in uniform control flow (before any early returns)
  let uv = in.uv;
  let p = uv - vec2<f32>(0.5, 0.5);
  let aa = fwidth(p.y) * 0.75;

  if (in.channel >= uniforms.numChannels) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }
  let fs = getFragmentConstants();

  if (in.channel == 0u) {
    var col = fs.bgColor * 0.8;
    return vec4<f32>(col, 1.0);
  }

  let dBox = sdRoundedBox(p, vec2<f32>(0.45, 0.40), 0.05);
  var col = fs.bgColor;

  col += smoothstep(0.0, 0.1, dBox + 0.5) * 0.02;

  let onPlayhead = (in.row == u32(uniforms.playheadRow));

  let note = (in.packedA >> 24) & 255u;
  let volCmd = (in.packedA >> 8) & 255u;
  let effCmd = (in.packedB >> 8) & 255u;
  let hasNote = note > 0u;
  let hasExpression = (volCmd > 0u) || (effCmd > 0u);
  let ch = channels[in.channel];

  if (hasNote) {
    let noteCol = neonPalette(f32(note % 12u) / 12.0);
    let dist = length(p);
    let glow = exp(-dist * 4.0);
    col += noteCol * glow * 1.5;
    if (ch.trigger > 0u && onPlayhead) {
      col += noteCol * 1.5;
    }
  }

  if (hasExpression && ch.isMuted == 0u) {
    col += vec3<f32>(0.0, 0.04, 0.08) * uniforms.bloomIntensity;
  }

  if (onPlayhead) {
    col += vec3<f32>(0.2, 0.2, 0.25) * 0.8;
  }

  col = mix(col, fs.borderColor, smoothstep(0.0, aa, dBox));
  col *= uniforms.dimFactor;

  col += kickReactiveGlow(p, uniforms.kickTrigger, uniforms.bloomIntensity);
  col += ditherNoise(in.uv, uniforms.timeSec);

  return vec4<f32>(col, 1.0);
}
