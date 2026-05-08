// utils/bloomPostProcessor.ts
// Lightweight Bloom post-processor for WebGPU.
// Supports both single-layer legacy mode and multi-layer semantic-category bloom.

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

interface LayerResources {
  thresholdTexture: GPUTexture;
  blurTextures: [GPUTexture, GPUTexture];
  thresholdBuffer: GPUBuffer;
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
  private blurBuffer!: GPUBuffer;

  // Legacy single-layer resources
  private thresholdTexture!: GPUTexture;
  private blurTextures: GPUTexture[] = [];
  private thresholdBuffer!: GPUBuffer;
  private compositeBuffer!: GPUBuffer;

  // Layered resources
  private layers: BloomLayer[] | null = null;
  private layerResources: LayerResources[] = [];
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

  // Shader code
  private thresholdShaderCode?: string | undefined;
  private blurShaderCode?: string | undefined;
  private compositeShaderCode?: string | undefined;

  private finalFormat: GPUTextureFormat;

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

    // Create textures
    const width = this.canvas.width;
    const height = this.canvas.height;
    const blurSize = { width: Math.floor(width / 2), height: Math.floor(height / 2) };

    this.sceneTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.linearSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    this.blurBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    if (useLayered) {
      this.compositeBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

      for (let i = 0; i < this.layers!.length; i++) {
        const thresholdTex = this.device.createTexture({
          size: blurSize,
          format: 'rgba16float',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        const blurTex0 = this.device.createTexture({
          size: blurSize,
          format: 'rgba16float',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        const blurTex1 = this.device.createTexture({
          size: blurSize,
          format: 'rgba16float',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        const thresholdBuf = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

        this.layerResources.push({
          thresholdTexture: thresholdTex,
          blurTextures: [blurTex0, blurTex1] as [GPUTexture, GPUTexture],
          thresholdBuffer: thresholdBuf,
          thresholdBindGroup: null as unknown as GPUBindGroup,
          hBlurBindGroup: null as unknown as GPUBindGroup,
          vBlurBindGroup: null as unknown as GPUBindGroup,
        });
      }
    } else {
      this.thresholdTexture = this.device.createTexture({
        size: blurSize,
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });

      for (let i = 0; i < 2; i++) {
        this.blurTextures.push(this.device.createTexture({
          size: blurSize,
          format: 'rgba16float',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        }));
      }

      this.thresholdBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.compositeBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

      // Default values
      this.device.queue.writeBuffer(this.thresholdBuffer, 0, new Float32Array([0.8, 0.2, 0.0, 0.0]));
      this.device.queue.writeBuffer(this.compositeBuffer, 0, new Float32Array([1.2, 1.0, 0.0, 0.0]));
    }

    await this.createPipelines();
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

  private async createPipelines() {
    const fullscreenVS = `
      @vertex
      fn vs(@builtin(vertex_index) vertexIndex: u32) -> @location(0) vec2<f32> {
          const pos = array<vec2<f32>, 6>(
              vec2(-1, -1), vec2(3, -1), vec2(-1, 3),
              vec2(-1, -1), vec2(-1, 3), vec2(3, -1)
          );
          return pos[vertexIndex];
      }
    `;

    if (!this.thresholdShaderCode || !this.blurShaderCode || !this.compositeShaderCode) {
      throw new Error('Shaders not loaded');
    }

    this.thresholdPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: this.device.createShaderModule({ code: fullscreenVS }), entryPoint: 'vs' },
      fragment: { module: this.device.createShaderModule({ code: this.thresholdShaderCode }), entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });

    this.blurPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: this.device.createShaderModule({ code: fullscreenVS }), entryPoint: 'vs' },
      fragment: { module: this.device.createShaderModule({ code: this.blurShaderCode }), entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });

    this.compositePipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: this.device.createShaderModule({ code: fullscreenVS }), entryPoint: 'vs' },
      fragment: { module: this.device.createShaderModule({ code: this.compositeShaderCode }), entryPoint: 'fs', targets: [{ format: this.finalFormat }] },
      primitive: { topology: 'triangle-list' },
    });
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
            { binding: 2, resource: { buffer: this.blurBuffer } },
          ],
        });

        layer.vBlurBindGroup = this.device.createBindGroup({
          layout: blurLayout,
          entries: [
            { binding: 0, resource: layer.blurTextures[0].createView() },
            { binding: 1, resource: this.linearSampler },
            { binding: 2, resource: { buffer: this.blurBuffer } },
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
          { binding: 2, resource: { buffer: this.blurBuffer } },
        ],
      });

      // Vertical blur bind group
      this.vBlurBindGroup = this.device.createBindGroup({
        layout: blurLayout,
        entries: [
          { binding: 0, resource: (this.blurTextures[0] ?? this.sceneTexture).createView() },
          { binding: 1, resource: this.linearSampler },
          { binding: 2, resource: { buffer: this.blurBuffer } },
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
        ],
      });
    }
  }

  public render(commandEncoder: GPUCommandEncoder, renderScene: (pass: GPURenderPassEncoder) => void) {
    if (this.layers) {
      this.renderLayered(commandEncoder, renderScene);
    } else {
      this.renderLegacy(commandEncoder, renderScene);
    }
  }

  private renderLegacy(commandEncoder: GPUCommandEncoder, renderScene: (pass: GPURenderPassEncoder) => void) {
    // PASS 1: Scene -> HDR scene texture
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

    // PASS 2: Brightness threshold (to smaller texture)
    const thresholdPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.thresholdTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    thresholdPass.setPipeline(this.thresholdPipeline);
    thresholdPass.setBindGroup(0, this.thresholdBindGroup);
    thresholdPass.draw(6);
    thresholdPass.end();

    // PASS 3: Horizontal blur -> blurTextures[0]
    const blurTex0 = this.blurTextures[0];
    if (!blurTex0) return;
    const blurSize = { width: blurTex0.width, height: blurTex0.height };
    this.device.queue.writeBuffer(this.blurBuffer, 0, new Float32Array([1, 0, blurSize.width, blurSize.height]));

    const hBlurPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: (this.blurTextures[0] ?? this.sceneTexture).createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    hBlurPass.setPipeline(this.blurPipeline);
    hBlurPass.setBindGroup(0, this.hBlurBindGroup);
    hBlurPass.draw(6);
    hBlurPass.end();

    // PASS 4: Vertical blur -> blurTextures[1]
    this.device.queue.writeBuffer(this.blurBuffer, 0, new Float32Array([0, 1, blurSize.width, blurSize.height]));

    const vBlurPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: (this.blurTextures[1] ?? this.sceneTexture).createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    vBlurPass.setPipeline(this.blurPipeline);
    vBlurPass.setBindGroup(0, this.vBlurBindGroup);
    vBlurPass.draw(6);
    vBlurPass.end();

    // PASS 5: Composite -> swapchain
    const compositePass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    compositePass.setPipeline(this.compositePipeline);
    compositePass.setBindGroup(0, this.compositeBindGroup);
    compositePass.draw(6);
    compositePass.end();
  }

  private renderLayered(commandEncoder: GPUCommandEncoder, renderScene: (pass: GPURenderPassEncoder) => void) {
    // PASS 1: Scene -> HDR scene texture
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

    // Per-layer threshold + blur passes
    const blurSize = {
      width: this.layerResources[0]!.blurTextures[0].width,
      height: this.layerResources[0]!.blurTextures[0].height,
    };

    let layerIndex = 0;
    for (const layer of this.layerResources) {
      const config = this.layers![layerIndex]!;

      // Write threshold uniform (32 bytes: threshold, knee, tintR, tintG, tintB, pad x3)
      this.device.queue.writeBuffer(
        layer.thresholdBuffer, 0,
        new Float32Array([
          config.threshold,
          0.2, // knee
          config.tint[0],
          config.tint[1],
          config.tint[2],
          0.0,
          0.0,
          0.0,
        ])
      );

      // Threshold pass: sceneTexture -> layer.thresholdTexture
      const thresholdPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: layer.thresholdTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      thresholdPass.setPipeline(this.thresholdPipeline);
      thresholdPass.setBindGroup(0, layer.thresholdBindGroup);
      thresholdPass.draw(6);
      thresholdPass.end();

      // H-blur: layer.thresholdTexture -> layer.blurTextures[0]
      this.device.queue.writeBuffer(
        this.blurBuffer, 0,
        new Float32Array([config.blurRadius, 0, blurSize.width, blurSize.height])
      );

      const hBlurPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: layer.blurTextures[0].createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      hBlurPass.setPipeline(this.blurPipeline);
      hBlurPass.setBindGroup(0, layer.hBlurBindGroup);
      hBlurPass.draw(6);
      hBlurPass.end();

      // V-blur: layer.blurTextures[0] -> layer.blurTextures[1]
      this.device.queue.writeBuffer(
        this.blurBuffer, 0,
        new Float32Array([0, config.blurRadius, blurSize.width, blurSize.height])
      );

      const vBlurPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: layer.blurTextures[1].createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      vBlurPass.setPipeline(this.blurPipeline);
      vBlurPass.setBindGroup(0, layer.vBlurBindGroup);
      vBlurPass.draw(6);
      vBlurPass.end();

      layerIndex++;
    }

    // Composite pass: scene + all blurred layers -> swapchain
    this.device.queue.writeBuffer(
      this.compositeBuffer, 0,
      new Float32Array([
        1.0, // sceneIntensity
        this.layers![0]!.weight,
        this.layers![1]!.weight,
        this.layers![2]!.weight,
      ])
    );

    const compositePass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    compositePass.setPipeline(this.compositePipeline);
    compositePass.setBindGroup(0, this.layeredCompositeBindGroup);
    compositePass.draw(6);
    compositePass.end();
  }

  public updateUniforms(bloomIntensity: number, threshold: number = 0.8, knee: number = 0.2, sceneIntensity: number = 1.0) {
    if (!this.layers) {
      // compositeBuffer: [bloomIntensity, sceneIntensity]
      this.device.queue.writeBuffer(this.compositeBuffer, 0, new Float32Array([bloomIntensity, sceneIntensity, 0.0, 0.0]));
      // thresholdBuffer: [threshold, knee]
      this.device.queue.writeBuffer(this.thresholdBuffer, 0, new Float32Array([threshold, knee, 0.0, 0.0]));
    } else {
      // Layered mode: update sceneIntensity and keep per-layer weights
      this.device.queue.writeBuffer(
        this.compositeBuffer, 0,
        new Float32Array([
          sceneIntensity,
          this.layers![0]!.weight,
          this.layers![1]!.weight,
          this.layers![2]!.weight,
        ])
      );
    }
  }

  // Apply a bloom preset with all parameters
  public applyPreset(preset: { intensity: number; threshold: number; knee: number }, sceneIntensity: number = 1.0) {
    this.updateUniforms(preset.intensity, preset.threshold, preset.knee, sceneIntensity);
  }

  public destroy() {
    this.sceneTexture?.destroy();
    this.thresholdTexture?.destroy();
    this.blurTextures.forEach(t => t.destroy());
    this.blurTextures = [];

    this.thresholdBuffer?.destroy();
    this.blurBuffer?.destroy();
    this.compositeBuffer?.destroy();

    for (const layer of this.layerResources) {
      layer.thresholdTexture?.destroy();
      layer.blurTextures.forEach(t => t.destroy());
      layer.thresholdBuffer?.destroy();
    }
    this.layerResources = [];
  }
}
