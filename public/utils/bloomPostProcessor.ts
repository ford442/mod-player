// utils/bloomPostProcessor.ts
// Lightweight Bloom post-processor for WebGPU.
// It expects WGSL code strings for the threshold/blur/composite shaders or will try to fetch them
// from the server. In a Vite project, you can import them as `import t from './shaders/bloom_threshold.wgsl?raw'`.
// For subpath deployment, use withBase() from src/lib/paths to construct shader URLs.

export interface BloomOptions {
  shaderThreshold?: string;
  shaderBlur?: string;
  shaderComposite?: string;
  finalFormat?: GPUTextureFormat; // default 'bgra8unorm'
}

export class BloomPostProcessor {
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext;

  private sceneTexture!: GPUTexture;
  private thresholdTexture!: GPUTexture;
  private blurTextures: GPUTexture[] = [];
  private linearSampler!: GPUSampler;

  private thresholdPipeline!: GPURenderPipeline;
  private blurPipeline!: GPURenderPipeline;
  private compositePipeline!: GPURenderPipeline;

  private thresholdBindGroup!: GPUBindGroup;
  private blurBindGroups: GPUBindGroup[] = [];
  private compositeBindGroup!: GPUBindGroup;

  private thresholdBuffer!: GPUBuffer;
  private blurBuffer!: GPUBuffer;
  private compositeBuffer!: GPUBuffer;

  private thresholdShaderCode?: string | undefined;
  private blurShaderCode?: string | undefined;
  private compositeShaderCode?: string | undefined;

  private finalFormat: GPUTextureFormat;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement, context: GPUCanvasContext, options: BloomOptions = {}) {
    this.device = device;
    this.canvas = canvas;
    this.context = context;

    this.thresholdShaderCode = options.shaderThreshold;
    this.blurShaderCode = options.shaderBlur;
    this.compositeShaderCode = options.shaderComposite;

    this.finalFormat = options.finalFormat ?? ('bgra8unorm' as GPUTextureFormat);
  }

  // Base URL for fetching shaders (set this for subpath deployments)
  private baseUrl: string = '';

  public setBaseUrl(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  // Call once after construction
  public async init() {
    // Try to load shader code if not supplied, fetching concurrently if needed
    const [t, b, c] = await Promise.all([
      this.thresholdShaderCode ? Promise.resolve(this.thresholdShaderCode) : this.tryFetch(`${this.baseUrl}/shaders/bloom_threshold.wgsl`),
      this.blurShaderCode ? Promise.resolve(this.blurShaderCode) : this.tryFetch(`${this.baseUrl}/shaders/bloom_blur.wgsl`),
      this.compositeShaderCode ? Promise.resolve(this.compositeShaderCode) : this.tryFetch(`${this.baseUrl}/shaders/bloom_composite.wgsl`)
    ]);

    this.thresholdShaderCode = t;
    this.blurShaderCode = b;
    this.compositeShaderCode = c;

    // Create textures
    const width = this.canvas.width;
    const height = this.canvas.height;

    this.sceneTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    const blurSize = { width: Math.floor(width / 2), height: Math.floor(height / 2) };

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

    this.linearSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // Buffers (uniform buffers must be multiples of 16 bytes)
    this.thresholdBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.blurBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.compositeBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Default values
    this.device.queue.writeBuffer(this.thresholdBuffer, 0, new Float32Array([0.8, 0.2, 0.0, 0.0]));
    this.device.queue.writeBuffer(this.compositeBuffer, 0, new Float32Array([1.2, 1.0, 0.0, 0.0]));

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
    // Threshold bind group
    this.thresholdBindGroup = this.device.createBindGroup({
      layout: this.thresholdPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sceneTexture.createView() },
        { binding: 1, resource: this.linearSampler },
        { binding: 2, resource: { buffer: this.thresholdBuffer } },
      ],
    });

    // Blur bind group (will be recreated for v-pass with updated texture view when necessary)
    const blurLayout = this.blurPipeline.getBindGroupLayout(0);
    this.blurBindGroups[0] = this.device.createBindGroup({
      layout: blurLayout,
      entries: [
        { binding: 0, resource: this.thresholdTexture.createView() },
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

  public render(commandEncoder: GPUCommandEncoder, renderScene: (pass: GPURenderPassEncoder) => void) {
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

    // Recreate bindgroup for blur input if needed
    const hBlurBind = this.device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.thresholdTexture.createView() },
        { binding: 1, resource: this.linearSampler },
        { binding: 2, resource: { buffer: this.blurBuffer } },
      ],
    });

    const hBlurPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: (this.blurTextures[0] ?? this.sceneTexture).createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    hBlurPass.setPipeline(this.blurPipeline);
    hBlurPass.setBindGroup(0, hBlurBind);
    hBlurPass.draw(6);
    hBlurPass.end();

    // PASS 4: Vertical blur -> blurTextures[1]
    this.device.queue.writeBuffer(this.blurBuffer, 0, new Float32Array([0, 1, blurSize.width, blurSize.height]));

    const vBlurBind = this.device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: (this.blurTextures[0] ?? this.sceneTexture).createView() },
        { binding: 1, resource: this.linearSampler },
        { binding: 2, resource: { buffer: this.blurBuffer } },
      ],
    });

    const vBlurPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: (this.blurTextures[1] ?? this.sceneTexture).createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    vBlurPass.setPipeline(this.blurPipeline);
    vBlurPass.setBindGroup(0, vBlurBind);
    vBlurPass.draw(6);
    vBlurPass.end();

    // PASS 5: Composite -> swapchain
    // Recreate composite bind group to ensure latest blur view is bound
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

  public updateUniforms(bloomIntensity: number, threshold: number = 0.8, knee: number = 0.2, sceneIntensity: number = 1.0) {
    // compositeBuffer: [bloomIntensity, sceneIntensity]
    this.device.queue.writeBuffer(this.compositeBuffer, 0, new Float32Array([bloomIntensity, sceneIntensity, 0.0, 0.0]));
    // thresholdBuffer: [threshold, knee]
    this.device.queue.writeBuffer(this.thresholdBuffer, 0, new Float32Array([threshold, knee, 0.0, 0.0]));
  }
}
