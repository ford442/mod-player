import { buildVertexShader, buildFragmentShader } from '../../../../hooks/webGLShaders';

export { buildVertexShader };

/** Pattern fragment shader with optional debug visualization uniforms. */
export function buildPatternFragmentShader(
  useNoteSustainTailMode: boolean,
  isV021: boolean,
): string {
  const base = buildFragmentShader(useNoteSustainTailMode, isV021);
  return base.replace(
    'uniform float u_timeSec;',
    `uniform float u_timeSec;
    uniform int u_debugMode;`,
  ).replace(
    'fragColor = vec4(lens.rgb, lens.a * 0.95);',
    `vec3 outRgb = lens.rgb;
    float outA = lens.a * 0.95;
    if (u_debugMode == 1) {
      float edge = abs(dFdx(v_uv.x)) + abs(dFdy(v_uv.y));
      outRgb = vec3(step(0.02, edge));
      outA = 1.0;
    } else if (u_debugMode == 2) {
      outRgb = vec3(v_uv, 0.0);
      outA = 1.0;
    } else if (u_debugMode == 3) {
      outRgb = vec3(v_active * 0.5, v_active > 0.5 ? 1.0 : 0.0, 0.0);
      outA = 1.0;
    } else if (u_debugMode == 4) {
      float ch = v_chState0.x;
      outRgb = vec3(ch, v_chState0.y, v_chState0.z * 0.001);
      outA = 1.0;
    } else if (u_debugMode == 5) {
      uint n = (v_cell.x >> 24u) & 255u;
      outRgb = vec3(float(n) / 96.0, float((v_cell.x >> 16u) & 255u) / 255.0, float(v_cell.y & 255u) / 255.0);
      outA = 1.0;
    }
    fragColor = vec4(outRgb, outA);`,
  );
}
