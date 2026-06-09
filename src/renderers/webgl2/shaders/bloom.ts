/** Separable Gaussian blur + composite — WebGL2 bloom approximation. */

export const FULLSCREEN_VERTEX = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const BLUR_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_direction;
uniform vec2 u_texelSize;
uniform float u_threshold;

void main() {
  vec3 color = vec3(0.0);
  float w[5];
  w[0] = 0.227027; w[1] = 0.1945946; w[2] = 0.1216216; w[3] = 0.054054; w[4] = 0.016216;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 off = u_direction * u_texelSize * fi;
    vec3 s1 = texture(u_source, v_uv + off).rgb;
    vec3 s2 = texture(u_source, v_uv - off).rgb;
    float weight = i == 0 ? w[0] : w[int(fi)];
    color += (s1 + s2) * weight;
  }
  float brightness = max(max(color.r, color.g), color.b);
  color *= step(u_threshold, brightness);
  fragColor = vec4(color, 1.0);
}
`;

export const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomIntensity;
uniform float u_crtEnabled;

void main() {
  vec3 scene = texture(u_scene, v_uv).rgb;
  vec3 bloom = texture(u_bloom, v_uv).rgb;
  vec3 color = scene + bloom * u_bloomIntensity;

  if (u_crtEnabled > 0.5) {
    float scan = sin(v_uv.y * 800.0) * 0.04;
    color -= scan;
    float vig = 1.0 - dot(v_uv - 0.5, v_uv - 0.5) * 1.2;
    color *= clamp(vig, 0.0, 1.0);
  }

  fragColor = vec4(color, 1.0);
}
`;
