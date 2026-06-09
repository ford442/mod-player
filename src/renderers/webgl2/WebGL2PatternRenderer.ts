import type { ChannelShadowState } from '../../../types';
import type { WebGPURenderParams } from '../../../hooks/useWebGPURender';
import type { WebGL2DebugConfig } from '../types';
import { packPatternMatrixHighPrecision } from '../../../utils/gpuPacking';
import {
  GRID_RECT,
  calculateHorizontalCellSize,
  calculateCapScale,
  getLayoutModeFromShader,
  LAYOUT_MODES,
} from '../../../utils/geometryConstants';
import { getShaderMeta } from '../../../utils/shaderRegistry';
import { detectRuntimeBase } from '../../../src/lib/paths';
import { CHASSIS_VERTEX, CHASSIS_FRAGMENT } from './shaders/chassis';
import { buildVertexShader, buildPatternFragmentShader } from './shaders/pattern';
import { WebGL2Bloom } from './WebGL2Bloom';
import { debugModeToUniform, createDebugConfig } from './debugModes';

const DEFAULT_ROWS = 64;
const DEFAULT_CHANNELS = 4;

type GLProgram = {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

type PatternResources = {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  cellTexture: WebGLTexture;
  stateTexture: WebGLTexture;
  capTexture: WebGLTexture;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

function compileShader(gl: WebGL2RenderingContext, type: number, src: string, label: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? 'unknown';
    gl.deleteShader(s);
    throw new Error(`${label} shader error: ${log}`);
  }
  return s;
}

function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader, label: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? 'unknown';
    gl.deleteProgram(p);
    throw new Error(`${label} link error: ${log}`);
  }
  return p;
}

function collectUniforms(gl: WebGL2RenderingContext, program: WebGLProgram, names: string[]): Record<string, WebGLUniformLocation | null> {
  const out: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) out[n] = gl.getUniformLocation(program, n);
  return out;
}

/**
 * Full-scene WebGL2 pattern renderer — reference implementation for WebGPU WGSL shaders.
 * Renders chassis background + instanced LED lens caps + optional bloom.
 */
export class WebGL2PatternRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private chassis: GLProgram | null = null;
  private chassisVao: WebGLVertexArrayObject | null = null;
  private chassisBuffer: WebGLBuffer | null = null;
  private pattern: PatternResources | null = null;
  private bloom: WebGL2Bloom | null = null;
  private stateData = new Float32Array(0);
  private shaderFile = '';
  private debug: WebGL2DebugConfig = createDebugConfig();
  private scrollOffset = 0;
  private lastTimeSec = 0;
  init(canvas: HTMLCanvasElement, shaderFile: string): boolean {
    this.destroy();
    const gl = canvas.getContext('webgl2', { alpha: false, premultipliedAlpha: false, antialias: true });
    if (!gl) return false;

    this.gl = gl;
    this.canvas = canvas;
    this.shaderFile = shaderFile;

    this.initChassis(gl);
    this.initPattern(gl, shaderFile);
    this.bloom = new WebGL2Bloom(gl);
    this.bloom.resize(canvas.width, canvas.height);

    gl.enable(gl.BLEND);
    return true;
  }

  private initChassis(gl: WebGL2RenderingContext): void {
    const vs = compileShader(gl, gl.VERTEX_SHADER, CHASSIS_VERTEX, 'chassis-vs');
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, CHASSIS_FRAGMENT, 'chassis-fs');
    const program = linkProgram(gl, vs, fs, 'chassis');
    this.chassis = {
      program,
      uniforms: collectUniforms(gl, program, [
        'u_resolution', 'u_timeSec', 'u_dimFactor', 'u_themeBlend',
        'u_vignetteStrength', 'u_filmGrain', 'u_invertMix', 'u_nightPreset',
        'u_innerRadius', 'u_outerRadius', 'u_layoutMode',
      ]),
    };
    this.chassisVao = gl.createVertexArray();
    this.chassisBuffer = gl.createBuffer();
    gl.bindVertexArray(this.chassisVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.chassisBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private initPattern(gl: WebGL2RenderingContext, shaderFile: string): void {
    const useNoteSustainTailMode = shaderFile.includes('v0.45b');
    const isV021 = shaderFile.includes('v0.21');
    const vsSource = buildVertexShader(useNoteSustainTailMode, isV021);
    const fsSource = buildPatternFragmentShader(useNoteSustainTailMode, isV021);

    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource, 'pattern-vs');
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource, 'pattern-fs');
    const program = linkProgram(gl, vs, fs, 'pattern');

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
      -0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const cellTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, cellTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    const stateTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, stateTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    const capTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, capTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const capImg = new Image();
    capImg.onload = () => {
      if (!this.gl) return;
      this.gl.bindTexture(this.gl.TEXTURE_2D, capTexture);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, capImg);
    };
    capImg.src = `${detectRuntimeBase()}unlit-button.png`;

    this.pattern = {
      program,
      vao,
      buffer,
      cellTexture,
      stateTexture,
      capTexture,
      uniforms: collectUniforms(gl, program, [
        'u_resolution', 'u_cellSize', 'u_offset', 'u_cols', 'u_rows', 'u_playhead',
        'u_layoutMode', 'u_invertChannels', 'u_cellData', 'u_channelState',
        'u_capTexture', 'u_bloomIntensity', 'u_timeSec', 'u_innerRadius', 'u_outerRadius',
        'u_debugMode',
      ]),
    };
    gl.bindVertexArray(null);
  }

  resize(width: number, height: number): void {
    this.bloom?.resize(width, height);
  }

  setDebugConfig(config: Partial<WebGL2DebugConfig>): void {
    this.debug = { ...this.debug, ...config };
  }

  getDebugConfig(): WebGL2DebugConfig {
    return { ...this.debug };
  }

  setCRT(enabled: boolean): void {
    this.bloom?.setCRT(enabled);
  }

  render(
    params: WebGPURenderParams,
    padTopChannel: boolean,
    liteMode: boolean,
    onDebug?: (info: { layoutMode: string; uniforms: Record<string, number | string>; errors: string[] }) => void,
  ): void {
    const gl = this.gl;
    const canvas = this.canvas;
    if (!gl || !canvas || !this.chassis || !this.pattern) return;

    const errors: string[] = [];
    const uniformVals: Record<string, number | string> = {};

    const useBloom = !this.debug.skipBloom && !liteMode;
    const meta = getShaderMeta(this.shaderFile);
    const bloomProfile = meta?.bloomProfile;

    if (useBloom && bloomProfile && this.bloom) {
      this.bloom.setBloomParams(params.bloomIntensity, params.bloomThreshold);
      this.bloom.bindSceneTarget();
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const layoutMode = this.resolveLayoutMode(params);
    const layoutModeName = layoutMode === LAYOUT_MODES.HORIZONTAL_32 ? '32-STEP'
      : layoutMode === LAYOUT_MODES.HORIZONTAL_64 ? '64-STEP' : 'CIRCULAR';

    this.drawChassis(gl, params, layoutMode, uniformVals);
    this.drawPattern(gl, params, padTopChannel, layoutMode, layoutModeName, uniformVals, errors);

    if (useBloom && bloomProfile && this.bloom) {
      this.bloom.compositeToScreen();
    }

    onDebug?.({ layoutMode: layoutModeName, uniforms: uniformVals, errors });
  }

  private resolveLayoutMode(params: WebGPURenderParams): number {
    const shaderFile = this.shaderFile;
    let layoutMode = getLayoutModeFromShader(shaderFile);
    if (shaderFile.includes('v0.21') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40')) {
      layoutMode = params.stepsLength === 64 ? LAYOUT_MODES.HORIZONTAL_64 : LAYOUT_MODES.HORIZONTAL_32;
    }
    return layoutMode;
  }

  private drawChassis(
    gl: WebGL2RenderingContext,
    params: WebGPURenderParams,
    layoutMode: number,
    uniformVals: Record<string, number | string>,
  ): void {
    const chassis = this.chassis!;
    const canvas = this.canvas!;
    const minDim = Math.min(canvas.width, canvas.height);

    gl.useProgram(chassis.program);
    gl.bindVertexArray(this.chassisVao);

    const setF = (name: string, ...args: [number] | [number, number]) => {
      const loc = chassis.uniforms[name];
      if (!loc) return;
      if (args.length === 1) gl.uniform1f(loc, args[0]!);
      else gl.uniform2f(loc, args[0]!, args[1]!);
    };
    const setI = (name: string, v: number) => {
      const loc = chassis.uniforms[name];
      if (loc) gl.uniform1i(loc, v);
    };

    setF('u_resolution', canvas.width, canvas.height);
    setF('u_timeSec', params.timeSec || performance.now() / 1000);
    setF('u_dimFactor', params.dimFactor ?? 1);
    setF('u_themeBlend', params.themeBlend ?? 0);
    setF('u_vignetteStrength', params.vignetteStrength ?? 0);
    setF('u_filmGrain', params.filmGrain ?? 0);
    setF('u_invertMix', params.invertMix ?? 0);
    setI('u_nightPreset', params.nightPreset ?? 0);
    setF('u_innerRadius', minDim * 0.15);
    setF('u_outerRadius', minDim * 0.45);
    setI('u_layoutMode', layoutMode === LAYOUT_MODES.CIRCULAR ? 1 : 0);

    uniformVals['chassis_themeBlend'] = (params.themeBlend ?? 0).toFixed(2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  private drawPattern(
    gl: WebGL2RenderingContext,
    params: WebGPURenderParams,
    padTopChannel: boolean,
    layoutMode: number,
    layoutModeName: string,
    uniformVals: Record<string, number | string>,
    errors: string[],
  ): void {
    const res = this.pattern!;
    const canvas = this.canvas!;
    const matrix = params.matrix;
    if (!matrix) return;

    const rawCols = matrix.numChannels || DEFAULT_CHANNELS;
    const cols = padTopChannel ? rawCols + 1 : rawCols;
    const rows = matrix.numRows || DEFAULT_ROWS;

    // Upload cell texture
    const { packedData } = packPatternMatrixHighPrecision(matrix, padTopChannel);
    gl.bindTexture(gl.TEXTURE_2D, res.cellTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32UI, cols, rows, 0, gl.RG_INTEGER, gl.UNSIGNED_INT, packedData);

    // Upload channel state
    const requiredSize = cols * 2 * 4;
    if (this.stateData.length !== requiredSize) {
      this.stateData = new Float32Array(requiredSize);
    }
    const chans = params.channels || [];
    const startIdx = padTopChannel ? 1 : 0;
    if (startIdx === 1) {
      for (let j = 0; j < 4; j++) {
        this.stateData[j] = 0;
        this.stateData[cols * 4 + j] = 0;
      }
    }
    for (let i = 0; i < (matrix.numChannels || DEFAULT_CHANNELS); i++) {
      const ch: ChannelShadowState = chans[i] ?? {
        volume: 0, pan: 0.5, freq: 440, trigger: 0, noteAge: 1000,
        activeEffect: 0, effectValue: 0, isMuted: 0,
      };
      const colIdx = i + startIdx;
      const r0 = colIdx * 4;
      this.stateData[r0] = ch.volume ?? 0;
      this.stateData[r0 + 1] = ch.pan ?? 0.5;
      this.stateData[r0 + 2] = ch.freq ?? 440;
      this.stateData[r0 + 3] = ch.trigger ?? 0;
      const r1 = (cols + colIdx) * 4;
      this.stateData[r1] = ch.noteAge ?? 1000;
      this.stateData[r1 + 1] = ch.activeEffect ?? 0;
      this.stateData[r1 + 2] = ch.effectValue ?? 0;
      this.stateData[r1 + 3] = ch.isMuted ?? 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, res.stateTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, cols, 2, 0, gl.RGBA, gl.FLOAT, this.stateData);

    gl.useProgram(res.program);
    gl.bindVertexArray(res.vao);

    const livePlayhead = this.resolvePlayhead(params);
    uniformVals['u_playhead'] = livePlayhead.toFixed(2);

    let effectiveCellW = params.cellWidth;
    let effectiveCellH = params.cellHeight;
    let offsetX = 0;
    let offsetY = 0;

    if (layoutMode === LAYOUT_MODES.HORIZONTAL_32) {
      const m = calculateHorizontalCellSize(canvas.width, canvas.height, 32, cols);
      effectiveCellW = m.cellW;
      effectiveCellH = m.cellH;
      offsetX = m.offsetX;
      offsetY = m.offsetY;
    } else if (layoutMode === LAYOUT_MODES.HORIZONTAL_64) {
      const m = calculateHorizontalCellSize(canvas.width, canvas.height, 64, cols);
      effectiveCellW = m.cellW;
      effectiveCellH = m.cellH;
      offsetX = m.offsetX;
      offsetY = m.offsetY;
    }

    const minDim = Math.min(canvas.width, canvas.height);
    const innerRadius = minDim * 0.15;
    const outerRadius = minDim * 0.45;

    const u = res.uniforms;
    if (u.u_resolution) gl.uniform2f(u.u_resolution, canvas.width, canvas.height);
    if (u.u_cols) gl.uniform1f(u.u_cols, cols);
    if (u.u_rows) gl.uniform1f(u.u_rows, rows);
    if (u.u_playhead) gl.uniform1f(u.u_playhead, livePlayhead);
    if (u.u_invertChannels) gl.uniform1i(u.u_invertChannels, params.invertChannels ? 1 : 0);
    if (u.u_bloomIntensity) gl.uniform1f(u.u_bloomIntensity, params.bloomIntensity ?? 1);
    if (u.u_timeSec) gl.uniform1f(u.u_timeSec, params.timeSec || performance.now() / 1000);
    if (u.u_innerRadius) gl.uniform1f(u.u_innerRadius, innerRadius);
    if (u.u_outerRadius) gl.uniform1f(u.u_outerRadius, outerRadius);
    if (u.u_offset) gl.uniform2f(u.u_offset, offsetX, offsetY);
    if (u.u_cellSize) gl.uniform2f(u.u_cellSize, effectiveCellW, effectiveCellH);
    if (u.u_layoutMode) gl.uniform1i(u.u_layoutMode, layoutMode);
    if (u.u_debugMode) gl.uniform1i(u.u_debugMode, debugModeToUniform(this.debug.mode));

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.cellTexture);
    if (u.u_cellData) gl.uniform1i(u.u_cellData, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, res.stateTexture);
    if (u.u_channelState) gl.uniform1i(u.u_channelState, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, res.capTexture);
    if (u.u_capTexture) gl.uniform1i(u.u_capTexture, 2);

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    uniformVals['capScale'] = calculateCapScale(effectiveCellW, effectiveCellH, pixelRatio).toFixed(1);
    uniformVals['GRID_RECT'] = `${GRID_RECT.x}, ${GRID_RECT.y}, ${GRID_RECT.w}, ${GRID_RECT.h}`;
    uniformVals['renderer'] = 'webgl2';
    uniformVals['debugMode'] = this.debug.mode;

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    const stepsForMode = layoutMode === LAYOUT_MODES.HORIZONTAL_32 ? 32
      : layoutMode === LAYOUT_MODES.HORIZONTAL_64 ? 64 : 64;
    const totalInstances = stepsForMode * cols;
    uniformVals['totalInstances'] = totalInstances;
    uniformVals['layoutMode'] = layoutModeName;

    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, totalInstances);
    gl.bindVertexArray(null);

    const err = gl.getError();
    if (err !== gl.NO_ERROR) errors.push(`GL error 0x${err.toString(16)}`);
  }

  private resolvePlayhead(params: WebGPURenderParams): number {
    const base = params.playbackStateRef?.current?.playheadRow ?? params.playheadRow;
    if (this.debug.scrollSpeed === 1) return base;

    const now = performance.now() / 1000;
    if (this.lastTimeSec > 0) {
      const dt = (now - this.lastTimeSec) * this.debug.scrollSpeed;
      this.scrollOffset += dt * (params.bpm / 60) * 0.25;
    }
    this.lastTimeSec = now;
    const rows = params.matrix?.numRows ?? DEFAULT_ROWS;
    return (base + this.scrollOffset) % rows;
  }

  readPixels(): Uint8Array | null {
    const gl = this.gl;
    const canvas = this.canvas;
    if (!gl || !canvas) return null;
    const buf = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }

  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  destroy(): void {
    const gl = this.gl;
    if (gl && this.pattern) {
      gl.deleteProgram(this.pattern.program);
      gl.deleteVertexArray(this.pattern.vao);
      gl.deleteBuffer(this.pattern.buffer);
      gl.deleteTexture(this.pattern.cellTexture);
      gl.deleteTexture(this.pattern.stateTexture);
      gl.deleteTexture(this.pattern.capTexture);
    }
    if (gl && this.chassis) {
      gl.deleteProgram(this.chassis.program);
    }
    if (gl && this.chassisVao) gl.deleteVertexArray(this.chassisVao);
    if (gl && this.chassisBuffer) gl.deleteBuffer(this.chassisBuffer);
    this.bloom?.destroy();
    this.gl = null;
    this.canvas = null;
    this.chassis = null;
    this.pattern = null;
    this.bloom = null;
  }
}
