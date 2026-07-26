// velocity_led.wgsl — VEL-001 per-step volume/velocity from packed cell layout
fn normalizedCellVolume(packedA: u32, packedB: u32) -> f32 {
  let volPacked = packedA & 0xFFu;
  let coarseVol = volPacked & 0x0Fu;
  let fullVolCmd = packedB & 0xFFu;
  if (coarseVol == 0u && fullVolCmd == 0u) { return 1.0; }
  return clamp(f32(coarseVol) / 4.0, 0.0, 1.0);
}
