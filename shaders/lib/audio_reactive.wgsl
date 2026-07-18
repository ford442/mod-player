// audio_reactive.wgsl — shared multi-band uniform block (binding 8 on pattern shaders)

struct AudioReactive {
  bass: f32,
  mid: f32,
  high: f32,
  amplitude: f32,
  beat: f32,
  peakL: f32,
  peakR: f32,
  rmsL: f32,
  rmsR: f32,
  enabled: f32,
  bloomDrive: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
};

fn audioReactiveMix(base: f32, reactive: f32, audio: AudioReactive) -> f32 {
  return mix(base, reactive, clamp(audio.enabled, 0.0, 1.0));
}

fn audioEdgeGlow(distFromEdge: f32, audio: AudioReactive) -> vec3<f32> {
  if (audio.enabled < 0.5) { return vec3<f32>(0.0); }
  let edge = 1.0 - smoothstep(0.0, 0.08, distFromEdge);
  let bassGlow = vec3<f32>(0.0, 0.85, 1.0) * audio.bass * edge * 1.4;
  let midGlow = vec3<f32>(0.6, 0.35, 1.0) * audio.mid * edge * 0.7;
  let highGlow = vec3<f32>(1.0, 0.45, 0.75) * audio.high * edge * 0.5;
  let beatFlash = vec3<f32>(0.9, 0.25, 0.45) * audio.beat * edge * 0.9;
  return bassGlow + midGlow + highGlow + beatFlash;
}

fn audioBloomThreshold(base: f32, audio: AudioReactive) -> f32 {
  if (audio.enabled < 0.5) { return base; }
  return max(0.35, base - audio.bass * 0.25 * audio.bloomDrive);
}

fn audioKickPulse(audio: AudioReactive, radial: f32, bloom: f32) -> vec3<f32> {
  if (audio.enabled < 0.5) { return vec3<f32>(0.0); }
  let kick = max(audio.beat, audio.bass * 0.6);
  return vec3<f32>(0.9, 0.2, 0.4) * kick * exp(-radial * 3.0) * 0.35 * bloom;
}
