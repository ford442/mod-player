import {
  FULLSCREEN_VERTEX,
  BLUR_FRAGMENT,
  COMPOSITE_FRAGMENT,
} from './shaders/bloom';

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown';
    gl.deleteShader(shader);
    throw new Error(`Bloom shader compile failed: ${log}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown';
    gl.deleteProgram(program);
    throw new Error(`Bloom program link failed: ${log}`);
  }
  return program;
}

type FBO = { fbo: WebGLFramebuffer; texture: WebGLTexture };

/**
 * Lightweight 2-pass separable bloom for the WebGL2 reference renderer.
 * Mirrors the intent of utils/bloomPostProcessor.ts without WebGPU dependencies.
 */
export class WebGL2Bloom {
  private gl: WebGL2RenderingContext;
  private width = 0;
  private height = 0;
  private quadVao: WebGLVertexArrayObject;
  private quadBuffer: WebGLBuffer;
  private blurProgram: WebGLProgram;
  private compositeProgram: WebGLProgram;
  private sceneFbo: FBO | null = null;
  private pingFbo: FBO | null = null;
  private pongFbo: FBO | null = null;
  private threshold = 0.8;
  private intensity = 1.0;
  private crtEnabled = 0.0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.quadVao = gl.createVertexArray()!;
    this.quadBuffer = gl.createBuffer()!;
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const vs = compileShader(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX);
    this.blurProgram = linkProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, BLUR_FRAGMENT));
    this.compositeProgram = linkProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, COMPOSITE_FRAGMENT));
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.destroyFbos();
    this.width = width;
    this.height = height;
    this.sceneFbo = this.createFbo(width, height);
    this.pingFbo = this.createFbo(width, height);
    this.pongFbo = this.createFbo(width, height);
  }

  setBloomParams(intensity: number, threshold: number): void {
    this.intensity = intensity;
    this.threshold = threshold;
  }

  setCRT(enabled: boolean): void {
    this.crtEnabled = enabled ? 1.0 : 0.0;
  }

  /** Returns the scene FBO to render the pattern pass into. */
  bindSceneTarget(): void {
    const gl = this.gl;
    if (!this.sceneFbo) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo.fbo);
    gl.viewport(0, 0, this.width, this.height);
  }

  /** Blur scene → composite to default framebuffer. */
  compositeToScreen(): void {
    const gl = this.gl;
    if (!this.sceneFbo || !this.pingFbo || !this.pongFbo) return;

    const texel = [1 / this.width, 1 / this.height];

    // Horizontal blur: scene → ping
    this.runBlur(this.sceneFbo.texture, this.pingFbo, [1, 0], texel);
    // Vertical blur: ping → pong
    this.runBlur(this.pingFbo.texture, this.pongFbo, [0, 1], texel);

    // Composite to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.compositeProgram);
    gl.bindVertexArray(this.quadVao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneFbo.texture);
    gl.uniform1i(gl.getUniformLocation(this.compositeProgram, 'u_scene')!, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.pongFbo.texture);
    gl.uniform1i(gl.getUniformLocation(this.compositeProgram, 'u_bloom')!, 1);

    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_bloomIntensity')!, this.intensity);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_crtEnabled')!, this.crtEnabled);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private runBlur(
    source: WebGLTexture,
    target: FBO,
    direction: [number, number],
    texel: number[],
  ): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.blurProgram);
    gl.bindVertexArray(this.quadVao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(gl.getUniformLocation(this.blurProgram, 'u_source')!, 0);
    gl.uniform2f(gl.getUniformLocation(this.blurProgram, 'u_direction')!, direction[0], direction[1]);
    gl.uniform2f(gl.getUniformLocation(this.blurProgram, 'u_texelSize')!, texel[0]!, texel[1]!);
    gl.uniform1f(gl.getUniformLocation(this.blurProgram, 'u_threshold')!, this.threshold);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private createFbo(width: number, height: number): FBO {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, texture };
  }

  private destroyFbos(): void {
    const gl = this.gl;
    for (const entry of [this.sceneFbo, this.pingFbo, this.pongFbo]) {
      if (!entry) continue;
      gl.deleteFramebuffer(entry.fbo);
      gl.deleteTexture(entry.texture);
    }
    this.sceneFbo = null;
    this.pingFbo = null;
    this.pongFbo = null;
  }

  destroy(): void {
    this.destroyFbos();
    const gl = this.gl;
    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.compositeProgram);
    gl.deleteVertexArray(this.quadVao);
    gl.deleteBuffer(this.quadBuffer);
  }
}
