// velocity_led.wgsl — VEL-001 per-step volume/velocity from packed cell layout
//#include "lib/openmpt_commands.wgsl"

// volPacked = VolumeCommand (high nibble) | intensity 0..15 (low nibble). Only a set-volume column
// ("v40") is a velocity; panning, slides and the other volume commands carry a different quantity.
fn normalizedCellVolume(packedA: u32, packedB: u32) -> f32 {
  let volPacked = packedA & 0xFFu;
  let isSetVolume = (volPacked >> 4u) == VOLCMD_VOLUME;
  if (!isSetVolume) { return 1.0; }
  return clamp(f32(volPacked & 0x0Fu) / 15.0, 0.0, 1.0);
}
