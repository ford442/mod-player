// night_theme.wgsl — default "Night" palette (v0.52 dusky)
// Other night variants override via theme_night_53 / theme_night_54 instead of this file.

const THEME_BG: vec3<f32> = vec3<f32>(0.025, 0.027, 0.032);
const THEME_LED_OFF: vec3<f32> = vec3<f32>(0.035, 0.037, 0.045);
const THEME_LED_ON: vec3<f32> = vec3<f32>(0.95, 0.50, 0.08);
const THEME_LIT_TINT: vec3<f32> = vec3<f32>(0.80, 0.82, 0.88);
const THEME_RIM: vec3<f32> = vec3<f32>(0.20, 0.30, 0.45);
const THEME_ARC: vec3<f32> = vec3<f32>(0.85, 0.75, 0.30);
const THEME_KICK: vec3<f32> = vec3<f32>(0.75, 0.15, 0.35);
const THEME_BLOOM_MULT: f32 = 0.90;
