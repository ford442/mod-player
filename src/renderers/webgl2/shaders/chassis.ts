/** Fullscreen chassis / bezel background — approximates WebGPU chassis passes. */
export const CHASSIS_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const CHASSIS_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_timeSec;
uniform float u_dimFactor;
uniform float u_themeBlend;
uniform float u_vignetteStrength;
uniform float u_filmGrain;
uniform float u_invertMix;
uniform int u_nightPreset;
uniform float u_innerRadius;
uniform float u_outerRadius;
uniform int u_layoutMode; // 1=circular

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = v_uv;
  vec2 centered = (uv - 0.5) * 2.0;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  centered.x *= aspect;

  // Device body gradient
  vec3 dayColor = vec3(0.06, 0.06, 0.07);
  vec3 nightColor = vec3(0.02, 0.025, 0.04);
  float nightMix = clamp(u_themeBlend, 0.0, 1.0);
  vec3 base = mix(dayColor, nightColor, nightMix);

  // Subtle brushed-metal radial bands
  float r = length(centered);
  float band = sin(r * 40.0 + u_timeSec * 0.2) * 0.015;
  base += band;

  // Circular donut hole (pattern area)
  if (u_layoutMode == 1) {
    float minR = u_innerRadius / min(u_resolution.x, u_resolution.y);
    float maxR = u_outerRadius / min(u_resolution.x, u_resolution.y);
    float hole = smoothstep(minR - 0.02, minR, r) * (1.0 - smoothstep(maxR, maxR + 0.04, r));
    base = mix(base * 0.35, base, hole);
    // Center island (white donut core for v0.35-style shaders)
    float centerIsland = 1.0 - smoothstep(0.0, minR * 0.85, r);
    base = mix(base, vec3(0.92, 0.93, 0.96) * u_dimFactor, centerIsland * 0.35 * nightMix);
  }

  // Vignette
  float vig = 1.0 - u_vignetteStrength * r * r * 0.6;
  base *= vig;

  // Film grain
  float grain = (hash(uv * u_resolution + u_timeSec) - 0.5) * u_filmGrain;
  base += grain;

  // Luminance invert mix (night mode)
  float luma = dot(base, vec3(0.299, 0.587, 0.114));
  base = mix(base, vec3(1.0 - luma), clamp(u_invertMix, 0.0, 1.0));

  base *= u_dimFactor;

  // Bezel edge highlight
  float edge = smoothstep(0.92, 0.98, max(abs(centered.x), abs(centered.y)));
  base += edge * vec3(0.08, 0.09, 0.12);

  fragColor = vec4(base, 1.0);
}
`;
