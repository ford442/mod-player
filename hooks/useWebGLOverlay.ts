// WebGL2 overlay subsystem for PatternDisplay.
// Renders frosted-glass "cap" buttons on top of the WebGPU canvas for hybrid shaders.
// Uses instanced rendering — one quad per (channel × step) pair.

import { useRef, useEffect, useCallback } from 'react';
import type React from 'react';
import { PatternMatrix, PlaybackState } from '../types';
import {
  WEBGL_HYBRID_SHADERS,
  getLayoutType,
} from '../utils/shaderVersion';
import {
  GRID_RECT,
  POLAR_RINGS,
  CAP_CONFIG,
  calculateHorizontalCellSize,
  calculateCapScale,
  getLayoutModeFromShader,
  LAYOUT_MODES,
} from '../utils/geometryConstants';

const DEFAULT_ROWS = 64;
const DEFAULT_CHANNELS = 4;

// Runtime base URL detection for subdirectory deployment (e.g., /xm-player/)
const detectRuntimeBase = (): string => {
  const viteBase = import.meta.env.BASE_URL;
  if (viteBase && viteBase !== '/') {
    return viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
  }
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  if (pathSegments.length > 0) {
    return `/${pathSegments[0]}/`;
  }
  return '/';
};

export interface WebGLOverlayParams {
  shaderFile: string;
  matrix: PatternMatrix | null;
  padTopChannel: boolean;
  isOverlayActive: boolean;
  invertChannels: boolean;
  playheadRow: number;
  cellWidth: number;
  cellHeight: number;
  playbackStateRef?: React.MutableRefObject<PlaybackState>;
}

type DebugInfo = {
  layoutMode: string;
  errors: string[];
  uniforms: Record<string, number | string>;
  visible: boolean;
};

type GLResources = {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  texture: WebGLTexture;
  capTexture?: WebGLTexture;
  buffer: WebGLBuffer;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

export function useWebGLOverlay(
  glCanvasRef: React.RefObject<HTMLCanvasElement>,
  params: WebGLOverlayParams,
  setDebugInfo: React.Dispatch<React.SetStateAction<DebugInfo>>
) {
  const glContextRef = useRef<WebGL2RenderingContext | null>(null);
  const glResourcesRef = useRef<GLResources | null>(null);

  // Mutable ref so draw/upload functions always read fresh values without recreating
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const initWebGL = useCallback(() => {
    const shaderFile = paramsRef.current.shaderFile;
    console.group('🔧 initWebGL');

    // Clean up existing WebGL resources first
    if (glContextRef.current && glResourcesRef.current) {
      const oldGl = glContextRef.current;
      const oldRes = glResourcesRef.current;
      try {
        oldGl.deleteProgram(oldRes.program);
        oldGl.deleteVertexArray(oldRes.vao);
        oldGl.deleteBuffer(oldRes.buffer);
        oldGl.deleteTexture(oldRes.texture);
        if (oldRes.capTexture) oldGl.deleteTexture(oldRes.capTexture);
        oldGl.clearColor(0, 0, 0, 0);
        oldGl.clear(oldGl.COLOR_BUFFER_BIT | oldGl.DEPTH_BUFFER_BIT);
        console.log('✅ Cleaned up previous WebGL resources and cleared canvas');
      } catch (e) {
        console.warn('⚠️ Error cleaning up WebGL:', e);
      }
      glResourcesRef.current = null;
    }

    if (!glCanvasRef.current) {
      console.warn('⚠️ No glCanvasRef');
      console.groupEnd();
      return;
    }

    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = glCanvasRef.current.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
      if (!gl) {
        console.error('❌ Failed to get WebGL2 context');
        console.groupEnd();
        return;
      }
      console.log('✅ Got WebGL2 context');
    } catch (e) {
      console.error('❌ WebGL2 context error:', e);
      console.groupEnd();
      return;
    }

    glContextRef.current = gl;

    const vsSource = `#version 300 es
    precision highp float;

    in vec2 a_pos;
    in vec2 a_uv;

    out vec2 v_uv;
    out float v_active;  // 1.0 if Playhead matches this step
    out float v_hasNote; // 1.0 if Note data exists here

    uniform vec2 u_resolution;
    uniform vec2 u_cellSize;
    uniform vec2 u_offset;
    uniform float u_cols;
    uniform float u_rows;
    uniform float u_playhead;
    uniform int u_invertChannels;
    uniform int u_layoutMode; // 1=Circ, 2=Horiz32, 3=Horiz64
    uniform highp usampler2D u_noteData;

    const float PI = 3.14159265359;
    const float INNER_RADIUS = 0.3;  // From POLAR_RINGS
    const float OUTER_RADIUS = 0.9;  // From POLAR_RINGS
    const float CAP_SCALE_FACTOR = 0.88; // From CAP_CONFIG

    void main() {
        int id = gl_InstanceID;
        // u_cols = numChannels; texture is stored as width=channels, height=steps
        int trackIndex = id % int(u_cols); // 0 to numChannels-1
        int stepIndex  = id / int(u_cols); // 0 to stepsForMode-1

        // 1. Check for Note Data (texture: x=channel, y=step)
        uint note = texelFetch(u_noteData, ivec2(trackIndex, stepIndex), 0).r;
        v_hasNote = (note > 0u) ? 1.0 : 0.0;

        // 2. Playhead Logic
        float stepsPerPage = (u_layoutMode == 3) ? 64.0 : 32.0;
        float relativePlayhead = mod(u_playhead, stepsPerPage);

        float distToPlayhead = abs(float(stepIndex) - relativePlayhead);
        distToPlayhead = min(distToPlayhead, stepsPerPage - distToPlayhead);
        float activation = 1.0 - smoothstep(0.0, 1.5, distToPlayhead);
        v_active = activation;

        // 3. Positioning Logic
        if (u_layoutMode == 2 || u_layoutMode == 3) {
            // --- HORIZONTAL LAYOUT (32-step or 64-step) ---
            // Steps run along X, channels run along Y
            float capScale = min(u_cellSize.x, u_cellSize.y) * CAP_SCALE_FACTOR;
            if (note == 0u) capScale = 0.0;
            capScale *= 1.0 + (0.2 * activation);

            float cellX = u_offset.x + float(stepIndex)  * u_cellSize.x;
            float cellY = u_offset.y + float(trackIndex) * u_cellSize.y;

            vec2 centered = a_pos * capScale + vec2(cellX + u_cellSize.x * 0.5, cellY + u_cellSize.y * 0.5);
            vec2 ndc = (centered / u_resolution) * 2.0 - 1.0;
            ndc.y = -ndc.y;
            gl_Position = vec4(ndc, 0.0, 1.0);

        } else {
            // --- CIRCULAR LAYOUT ---
            // Use pixel-space radii (based on minDim) to match the WGSL background shader
            // and prevent elliptical stretching on non-square viewports.

            float numTracks = u_cols;
            float trackIndexF = float(trackIndex);
            if (u_invertChannels == 0) { trackIndexF = numTracks - 1.0 - trackIndexF; }

            // Pixel-space radii matching WGSL v0.46 exactly
            float minDim = min(u_resolution.x, u_resolution.y);
            float maxRadius = minDim * 0.45;
            float minRadius = minDim * 0.15;
            float ringDepth = (maxRadius - minRadius) / numTracks;

            // Center in the ring (matches WGSL positioning)
            float pixelRadius = minRadius + trackIndexF * ringDepth + ringDepth * 0.5;

            float totalSteps = 64.0;
            float anglePerStep = (2.0 * PI) / totalSteps;
            float theta = -1.570796 + float(stepIndex) * anglePerStep;

            // Button sizing using shared cap scale
            float circumference = 2.0 * PI * pixelRadius;
            float arcLength = circumference / totalSteps;
            float btnW = arcLength * CAP_SCALE_FACTOR;
            float btnH = ringDepth * 0.92;

            // Playhead pop effect
            float circPlayhead = mod(u_playhead, totalSteps);
            float circDist = abs(float(stepIndex) - circPlayhead);
            circDist = min(circDist, totalSteps - circDist);
            float circActivation = 1.0 - smoothstep(0.0, 1.5, circDist);
            float popScale = (v_hasNote > 0.5) ? (1.0 + 0.2 * circActivation) : 0.0;
            btnW *= popScale;
            btnH *= popScale;
            v_active = circActivation;

            // Local position with rotation
            vec2 localPos = a_pos * vec2(btnW, btnH);
            float rotAng = theta + 1.570796;
            float cA = cos(rotAng); float sA = sin(rotAng);
            float rotX = localPos.x * cA - localPos.y * sA;
            float rotY = localPos.x * sA + localPos.y * cA;

            // World position in pixels
            vec2 center = u_resolution * 0.5;
            float worldX = center.x + cos(theta) * pixelRadius + rotX;
            float worldY = center.y + sin(theta) * pixelRadius + rotY;

            // Convert to NDC
            vec2 ndc = vec2(
                (worldX / u_resolution.x) * 2.0 - 1.0,
                1.0 - (worldY / u_resolution.y) * 2.0
            );
            gl_Position = vec4(ndc, 0.0, 1.0);
        }

        v_uv = a_pos + 0.5;
    }
    `;

    // Only compile if using a hybrid shader that needs WebGL caps
    if (!WEBGL_HYBRID_SHADERS.has(shaderFile)) {
      if (glContextRef.current && glCanvasRef.current) {
        const clearGl = glContextRef.current;
        clearGl.clearColor(0, 0, 0, 0);
        clearGl.clear(clearGl.COLOR_BUFFER_BIT | clearGl.DEPTH_BUFFER_BIT);
      }
      console.log('🔧 Shader does not use WebGL2 overlay, canvas cleared');
      console.groupEnd();
      return;
    }

    const fsSource = `#version 300 es
    precision highp float;

    in vec2 v_uv;
    in float v_active;  // Playhead Hit
    in float v_hasNote; // Note Exists

    uniform sampler2D u_capTexture;

    out vec4 fragColor;

    void main() {
        // Read the "Frosted Glass" texture
        vec4 cap = texture(u_capTexture, v_uv);

        // Base Lighting (Idle)
        vec3 lightColor = vec3(0.0);
        float intensity = 0.0;

        if (v_hasNote > 0.5) {
            // IDLE STATE: Cool Blue Data Glow
            lightColor = vec3(0.0, 0.6, 1.0);
            intensity = 0.8;
        }

        // Active Lighting (Hit)
        vec3 activeColor = vec3(1.0, 0.5, 0.1);
        float activeIntensity = 1.5; // Bloom boost
        lightColor = mix(lightColor, activeColor, v_active);
        intensity = mix(intensity, activeIntensity, v_active);

        // Apply Light to Material
        vec3 finalRGB = cap.rgb * lightColor * intensity;

        // Final Output
        fragColor = vec4(finalRGB, cap.a * 0.9); // 0.9 alpha for translucency

        if (fragColor.a < 0.01) discard;
    }
    `;

    const createShader = (type: number, src: string, name: string) => {
      try {
        const s = gl!.createShader(type)!;
        gl!.shaderSource(s, src);
        gl!.compileShader(s);
        if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
          const log = gl!.getShaderInfoLog(s);
          console.error(`❌ ${name} Shader Error:`, log);
          gl!.deleteShader(s);
          return null;
        }
        console.log(`✅ ${name} shader compiled`);
        return s;
      } catch (e) {
        console.error(`❌ ${name} shader exception:`, e);
        return null;
      }
    };

    const vs = createShader(gl.VERTEX_SHADER, vsSource, 'Vertex');
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource, 'Fragment');
    if (!vs || !fs) {
      console.error('❌ Shader compilation failed');
      console.groupEnd();
      return;
    }

    let prog: WebGLProgram | null = null;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('❌ GL Link Error:', gl.getProgramInfoLog(prog));
        console.groupEnd();
        return;
      }
      console.log('✅ Shader program linked');
    } catch (e) {
      console.error('❌ Program linking exception:', e);
      console.groupEnd();
      return;
    }

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
      -0.5, 0.5, 0.5, -0.5, 0.5, 0.5
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const capTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, capTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const capImg = new Image();
    capImg.onload = () => {
      if (!glCanvasRef.current) return;
      const currentGl = glContextRef.current;
      if (currentGl) {
        currentGl.bindTexture(currentGl.TEXTURE_2D, capTex);
        currentGl.texImage2D(currentGl.TEXTURE_2D, 0, currentGl.RGBA, currentGl.RGBA, currentGl.UNSIGNED_BYTE, capImg);
        console.log('✅ Cap texture loaded');
      }
    };
    capImg.onerror = () => { console.warn('⚠️ Failed to load cap texture'); };
    const runtimeBase = detectRuntimeBase();
    capImg.src = `${runtimeBase}unlit-button.png`;
    console.log('[WebGL] Cap texture URL:', `${runtimeBase}unlit-button.png`);

    try {
      const uniformLocs: Record<string, WebGLUniformLocation | null> = {
        u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
        u_cellSize: gl.getUniformLocation(prog, 'u_cellSize'),
        u_offset: gl.getUniformLocation(prog, 'u_offset'),
        u_cols: gl.getUniformLocation(prog, 'u_cols'),
        u_rows: gl.getUniformLocation(prog, 'u_rows'),
        u_playhead: gl.getUniformLocation(prog, 'u_playhead'),
        u_layoutMode: gl.getUniformLocation(prog, 'u_layoutMode'),
        u_invertChannels: gl.getUniformLocation(prog, 'u_invertChannels'),
        u_noteData: gl.getUniformLocation(prog, 'u_noteData'),
        u_capTexture: gl.getUniformLocation(prog, 'u_capTexture'),
      };

      console.log(`[WebGL] Shader: ${shaderFile}, Layout: ${getLayoutType(shaderFile)}`);

      const coreUniforms = ['u_resolution', 'u_noteData', 'u_cols', 'u_playhead'];
      const variantUniforms = ['u_layoutMode', 'u_invertChannels', 'u_cellSize', 'u_offset', 'u_capTexture', 'u_rows'];

      const nullUniforms = Object.entries(uniformLocs)
        .filter(([, loc]) => loc === null)
        .map(([name]) => name);

      const missingCore = nullUniforms.filter(name => coreUniforms.includes(name));
      const missingVariant = nullUniforms.filter(name => variantUniforms.includes(name));

      if (missingCore.length > 0) {
        console.error(`[WebGL] ❌ Missing CORE uniforms in ${shaderFile}:`, missingCore);
      }
      if (missingVariant.length > 0) {
        console.log(`[WebGL] Variant uniforms optimized out in ${shaderFile}:`, missingVariant);
      }

      glResourcesRef.current = { program: prog, vao, texture: tex, capTexture: capTex, buffer: buf, uniforms: uniformLocs };
      console.log('✅ WebGL resources initialized');
    } catch (e) {
      console.error('❌ Error setting up uniforms:', e);
    }

    console.groupEnd();

    return () => {
      try {
        gl.deleteProgram(prog);
        gl.deleteVertexArray(vao);
        gl.deleteBuffer(buf);
        gl.deleteTexture(tex);
        if (capTex) gl.deleteTexture(capTex);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      } catch (e) {
        console.warn('Cleanup error:', e);
      }
      glResourcesRef.current = null;
    };
  }, []); // stable — reads from paramsRef

  useEffect(() => {
    return initWebGL();
  }, [paramsRef.current.shaderFile, initWebGL]); // re-init on shader change

  // Upload matrix data to the WebGL note-data texture
  useEffect(() => {
    const p = paramsRef.current;
    if (!p.isOverlayActive) return;

    const gl = glContextRef.current;
    const res = glResourcesRef.current;
    if (!gl || !res || !p.matrix) return;

    const rows = p.matrix.numRows;
    const rawCols = p.matrix.numChannels;
    const cols = p.padTopChannel ? rawCols + 1 : rawCols;
    const startCol = p.padTopChannel ? 1 : 0;

    const data = new Uint8Array(rows * cols);

    for (let r = 0; r < rows; r++) {
      const rowData = p.matrix.rows[r] || [];
      for (let c = 0; c < rawCols; c++) {
        const cell = rowData[c];
        const hasNote = cell && cell.note !== undefined && cell.note > 0;
        const texIndex = r * cols + (c + startCol);
        data[texIndex] = hasNote ? 255 : 0;
      }
    }

    gl.bindTexture(gl.TEXTURE_2D, res.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, cols, rows, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data);
  }, [paramsRef.current.matrix, paramsRef.current.padTopChannel, paramsRef.current.shaderFile]);

  const drawWebGL = useCallback(() => {
    const p = paramsRef.current;
    const gl = glContextRef.current;
    const res = glResourcesRef.current;
    if (!gl || !res || !WEBGL_HYBRID_SHADERS.has(p.shaderFile) || !p.matrix) return;

    const errors: string[] = [];
    const uniformVals: Record<string, number | string> = {};

    try {
      const { program, vao, texture, uniforms } = res;
      const numChannelsForGL = p.padTopChannel ? (p.matrix.numChannels || DEFAULT_CHANNELS) + 1 : (p.matrix.numChannels || DEFAULT_CHANNELS);
      const cols = numChannelsForGL;
      const rows = p.matrix.numRows || DEFAULT_ROWS;

      const preError = gl.getError();
      if (preError !== gl.NO_ERROR) {
        errors.push(`Pre-draw GL Error: 0x${preError.toString(16)}`);
      }

      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vao);

      const livePlayheadRow = p.playbackStateRef?.current?.playheadRow ?? p.playheadRow;

      const setUniform = <T extends (loc: WebGLUniformLocation | null, ...args: any[]) => void>(
        _name: string,
        location: WebGLUniformLocation | null | undefined,
        setter: T,
        ...args: Parameters<T> extends [any, ...infer R] ? R : never
      ) => {
        if (location != null) {
          (setter as any)(location, ...args);
          return true;
        }
        return false;
      };

      try {
        const hasResolution = setUniform('u_resolution', uniforms.u_resolution, gl.uniform2f.bind(gl), gl.canvas.width, gl.canvas.height);
        if (hasResolution) uniformVals['u_resolution'] = `${gl.canvas.width}x${gl.canvas.height}`;
        const hasCols = setUniform('u_cols', uniforms.u_cols, gl.uniform1f.bind(gl), cols);
        if (hasCols) uniformVals['u_cols'] = cols;
        const hasRows = setUniform('u_rows', uniforms.u_rows, gl.uniform1f.bind(gl), rows);
        if (hasRows) uniformVals['u_rows'] = rows;
        const hasPlayhead = setUniform('u_playhead', uniforms.u_playhead, gl.uniform1f.bind(gl), livePlayheadRow);
        if (hasPlayhead) uniformVals['u_playhead'] = livePlayheadRow.toFixed(2);
        const hasInvert = setUniform('u_invertChannels', uniforms.u_invertChannels, gl.uniform1i.bind(gl), p.invertChannels ? 1 : 0);
        if (hasInvert) uniformVals['u_invertChannels'] = p.invertChannels ? 1 : 0;

        if (!hasResolution || !hasCols || !hasPlayhead) {
          const missing = ['u_resolution', 'u_cols', 'u_playhead'].filter((_, i) =>
            ![hasResolution, hasCols, hasPlayhead][i]
          );
          errors.push(`Missing core uniforms (shader may fail): ${missing.join(', ')}`);
        }
      } catch (e) {
        errors.push(`Uniform upload error: ${e}`);
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      setUniform('u_noteData', uniforms.u_noteData, gl.uniform1i.bind(gl), 0);

      if (res.capTexture && uniforms.u_capTexture != null) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, res.capTexture);
        gl.uniform1i(uniforms.u_capTexture, 1);
      }

      let effectiveCellW = p.cellWidth;
      let effectiveCellH = p.cellHeight;
      let offsetX = 0;
      let offsetY = 0;
      let layoutModeName = 'CIRCULAR';

      const layoutMode = getLayoutModeFromShader(p.shaderFile);
      const channelCount = cols;

      if (layoutMode === LAYOUT_MODES.HORIZONTAL_32) {
        if (p.shaderFile.includes('v0.39')) {
          effectiveCellW = gl.canvas.width / 32.0;
          effectiveCellH = gl.canvas.height / channelCount;
          offsetX = 0;
          offsetY = 0;
          layoutModeName = '32-STEP (v0.39)';
        } else {
          const metrics = calculateHorizontalCellSize(gl.canvas.width, gl.canvas.height, 32, channelCount);
          effectiveCellW = metrics.cellW;
          effectiveCellH = metrics.cellH;
          offsetX = metrics.offsetX;
          offsetY = metrics.offsetY;
          layoutModeName = '32-STEP';
        }
        if (uniforms.u_offset != null) gl.uniform2f(uniforms.u_offset, offsetX, offsetY);
      } else if (layoutMode === LAYOUT_MODES.HORIZONTAL_64) {
        const metrics = calculateHorizontalCellSize(gl.canvas.width, gl.canvas.height, 64, channelCount);
        effectiveCellW = metrics.cellW;
        effectiveCellH = metrics.cellH;
        offsetX = metrics.offsetX;
        offsetY = metrics.offsetY;
        if (uniforms.u_offset != null) gl.uniform2f(uniforms.u_offset, offsetX, offsetY);
        layoutModeName = '64-STEP';
      } else {
        if (uniforms.u_offset != null) gl.uniform2f(uniforms.u_offset, 0.0, 0.0);
        layoutModeName = 'CIRCULAR';
      }

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const capScale = calculateCapScale(effectiveCellW, effectiveCellH, pixelRatio);

      if (uniforms.u_cellSize != null) gl.uniform2f(uniforms.u_cellSize, effectiveCellW, effectiveCellH);
      if (uniforms.u_layoutMode != null) gl.uniform1i(uniforms.u_layoutMode, layoutMode);

      uniformVals['u_offset'] = `${offsetX.toFixed(1)}, ${offsetY.toFixed(1)}`;
      uniformVals['u_cellSize'] = `${effectiveCellW.toFixed(1)}, ${effectiveCellH.toFixed(1)}`;
      uniformVals['capScale'] = capScale.toFixed(1);
      uniformVals['pixelRatio'] = pixelRatio;
      uniformVals['GRID_RECT'] = `${GRID_RECT.x.toFixed(3)}, ${GRID_RECT.y.toFixed(3)}, ${GRID_RECT.w.toFixed(3)}, ${GRID_RECT.h.toFixed(3)}`;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      const stepsForMode = layoutMode === LAYOUT_MODES.HORIZONTAL_32 ? 32 :
        layoutMode === LAYOUT_MODES.HORIZONTAL_64 ? 64 : 64;
      const totalInstances = stepsForMode * cols;

      uniformVals['totalInstances'] = totalInstances;
      uniformVals['cols'] = cols;
      uniformVals['rows'] = rows;

      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, totalInstances);

      const postError = gl.getError();
      if (postError !== gl.NO_ERROR) {
        errors.push(`Post-draw GL Error: 0x${postError.toString(16)}`);
      }

      gl.bindVertexArray(null);

      setDebugInfo((prev: DebugInfo) => ({ ...prev, layoutMode: layoutModeName, errors, uniforms: uniformVals }));

      console.group(`🔍 PatternDisplay Debug - Mode ${layoutMode}`);
      console.log('Layout:', layoutModeName);
      console.log('GRID_RECT:', GRID_RECT);
      console.log('POLAR_RINGS:', POLAR_RINGS);
      console.log('CAP_CONFIG:', CAP_CONFIG);
      console.log('effectiveCellW/H:', effectiveCellW, effectiveCellH);
      console.log('capScale:', capScale);
      console.log('totalInstances:', totalInstances);
      console.log('Errors:', errors.length > 0 ? errors : 'None');
      console.groupEnd();

    } catch (e) {
      console.error('❌ drawWebGL error:', e);
      errors.push(`Exception: ${e}`);
      setDebugInfo((prev: DebugInfo) => ({ ...prev, errors }));
    }
  }, [setDebugInfo]); // stable — reads from paramsRef; setDebugInfo is a stable React setter

  return { drawWebGL, glContextRef };
}
