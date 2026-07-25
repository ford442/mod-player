// night_theme.wgsl — default "Night" palette (v0.52 dusky)
// Other night variants override via theme_night_53 / theme_night_54 instead of this file.

// Floors raised (#346): the LED-off housing must read clearly above the background so the grid is
// visible even when idle. Both stay dark enough to keep the "night" mood.
const THEME_BG: vec3<f32> = vec3<f32>(0.040, 0.043, 0.050);
const THEME_LED_OFF: vec3<f32> = vec3<f32>(0.100, 0.105, 0.120);
const THEME_LED_ON: vec3<f32> = vec3<f32>(0.95, 0.50, 0.08);
const THEME_LIT_TINT: vec3<f32> = vec3<f32>(0.80, 0.82, 0.88);
const THEME_RIM: vec3<f32> = vec3<f32>(0.20, 0.30, 0.45);
const THEME_ARC: vec3<f32> = vec3<f32>(0.85, 0.75, 0.30);
const THEME_KICK: vec3<f32> = vec3<f32>(0.75, 0.15, 0.35);
const THEME_BLOOM_MULT: f32 = 0.90;
