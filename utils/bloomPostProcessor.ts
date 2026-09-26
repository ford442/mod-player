// utils/bloomPostProcessor.ts
// Lightweight Bloom post-processor for WebGPU.
// Supports both single-layer legacy mode and multi-layer semantic-category bloom.

import { createCheckedShaderModule, createRenderPipelineChecked } from './gpuShaderCompile';

export interface BloomOptions {
  shaderThreshold?: string;
  shaderBlur?: string;
  shaderComposite?: string;
  finalFormat?: GPUTextureFormat; // default 'bgra8unorm'
}

export interface BloomLayer {
  label: string;                // e.g. 'trigger' | 'sustain' | 'expression'
  threshold: number;            // luminance threshold for extraction (0.0–1.0)
  blurRadius: number;           // relative blur width multiplier (1.0 = current default)
  tint: [number, number, number]; // RGB tint applied before composite
  weight: number;               // contribution weight in final composite (0.0–2.0)
}

export interface LayeredBloomOptions extends BloomOptions {
  layers?: BloomLayer[];        // if absent, fall back to single-layer legacy behavior
}

export const DEFAULT_LAYERS: BloomLayer[] = [
  { label: 'trigger',    threshold: 0.85, blurRadius: 0.8, tint: [0.4, 0.6, 1.0], weight: 1.4 },
  { label: 'sustain',    threshold: 0.50, blurRadius: 2.0, tint: [0.2, 0.4, 0.8], weight: 0.7 },
  { label: 'expression', threshold: 0.75, blurRadius: 1.0, tint: [1.0, 0.5, 0.1], weight: 1.0 },
];

/**
 * Format of the texture the scene is rendered into when bloom is active.
 * `rgba16float` is always renderable (no feature needed), so the threshold pass
 * sees unclipped HDR values; the composite pass tonemaps back to the swapchain.
 * Pattern / bezel pipelines drawn inside `render()`'s scene pass must target it.
 */
export const BLOOM_SCENE_FORMAT: GPUTextureFormat = 'rgba16float';

/** Blur uniform: [dirX, dirY, width, height] — 16 bytes. */
const BLUR_UNIFORM_BYTES = 16;

interface LayerResources {
  thresholdTexture: GPUTexture;
  blurTextures: [GPUTexture, GPUTexture];
  thresholdBuffer: GPUBuffer;
  /** Horizontal and vertical blur uniforms are separate buffers: `writeBuffer`
   *  lands before the submitted command buffer runs, so one shared buffer would
   *  make every blur pass in a frame read the last value written. */
  hBlurBuffer: GPUBuffer;
  vBlurBuffer: GPUBuffer;
  thresholdBindGroup: GPUBindGroup;
  hBlurBindGroup: GPUBindGroup;
  vBlurBindGroup: GPUBindGroup;
}

export class BloomPostProcessor {
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext;

  // Shared resources
  private sceneTexture!: GPUTexture;
  private linearSampler!: GPUSampler;

  // Legacy single-layer resources
  private thresholdTexture!: GPUTexture;
  private blurTextures: GPUTexture[] = [];
  private thresholdBuffer!: GPUBuffer;
  private hBlurBuffer!: GPUBuffer;
  private vBlurBuffer!: GPUBuffer;
  private compositeBuffer!: GPUBuffer;

  // Layered resources
  private layers: BloomLayer[] | null = null;
  private layerResources: LayerResources[] = [];
  // Debug: when >= 0, only this layer index contributes (others get weight 0)
  private debugLayerIndex: number = -1;
  private sceneIntensity = 1.0;
  private layeredCompositeBindGroup!: GPUBindGroup;

  // Pipelines (shared between legacy and layered)
  private thresholdPipeline!: GPURenderPipeline;
  private blurPipeline!: GPURenderPipeline;
  private compositePipeline!: GPURenderPipeline;

  // Legacy bind groups
  private thresholdBindGroup!: GPUBindGroup;
  private hBlurBindGroup!: GPUBindGroup;
  private vBlurBindGroup!: GPUBindGroup;
  private compositeBindGroup!: GPUBindGroup;

  // CRT uniform buffer (16 bytes: intensity, scanlineDark, vignetteStrength, _pad)
  private crtUniformBuffer!: GPUBuffer;
  private crtState: [number, number, number] = [0.0, 0.15, 0.4];

  /** Preallocated upload scratch — render() and the per-frame setters allocate nothing. */
  private readonly scratch4 = new Float32Array(4);
  private readonly scratch8 = new Float32Array(8);

  // Shader code
  private thresholdShaderCode?: string | undefined;
  private blurShaderCode?: string | undefined;
  private compositeShaderCode?: string | undefined;

  private finalFormat: GPUTextureFormat;
  private disposed = false;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement, context: GPUCanvasContext, options: LayeredBloomOptions = {}) {
    this.device = device;
    this.canvas = canvas;
    this.context = context;

    this.thresholdShaderCode = options.shaderThreshold;
    this.blurShaderCode = options.shaderBlur;
    this.compositeShaderCode = options.shaderComposite;

    this.finalFormat = options.finalFormat ?? ('bgra8unorm' as GPUTextureFormat);
    this.layers = options.layers ?? null;
  }

  /** Color format pipelines drawn inside the scene pass must target. */
  get sceneFormat(): GPUTextureFormat {
    return BLOOM_SCENE_FORMAT;
  }

  // Base URL for fetching shaders (set this for subpath deployments)
  private baseUrl: string = '';

  public setBaseUrl(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  // Call once after construction
  public async init() {
    const useLayered = this.layers !== null;
    if (useLayered && this.layers!.length !== 3) {
      throw new Error(`Layered bloom requires exactly 3 layers (got ${this.layers!.length})`);
    }

    const thresholdFile = useLayered ? 'bloom_threshold_layered.wgsl' : 'bloom_threshold.wgsl';
    const compositeFile = useLayered ? 'bloom_composite_layered.wgsl' : 'bloom_composite.wgsl';

    // Try to load shader code if not supplied, fetching concurrently if needed
    const [t, b, c] = await Promise.all([
      this.thresholdShaderCode ? Promise.resolve(this.thresholdShaderCode) : this.tryFetch(`${this.baseUrl}/shaders/${thresholdFile}`),
      this.blurShaderCode ? Promise.resolve(this.blurShaderCode) : this.tryFetch(`${this.baseUrl}/shaders/bloom_blur.wgsl`),
      this.compositeShaderCode ? Promise.resolve(this.compositeShaderCode) : this.tryFetch(`${this.baseUrl}/shaders/${compositeFile}`)
    ]);

    this.thresholdShaderCode = t;
    this.blurShaderCode = b;
    this.compositeShaderCode = c;

    // Compile first: a broken bloom shader rejects here, before any texture
    // or buffer is allocated.
    await this.createPipelines();
    if (this.disposed) return;

    this.linearSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    const uniformUsage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    this.compositeBuffer = this.device.createBuffer({ size: 16, usage: uniformUsage });

    if (useLayered) {
      for (let i = 0; i < this.layers!.length; i++) {
        this.layerResources.push({
          thresholdTexture: null as unknown as GPUTexture,
          blurTextures: [null, null] as unknown as [GPUTexture, GPUTexture],
          thresholdBuffer: this.device.createBuffer({ size: 32, usage: uniformUsage }),
          hBlurBuffer: this.device.createBuffer({ size: BLUR_UNIFORM_BYTES, usage: uniformUsage }),
          vBlurBuffer: this.device.createBuffer({ size: BLUR_UNIFORM_BYTES, usage: uniformUsage }),
          thresholdBindGroup: null as unknown as GPUBindGroup,
          hBlurBindGroup: null as unknown as GPUBindGroup,
          vBlurBindGroup: null as unknown as GPUBindGroup,
        });
      }
      this.writeLayerThresholds();
      this.writeLayeredComposite();
    } else {
      this.thresholdBuffer = this.device.createBuffer({ size: 16, usage: uniformUsage });
      this.hBlurBuffer = this.device.createBuffer({ size: BLUR_UNIFORM_BYTES, usage: uniformUsage });
      this.vBlurBuffer = this.device.createBuffer({ size: BLUR_UNIFORM_BYTES, usage: uniformUsage });

      // Default values
      this.write4(this.thresholdBuffer, 0.8, 0.2, 0.0, 0.0);
      this.write4(this.compositeBuffer, 1.2, 1.0, 0.0, 0.0);
    }

    // CRT uniform buffer — shared between legacy and layered modes
    // 16 bytes: [intensity, scanlineDark, vignetteStrength, _pad]
    this.crtUniformBuffer = this.device.createBuffer({ size: 16, usage: uniformUsage });
    // Default: intensity=0.0 means CRT is off (bit-identical output to pre-CRT).
    // scanlineDark and vignetteStrength are pre-set to their recommended defaults
    // so enabling CRT via updateCRT(1.0) just works without extra configuration.
    this.write4(this.crtUniformBuffer, this.crtState[0], this.crtState[1], this.crtState[2], 0.0);

    this.allocateTextures(this.canvas.width, this.canvas.height);
    this.createBindGroups();
  }

  private async tryFetch(path: string): Promise<string> {
    try {
      const r = await fetch(path);
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return await r.text();
    } catch (e) {
      throw new Error(`Could not load shader at ${path}. Provide shader code directly via options.shader* or import with ?raw in Vite.`);
    }
  }

  private write4(buffer: GPUBuffer, a: number, b: number, c: number, d: number): void {
    const s = this.scratch4;
    s[0] = a; s[1] = b; s[2] = c; s[3] = d;
    this.device.queue.writeBuffer(buffer, 0, s);
  }

  /** Per-layer threshold uniforms (32 bytes: threshold, knee, tint rgb, pad×3). Layer config is fixed, so this runs once. */
  private writeLayerThresholds(): void {
    if (!this.layers) return;
    const s = this.scratch8;
    for (let i = 0; i < this.layerResources.length; i++) {
      const config = this.layers[i]!;
      s[0] = config.threshold;
      s[1] = 0.2; // knee
      s[2] = config.tint[0];
      s[3] = config.tint[1];
      s[4] = config.tint[2];
      s[5] = 0.0; s[6] = 0.0; s[7] = 0.0;
      this.device.queue.writeBuffer(this.layerResources[i]!.thresholdBuffer, 0, s);
    }
  }

  private writeLayeredComposite(): void {
    if (!this.layers || !this.compositeBuffer) return;
    const dbg = this.debugLayerIndex;
    const w = (i: number) => ((dbg < 0 || dbg === i) ? this.layers![i]!.weight : 0);
    this.write4(this.compositeBuffer, this.sceneIntensity, w(0), w(1), w(2));
  }

  /** Blur direction/resolution uniforms. Only depend on size and radius, so written on init/resize only. */
  private writeBlurUniforms(width: number, height: number): void {
    if (this.layers) {
      for (let i = 0; i < this.layerResources.length; i++) {
        const radius = this.layers[i]!.blurRadius;
        const layer = this.layerResources[i]!;
        this.write4(layer.hBlurBuffer, radius, 0, width, height);
        this.write4(layer.vBlurBuffer, 0, radius, width, height);
      }
    } else {
      this.write4(this.hBlurBuffer, 1, 0, width, height);
      this.write4(this.vBlurBuffer, 0, 1, width, height);
    }
  }

  private async createPipelines() {
    // Full-screen triangle vertex shader.
    // Outputs @builtin(position) for the rasterizer and @location(0) uv in [0,1]
    // mapped from clip-space so fragment shaders can sample textures correctly.
    const fullscreenVS = `
      struct VSOut {
        @builtin(position) pos: vec4<f32>,
        @location(0) uv: vec2<f32>,
      };
      @vertex
      fn vs(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
          const pos = array<vec2<f32>, 6>(
              vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0),
              vec2<f32>(-1.0, -1.0), vec2<f32>(-1.0, 3.0), vec2<f32>(3.0, -1.0)
          );
          let p = pos[vertexIndex];
          return VSOut(
              vec4<f32>(p, 0.0, 1.0),
              vec2<f32>((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5)
          );
      }
    `;

    if (!this.thresholdShaderCode || !this.blurShaderCode || !this.compositeShaderCode) {
      throw new Error('Shaders not loaded');
    }

    const device = this.device;
    const [vsModule, thresholdModule, blurModule, compositeModule] = await Promise.all([
      createCheckedShaderModule(device, fullscreenVS, 'bloom_fullscreen_vs'),
      createCheckedShaderModule(device, this.thresholdShaderCode, 'bloom_threshold'),
      createCheckedShaderModule(device, this.blurShaderCode, 'bloom_blur'),
      createCheckedShaderModule(device, this.compositeShaderCode, 'bloom_composite'),
    ]);

    const fullscreen = (fragment: GPUShaderModule, format: GPUTextureFormat): GPURenderPipelineDescriptor => ({
      layout: 'auto',
      vertex: { module: vsModule, entryPoint: 'vs' },
      fragment: { module: fragment, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });

    [this.thresholdPipeline, this.blurPipeline, this.compositePipeline] = await Promise.all([
      createRenderPipelineChecked(device, fullscreen(thresholdModule, 'rgba16float'), 'bloom_threshold'),
      createRenderPipelineChecked(device, fullscreen(blurModule, 'rgba16float'), 'bloom_blur'),
      createRenderPipelineChecked(device, fullscreen(compositeModule, this.finalFormat), 'bloom_composite'),
    ]);
  }

  private createBindGroups() {
    if (this.layers) {
      // Layered bind groups
      const thresholdLayout = this.thresholdPipeline.getBindGroupLayout(0);
      const blurLayout = this.blurPipeline.getBindGroupLayout(0);
      const compositeLayout = this.compositePipeline.getBindGroupLayout(0);

      for (const layer of this.layerResources) {
        layer.thresholdBindGroup = this.device.createBindGroup({
          layout: thresholdLayout,
          entries: [
            { binding: 0, resource: this.sceneTexture.createView() },
            { binding: 1, resource: this.linearSampler },
            { binding: 2, resource: { buffer: layer.thresholdBuffer } },
          ],
        });

        layer.hBlurBindGroup = this.device.createBindGroup({
          layout: blurLayout,
          entries: [
            { binding: 0, resource: layer.thresholdTexture.createView() },
            { binding: 1, resource: this.linearSampler },
            { binding: 2, resource: { buffer: layer.hBlurBuffer } },
          ],
        });

        layer.vBlurBindGroup = this.device.createBindGroup({
          layout: blurLayout,
          entries: [
            { binding: 0, resource: layer.blurTextures[0].createView() },
            { binding: 1, resource: this.linearSampler },
            { binding: 2, resource: { buffer: layer.vBlurBuffer } },
          ],
        });
      }

      this.layeredCompositeBindGroup = this.device.createBindGroup({
        layout: compositeLayout,
        entries: [
          { binding: 0, resource: this.sceneTexture.createView() },
          { binding: 1, resource: this.linearSampler },
          { binding: 2, resource: this.layerResources[0]!.blurTextures[1].createView() },
          { binding: 3, resource: this.layerResources[1]!.blurTextures[1].createView() },
          { binding: 4, resource: this.layerResources[2]!.blurTextures[1].createView() },
          { binding: 5, resource: { buffer: this.compositeBuffer } },
        ],
      });
    } else {
      // Legacy bind groups
      this.thresholdBindGroup = this.device.createBindGroup({
        layout: this.thresholdPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sceneTexture.createView() },
          { binding: 1, resource: this.linearSampler },
          { binding: 2, resource: { buffer: this.thresholdBuffer } },
        ],
      });

      // Horizontal blur bind group
      const blurLayout = this.blurPipeline.getBindGroupLayout(0);
      this.hBlurBindGroup = this.device.createBindGroup({
        layout: blurLayout,
        entries: [
          { binding: 0, resource: this.thresholdTexture.createView() },
          { binding: 1, resource: this.linearSampler },
          { binding: 2, resource: { buffer: this.hBlurBuffer } },
        ],
      });

      // Vertical blur bind group
      this.vBlurBindGroup = this.device.createBindGroup({
        layout: blurLayout,
        entries: [
          { binding: 0, resource: (this.blurTextures[0] ?? this.sceneTexture).createView() },
          { binding: 1, resource: this.linearSampler },
          { binding: 2, resource: { buffer: this.vBlurBuffer } },
        ],
      });

      // Composite bind group
      this.compositeBindGroup = this.device.createBindGroup({
        layout: this.compositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sceneTexture.createView() },
          { binding: 1, resource: this.linearSampler },
          { binding: 2, resource: (this.blurTextures[1] ?? this.sceneTexture).createView() },
          { binding: 3, resource: this.linearSampler },
          { binding: 4, resource: { buffer: this.compositeBuffer } },
          { binding: 5, resource: { buffer: this.crtUniformBuffer } },
        ],
      });
    }
  }

  /** True once init() has finished and render() will draw. */
  get isReady(): boolean {
    return !this.disposed && !!this.sceneTexture;
  }

  public render(commandEncoder: GPUCommandEncoder, renderScene: (pass: GPURenderPassEncoder) => void) {
    if (!this.isReady) return;
    if (this.layers) {
      this.renderLayered(commandEncoder, renderScene);
    } else {
      this.renderLegacy(commandEncoder, renderScene);
    }
  }

  private fullscreenPass(
    commandEncoder: GPUCommandEncoder,
    target: GPUTexture,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
  ): void {
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: target.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
  }

  private scenePass(commandEncoder: GPUCommandEncoder, renderScene: (pass: GPURenderPassEncoder) => void): void {
    const scenePass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.sceneTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderScene(scenePass);
    scenePass.end();
  }

  private renderLegacy(commandEncoder: GPUCommandEncoder, renderScene: (pass: GPURenderPassEncoder) => void) {
    // PASS 1: Scene -> HDR scene texture
    this.scenePass(commandEncoder, renderScene);

    const blurTex0 = this.blurTextures[0];
    const blurTex1 = this.blurTextures[1];
    if (!blurTex0 || !blurTex1) return;

    // PASS 2: Brightness threshold (to smaller texture)
    this.fullscreenPass(commandEncoder, this.thresholdTexture, this.thresholdPipeline, this.thresholdBindGroup);
    // PASS 3: Horizontal blur -> blurTextures[0]
    this.fullscreenPass(commandEncoder, blurTex0, this.blurPipeline, this.hBlurBindGroup);
    // PASS 4: Vertical blur -> blurTextures[1]
    this.fullscreenPass(commandEncoder, blurTex1, this.blurPipeline, this.vBlurBindGroup);
    // PASS 5: Composite -> swapchain
    this.fullscreenPass(commandEncoder, this.context.getCurrentTexture(), this.compositePipeline, this.compositeBindGroup);
  }

  private renderLayered(commandEncoder: GPUCommandEncoder, renderScene: (pass: GPURenderPassEncoder) => void) {
    // PASS 1: Scene -> HDR scene texture
    this.scenePass(commandEncoder, renderScene);

    // Per-layer threshold + blur passes
    for (const layer of this.layerResources) {
      // Threshold pass: sceneTexture -> layer.thresholdTexture
      this.fullscreenPass(commandEncoder, layer.thresholdTexture, this.thresholdPipeline, layer.thresholdBindGroup);
      // H-blur: layer.thresholdTexture -> layer.blurTextures[0]
      this.fullscreenPass(commandEncoder, layer.blurTextures[0], this.blurPipeline, layer.hBlurBindGroup);
      // V-blur: layer.blurTextures[0] -> layer.blurTextures[1]
      this.fullscreenPass(commandEncoder, layer.blurTextures[1], this.blurPipeline, layer.vBlurBindGroup);
    }

    // Composite pass: scene + all blurred layers -> swapchain
    this.fullscreenPass(commandEncoder, this.context.getCurrentTexture(), this.compositePipeline, this.layeredCompositeBindGroup);
  }

  public updateUniforms(bloomIntensity: number, threshold: number = 0.8, knee: number = 0.2, sceneIntensity: number = 1.0) {
    if (this.disposed || !this.compositeBuffer) return;
    if (!this.layers) {
      // compositeBuffer: [bloomIntensity, sceneIntensity]
      this.write4(this.compositeBuffer, bloomIntensity, sceneIntensity, 0.0, 0.0);
      // thresholdBuffer: [threshold, knee]
      this.write4(this.thresholdBuffer, threshold, knee, 0.0, 0.0);
    } else {
      // Layered mode: update sceneIntensity and keep per-layer weights
      this.sceneIntensity = sceneIntensity;
      this.writeLayeredComposite();
    }
  }

  // Apply a bloom preset with all parameters
  public applyPreset(preset: { intensity: number; threshold: number; knee: number }, sceneIntensity: number = 1.0) {
    this.updateUniforms(preset.intensity, preset.threshold, preset.knee, sceneIntensity);
  }

  /**
   * Debug visualization: isolate a single bloom layer.
   * Pass layerIndex 0/1/2 to show only that layer's contribution.
   * Pass -1 to restore all layers.
   *
   * Layer indices for three-emitter shaders:
   *   0 = trigger  (note-on flash, blue)
   *   1 = sustain  (sustain tail, cool blue)
   *   2 = expression / trace  (amber for LED, green for oscilloscope)
   */
  public setDebugLayer(layerIndex: number): void {
    this.debugLayerIndex = layerIndex;
    if (!this.disposed) this.writeLayeredComposite();
  }

  /** Returns the label of the currently isolated layer, or null if all layers are active. */
  public getDebugLayerLabel(): string | null {
    if (this.debugLayerIndex < 0 || !this.layers) return null;
    return this.layers[this.debugLayerIndex]?.label ?? null;
  }

  // Update CRT scanline + vignette uniforms.
  // Call once per frame before bloomPostProcessor.render().
  // intensity=0.0 → no effect (bit-identical to pre-CRT output).
  public updateCRT(intensity: number, scanlineDark: number = 0.15, vignetteStrength: number = 0.4) {
    if (this.disposed || !this.crtUniformBuffer) return;
    const crt = this.crtState;
    if (crt[0] === intensity && crt[1] === scanlineDark && crt[2] === vignetteStrength) return;
    crt[0] = intensity; crt[1] = scanlineDark; crt[2] = vignetteStrength;
    this.write4(this.crtUniformBuffer, intensity, scanlineDark, vignetteStrength, 0.0);
  }

  private createRenderTexture(width: number, height: number, format: GPUTextureFormat): GPUTexture {
    return this.device.createTexture({
      size: { width, height },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  private destroyTextures(): void {
    this.sceneTexture?.destroy();
    this.thresholdTexture?.destroy();
    this.blurTextures.forEach(t => t.destroy());
    this.blurTextures = [];
    for (const layer of this.layerResources) {
      layer.thresholdTexture?.destroy();
      layer.blurTextures[0]?.destroy();
      layer.blurTextures[1]?.destroy();
    }
  }

  /** (Re)create size-dependent textures and the blur uniforms that encode the size. */
  private allocateTextures(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const bw = Math.max(1, Math.floor(w / 2));
    const bh = Math.max(1, Math.floor(h / 2));

    // HDR scene target — the pattern/bezel pipelines drawn in the scene pass
    // are built for BLOOM_SCENE_FORMAT (see WebGPURenderer).
    this.sceneTexture = this.createRenderTexture(w, h, BLOOM_SCENE_FORMAT);

    if (this.layers) {
      for (const layer of this.layerResources) {
        layer.thresholdTexture = this.createRenderTexture(bw, bh, 'rgba16float');
        layer.blurTextures = [
          this.createRenderTexture(bw, bh, 'rgba16float'),
          this.createRenderTexture(bw, bh, 'rgba16float'),
        ];
      }
    } else {
      this.thresholdTexture = this.createRenderTexture(bw, bh, 'rgba16float');
      this.blurTextures = [
        this.createRenderTexture(bw, bh, 'rgba16float'),
        this.createRenderTexture(bw, bh, 'rgba16float'),
      ];
    }

    this.writeBlurUniforms(bw, bh);
  }

  public resize(width: number, height: number) {
    if (this.disposed || !this.sceneTexture) return;
    if (this.sceneTexture.width === Math.max(1, width) && this.sceneTexture.height === Math.max(1, height)) return;

    this.destroyTextures();
    this.allocateTextures(width, height);
    // Recreate bind groups with new texture views
    this.createBindGroups();
  }

  public destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.destroyTextures();

    this.thresholdBuffer?.destroy();
    this.hBlurBuffer?.destroy();
    this.vBlurBuffer?.destroy();
    this.compositeBuffer?.destroy();
    this.crtUniformBuffer?.destroy();

    for (const layer of this.layerResources) {
      layer.thresholdBuffer?.destroy();
      layer.hBlurBuffer?.destroy();
      layer.vBlurBuffer?.destroy();
    }
    this.layerResources = [];
  }
}
