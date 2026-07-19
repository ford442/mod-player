// WebGL2 overlay subsystem for PatternDisplay.
// Renders three-LED frosted lens caps on top of the WebGPU canvas for hybrid shaders.
// Uses instanced rendering — one quad per (channel × step) pair.
// Three-emitter system: Top=Blue note-on, Mid=Pitch-colored note, Bot=Amber expression.

import { useRef, useEffect, useCallback } from 'react';
import type React from 'react';
import { buildVertexShader, buildFragmentShader } from './webGLShaders';
import { ChannelShadowState, PatternMatrix, PlaybackState } from '../types';
import { packPatternMatrixHighPrecision } from '../utils/gpuPacking';
import {
  WEBGL_HYBRID_SHADERS,
  getLayoutType,
  usesStrictPlayheadSustainMode,
  isHorizontalLayoutShader,
  supportsStepsLength,
  usesWebGLOverlayHorizontal,
} from '../utils/shaderVersion';
import {
  GRID_RECT,
  calculateHorizontalCellSize,
  calculateCapScale,
  getLayoutModeFromShader,
  getPolarRadii,
  horizontalLayoutHasHeader,
  LAYOUT_MODES,
  usesCircularRowPaging,
} from '../utils/geometryConstants';
import { detectRuntimeBase } from '../src/lib/paths';

const DEFAULT_ROWS = 64;
const DEFAULT_CHANNELS = 4;

const CORE_UNIFORMS = new Set(['u_resolution', 'u_cellData', 'u_cols', 'u_playhead']);
const VARIANT_UNIFORMS = new Set(['u_layoutMode', 'u_invertChannels', 'u_cellSize', 'u_offset', 'u_capTexture', 'u_rows', 'u_channelState', 'u_bloomIntensity', 'u_timeSec', 'u_innerRadius', 'u_outerRadius']);

export interface WebGLOverlayParams {
  shaderFile: string;
  matrix: PatternMatrix | null;
  padTopChannel: boolean;
  isOverlayActive: boolean;
  invertChannels: boolean;
  playheadRow: number;
  cellWidth: number;
  cellHeight: number;
  channels?: ChannelShadowState[];
  channelStatesRef?: React.MutableRefObject<ChannelShadowState[]>;
  bloomIntensity?: number;
  playbackStateRef?: React.MutableRefObject<PlaybackState>;
  stepsLength?: number;
}

type DebugInfo = {
  layoutMode: string;
  errors: string[];
  uniforms: Record<string, number | string>;
};

type GLResources = {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  cellTexture: WebGLTexture;
  stateTexture: WebGLTexture;
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
  const stateDataRef = useRef<Float32Array | null>(null);

  // Mutable ref so draw/upload functions always read fresh values without recreating
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const initWebGL = useCallback(() => {
    const shaderFile = paramsRef.current.shaderFile;
    if (!paramsRef.current.isOverlayActive) {
      console.log('🔧 Overlay inactive, skipping WebGL init');
      return;
    }
    const useNoteSustainTailMode = usesStrictPlayheadSustainMode(shaderFile);
    const isV021 = usesWebGLOverlayHorizontal(shaderFile);
    const useCircularPaging = usesCircularRowPaging(shaderFile);
    console.group('🔧 initWebGL');

    // Clean up existing WebGL resources first
    if (glContextRef.current && glResourcesRef.current) {
      const oldGl = glContextRef.current;
      const oldRes = glResourcesRef.current;
      try {
        oldGl.deleteProgram(oldRes.program);
        oldGl.deleteVertexArray(oldRes.vao);
        oldGl.deleteBuffer(oldRes.buffer);
        oldGl.deleteTexture(oldRes.cellTexture);
        oldGl.deleteTexture(oldRes.stateTexture);
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

    // --- VERTEX SHADER ---
    // Fetches cell data (packedA, packedB) and channel state in the VS,
    // passes as flat varyings to avoid per-pixel texelFetch.
    const vsSource = buildVertexShader(useNoteSustainTailMode, isV021, useCircularPaging);

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

    // --- FRAGMENT SHADER ---
    // Three-LED unified lens cap ported from v0.50 WGSL
    const fsSource = buildFragmentShader(useNoteSustainTailMode, isV021);

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

    // Cell data texture (RG32UI — packedA, packedB)
    const cellTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, cellTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Channel state texture (RGBA32F — 2 rows per channel)
    const stateTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, stateTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Cap texture (frosted button PNG — legacy, still useful for material)
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
        u_cellData: gl.getUniformLocation(prog, 'u_cellData'),
        u_channelState: gl.getUniformLocation(prog, 'u_channelState'),
        u_capTexture: gl.getUniformLocation(prog, 'u_capTexture'),
        u_bloomIntensity: gl.getUniformLocation(prog, 'u_bloomIntensity'),
        u_timeSec: gl.getUniformLocation(prog, 'u_timeSec'),
        u_innerRadius: gl.getUniformLocation(prog, 'u_innerRadius'),
        u_outerRadius: gl.getUniformLocation(prog, 'u_outerRadius'),
      };

      console.log(`[WebGL] Shader: ${shaderFile}, Layout: ${getLayoutType(shaderFile)}`);

      const missingCore: string[] = [];
      const missingVariant: string[] = [];
      for (const [name, loc] of Object.entries(uniformLocs)) {
        if (loc === null) {
          if (CORE_UNIFORMS.has(name)) {
            missingCore.push(name);
          } else if (VARIANT_UNIFORMS.has(name)) {
            missingVariant.push(name);
          }
        }
      }

      if (missingCore.length > 0) {
        console.error(`[WebGL] ❌ Missing CORE uniforms in ${shaderFile}:`, missingCore);
      }
      if (missingVariant.length > 0) {
        console.log(`[WebGL] Variant uniforms optimized out in ${shaderFile}:`, missingVariant);
      }

      glResourcesRef.current = { program: prog, vao, cellTexture: cellTex, stateTexture: stateTex, capTexture: capTex, buffer: buf, uniforms: uniformLocs };
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
        gl.deleteTexture(cellTex);
        gl.deleteTexture(stateTex);
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
  }, [params.shaderFile, params.isOverlayActive, initWebGL]); // re-init when hybrid overlay activates or shader changes

  // Upload matrix data to the WebGL cell-data texture (RG32UI)
  useEffect(() => {
    const p = paramsRef.current;
    if (!p.isOverlayActive) return;

    const gl = glContextRef.current;
    const res = glResourcesRef.current;
    if (!gl || !res || !p.matrix) return;

    const rows = p.matrix.numRows;
    const rawCols = p.matrix.numChannels;
    const cols = p.padTopChannel ? rawCols + 1 : rawCols;

    // Always use high-precision packing for consistent three-LED data
    const { packedData } = packPatternMatrixHighPrecision(p.matrix, p.padTopChannel);

    // Upload as RG32UI texture (2 uint32 per texel = packedA, packedB)
    gl.bindTexture(gl.TEXTURE_2D, res.cellTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32UI, cols, rows, 0, gl.RG_INTEGER, gl.UNSIGNED_INT, packedData);
  }, [params.matrix, params.padTopChannel, params.shaderFile, params.isOverlayActive]);

  const drawWebGL = useCallback(() => {
    const p = paramsRef.current;
    const gl = glContextRef.current;
    const res = glResourcesRef.current;
    if (!p.isOverlayActive || !gl || !res || !WEBGL_HYBRID_SHADERS.has(p.shaderFile) || !p.matrix) return;

    const errors: string[] = [];
    const uniformVals: Record<string, number | string> = {};

    try {
      const { program, vao, cellTexture, stateTexture, uniforms } = res;
      const numChannelsForGL = p.padTopChannel ? (p.matrix.numChannels || DEFAULT_CHANNELS) + 1 : (p.matrix.numChannels || DEFAULT_CHANNELS);
      const cols = numChannelsForGL;
      const rows = p.matrix.numRows || DEFAULT_ROWS;

      const preError = gl.getError();
      if (preError !== gl.NO_ERROR) {
        errors.push(`Pre-draw GL Error: 0x${preError.toString(16)}`);
      }

      // Upload channel state texture (RGBA32F, width=cols, height=2)
      const chans = (p.channelStatesRef?.current?.length ? p.channelStatesRef.current : p.channels) || [];
      const requiredSize = cols * 2 * 4;
      if (!stateDataRef.current || stateDataRef.current.length !== requiredSize) {
        stateDataRef.current = new Float32Array(requiredSize);
      }
      const stateData = stateDataRef.current;
      const startIdx = p.padTopChannel ? 1 : 0;
      
      // Zero out the padding channel to prevent stale data if re-used
      if (startIdx === 1) {
        for (let j = 0; j < 4; j++) {
          stateData[j] = 0;
          stateData[cols * 4 + j] = 0;
        }
      }

      for (let i = 0; i < (p.matrix.numChannels || DEFAULT_CHANNELS); i++) {
        const ch = chans[i] || { volume: 0, pan: 0.5, freq: 440, trigger: 0, noteAge: 1000, activeEffect: 0, effectValue: 0, isMuted: 0 };
        const colIdx = i + startIdx;
        // Row 0: volume, pan, freq, trigger
        const r0 = colIdx * 4;
        stateData[r0] = ch.volume ?? 0;
        stateData[r0 + 1] = ch.pan ?? 0.5;
        stateData[r0 + 2] = ch.freq ?? 440;
        stateData[r0 + 3] = ch.trigger ?? 0;
        // Row 1: noteAge, activeEffect, effectValue, isMuted
        const r1 = (cols + colIdx) * 4;
        stateData[r1] = ch.noteAge ?? 1000;
        stateData[r1 + 1] = ch.activeEffect ?? 0;
        stateData[r1 + 2] = ch.effectValue ?? 0;
        stateData[r1 + 3] = ch.isMuted ?? 0;
      }

      gl.bindTexture(gl.TEXTURE_2D, stateTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, cols, 2, 0, gl.RGBA, gl.FLOAT, stateData);

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

        // New uniforms
        setUniform('u_bloomIntensity', uniforms.u_bloomIntensity, gl.uniform1f.bind(gl), p.bloomIntensity ?? 1.0);
        setUniform('u_timeSec', uniforms.u_timeSec, gl.uniform1f.bind(gl), performance.now() / 1000.0);

        // Dynamic radius uniforms — shared with WebGPU via getPolarRadii()
        const { innerRadius, outerRadius } = getPolarRadii(gl.canvas.width, gl.canvas.height, p.shaderFile);
        setUniform('u_innerRadius', uniforms.u_innerRadius, gl.uniform1f.bind(gl), innerRadius);
        setUniform('u_outerRadius', uniforms.u_outerRadius, gl.uniform1f.bind(gl), outerRadius);
        uniformVals['u_innerRadius'] = innerRadius.toFixed(2);
        uniformVals['u_outerRadius'] = outerRadius.toFixed(2);

        if (!hasResolution || !hasCols || !hasPlayhead) {
          const missing = ['u_resolution', 'u_cols', 'u_playhead'].filter((_, i) =>
            ![hasResolution, hasCols, hasPlayhead][i]
          );
          errors.push(`Missing core uniforms (shader may fail): ${missing.join(', ')}`);
        }
      } catch (e) {
        errors.push(`Uniform upload error: ${e}`);
      }

      // Bind textures
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, cellTexture);
      setUniform('u_cellData', uniforms.u_cellData, gl.uniform1i.bind(gl), 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, stateTexture);
      setUniform('u_channelState', uniforms.u_channelState, gl.uniform1i.bind(gl), 1);

      if (res.capTexture && uniforms.u_capTexture != null) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, res.capTexture);
        gl.uniform1i(uniforms.u_capTexture, 2);
      }

      let effectiveCellW = p.cellWidth;
      let effectiveCellH = p.cellHeight;
      let offsetX = 0;
      let offsetY = 0;
      let layoutModeName = 'CIRCULAR';

      // Horizontal shaders with stepsLength can toggle 32/64 page modes
      let layoutMode = getLayoutModeFromShader(p.shaderFile);
      if (isHorizontalLayoutShader(p.shaderFile) && supportsStepsLength(p.shaderFile)) {
        layoutMode = p.stepsLength === 64 ? LAYOUT_MODES.HORIZONTAL_64 : LAYOUT_MODES.HORIZONTAL_32;
      }
      const channelCount = cols;
      const hasHeaderRow = p.padTopChannel && horizontalLayoutHasHeader(channelCount);

      if (layoutMode === LAYOUT_MODES.HORIZONTAL_32) {
        {
          const metrics = calculateHorizontalCellSize(gl.canvas.width, gl.canvas.height, 32, channelCount, hasHeaderRow);
          effectiveCellW = metrics.cellW;
          effectiveCellH = metrics.cellH;
          offsetX = metrics.offsetX;
          offsetY = metrics.offsetY;
          layoutModeName = '32-STEP';
        }
        if (uniforms.u_offset != null) gl.uniform2f(uniforms.u_offset, offsetX, offsetY);
      } else if (layoutMode === LAYOUT_MODES.HORIZONTAL_64) {
        const metrics = calculateHorizontalCellSize(gl.canvas.width, gl.canvas.height, 64, channelCount, hasHeaderRow);
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

      // Additive blending: SRC_ALPHA preserves alpha-based edge anti-aliasing,
      // ONE on destination adds light on top of WGSL cells without darkening them.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

      const stepsForMode = layoutMode === LAYOUT_MODES.HORIZONTAL_32 ? 32 :
        layoutMode === LAYOUT_MODES.HORIZONTAL_64 ? 64 : rows;
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

    } catch (e) {
      console.error('❌ drawWebGL error:', e);
      errors.push(`Exception: ${e}`);
      setDebugInfo((prev: DebugInfo) => ({ ...prev, errors }));
    }
  }, [setDebugInfo]); // stable — reads from paramsRef; setDebugInfo is a stable React setter

  return { drawWebGL, glContextRef };
}
