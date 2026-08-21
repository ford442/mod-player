import type { PatternMatrix } from '../../../types';
import type { WebGPURenderParams, DebugInfo } from '../params';
import {
  getLayoutType,
  shouldUseBackgroundPass,
  getBackgroundShaderFile,
  shouldEnableAlphaBlending,
  usesHighPrecisionPacking,
  usesOscilloscope,
  usesInstrumentPalette,
  usesAudioReactive,
  usesAudioReactiveBezel,
  usesGpuSpectrum,
  usesVideoPatternTexture,
  type LayoutType,
} from '../../../utils/shaderVersion';
import { getShaderMeta, getLiteRecommendedShader } from '../../../utils/shaderRegistry';
import { alignTo, DEFAULT_ROWS, DEFAULT_CHANNELS } from '../../../utils/gpuPacking';
import {
  initNoteDurationCompute,
  disposeNoteDurationCompute,
  type NoteDurationComputeState,
} from '../../../utils/computeNoteDuration';
import type { BloomPostProcessor } from '../../../utils/bloomPostProcessor';
import type React from 'react';
import { GpuResourcePool } from '../../../utils/gpuResourcePool';
import { GpuLifecycle } from '../../../utils/gpuLifecycle';
import { generateEmptyInstrumentPalette, MAX_INSTRUMENT_PALETTE_SIZE } from '../../../utils/instrumentPalette';
import {
  requestWebGPUDevice,
  configureCanvasContext,
  getWebGPUCanvasContext,
  attachDeviceLostHandler,
  probeWebGPUCanvasPresentation,
  WebGPUInitError,
  type WebGPUDeviceStatus,
} from '../../../utils/webgpuDevice';
import { markWebGPUSessionFailed } from '../../../utils/webgpuProbe';
import { AUDIO_REACTIVE_UNIFORM_BYTES, OSC_SAMPLE_COUNT } from '../../../utils/audioReactive';
import { fetchShaderSource } from './shaderSource';
import {
  createMainBindGroupLayout,
  refreshMainBindGroup,
  type BindGroupTextureResources,
} from './bindGroup';
import { loadBezelTexture, ensureButtonTexture, ensureVideoPlaceholder } from './textures';
import {
  uploadCellsBuffer,
  uploadExtendedBuffers,
  syncChannelBuffer,
  assertCellsBufferSize,
  CELLS_USAGE,
  type ExtendedBuffersState,
} from './matrixBuffers';
import {
  renderWebGPUFrame,
  PATTERN_PASS_LABEL,
  type FrameDrawScratch,
  type FrameDrawState,
} from './frameDraw';
import { ComputeAnalysis, COMPUTE_ANALYSIS_PASS_LABEL } from './computeAnalysis';
import { GpuTimestampRecorder, deviceHasTimestampQuery } from './timestampQuery';

export interface WebGPURendererCallbacks {
  onDeviceStatus?: (status: WebGPUDeviceStatus) => void;
  onDeviceAcquired?: (acquired: boolean) => void;
  onGpuReady?: (ready: boolean) => void;
  onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  onDebugInfo?: (updater: (prev: DebugInfo) => DebugInfo) => void;
  onWebgpuAvailable?: (available: boolean) => void;
  onDeviceEpochBump?: () => void;
}

export interface WebGPURendererDeps {
  oscTextureRef?: React.MutableRefObject<GPUTexture | null> | undefined;
  bloomProcessorRef?: React.MutableRefObject<BloomPostProcessor | null> | undefined;
}

export class WebGPURenderer {
  device: GPUDevice | null = null;
  context: GPUCanvasContext | null = null;

  private pool: GpuResourcePool | null = null;
  private readonly lifecycle = new GpuLifecycle();
  private renderGeneration = 0;

  private pipeline: GPURenderPipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private cellsBuffer: GPUBuffer | null = null;
  private rowFlagsBuffer: GPUBuffer | null = null;
  private channelsBuffer: GPUBuffer | null = null;
  private layoutType: LayoutType = 'standard';
  private bezelTextureResources: BindGroupTextureResources | null = null;
  private textureResources: BindGroupTextureResources | null = null;
  private videoTexture: GPUTexture | null = null;
  private renderFrameCount = 0;
  private bezelPipeline: GPURenderPipeline | null = null;
  private computeState: NoteDurationComputeState | null = null;
  private bezelBindGroup: GPUBindGroup | null = null;
  private bezelUniformBuffer: GPUBuffer | null = null;
  private instrumentPaletteTexture: GPUTexture | null = null;
  private instrumentPaletteVersion: Uint8Array | null = null;
  private audioReactiveUniformBuffer: GPUBuffer | null = null;
  private canvasFormat: GPUTextureFormat = 'bgra8unorm';
  private configuredCanvasSize: { w: number; h: number } | null = null;
  private channelBufferData: ArrayBuffer | null = null;
  private channelDataView: DataView | null = null;
  private shaderFile = '';
  private liteMode = false;
  private markLostIntentional: (() => void) | null = null;
  private recoveryAttempts = 0;
  private readonly maxDeviceLostRecoveries = 3;
  private oscTextureGeneration = 0;
  private boundOscTextureGeneration = -1;
  private computeAnalysis: ComputeAnalysis | null = null;
  private computeAnalysisInit: Promise<void> | null = null;
  /** Whether the active shader opted into GPU audio analysis (ShaderMeta flag). */
  private gpuSpectrumWanted = false;
  private timestamps: GpuTimestampRecorder | null = null;

  private readonly scratch: FrameDrawScratch = {
    uniformBufferData: new ArrayBuffer(144),
    uniformUint: new Uint32Array(144),
    uniformFloat: new Float32Array(144),
    bezelBufferData: new ArrayBuffer(128),
    bezelFloat: new Float32Array(128),
    bezelUint: new Uint32Array(128),
    audioReactiveUniformData: new Float32Array(16),
  };

  constructor(
    private readonly deps: WebGPURendererDeps,
    private readonly callbacks: WebGPURendererCallbacks = {},
  ) {
    this.scratch.uniformUint = new Uint32Array(this.scratch.uniformBufferData);
    this.scratch.uniformFloat = new Float32Array(this.scratch.uniformBufferData);
    this.scratch.bezelFloat = new Float32Array(this.scratch.bezelBufferData);
    this.scratch.bezelUint = new Uint32Array(this.scratch.bezelBufferData);
  }

  get renderGenerationRef(): number {
    return this.renderGeneration;
  }

  get lifecycleRef(): GpuLifecycle {
    return this.lifecycle;
  }

  /** True when pipeline, bind group, and oscilloscope texture (if required) are valid. */
  isShaderReady(): boolean {
    const pool = this.pool;
    if (!this.pipeline || !this.bindGroup || !pool || pool.isDisposed) return false;
    if (!this.uniformBuffer || !this.cellsBuffer) return false;
    if (!pool.isAlive(this.uniformBuffer) || !pool.isAlive(this.cellsBuffer)) return false;
    if (usesOscilloscope(this.shaderFile)) {
      const osc = this.deps.oscTextureRef?.current;
      if (!osc || !pool.isAlive(osc)) return false;
      if (this.boundOscTextureGeneration !== this.oscTextureGeneration) return false;
    }
    return true;
  }

  private nullOscTexture(): void {
    if (this.deps.oscTextureRef) {
      this.deps.oscTextureRef.current = null;
    }
    this.oscTextureGeneration += 1;
    this.boundOscTextureGeneration = -1;
  }

  private createOscTexture(device: GPUDevice, pool: GpuResourcePool): void {
    if (!this.deps.oscTextureRef) return;
    this.deps.oscTextureRef.current = pool.track(
      device.createTexture({
        size: [OSC_SAMPLE_COUNT, 1, 1],
        format: 'r32float',
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      }),
      'shader',
    );
    this.oscTextureGeneration += 1;
  }

  private get extendedState(): ExtendedBuffersState {
    return {
      rowFlagsBuffer: this.rowFlagsBuffer,
      channelsBuffer: this.channelsBuffer,
      channelBufferData: this.channelBufferData,
      channelDataView: this.channelDataView,
    };
  }

  private set extendedState(state: ExtendedBuffersState) {
    this.rowFlagsBuffer = state.rowFlagsBuffer;
    this.channelsBuffer = state.channelsBuffer;
    this.channelBufferData = state.channelBufferData;
    this.channelDataView = state.channelDataView;
  }

  private refreshBindGroup(): GPUBindGroup | null {
    const device = this.device;
    const pool = this.pool;
    if (!device || !pool || pool.isDisposed) return null;
    const group = refreshMainBindGroup(
      device,
      pool,
      {
        pipeline: this.pipeline,
        cellsBuffer: this.cellsBuffer,
        uniformBuffer: this.uniformBuffer,
        rowFlagsBuffer: this.rowFlagsBuffer,
        channelsBuffer: this.channelsBuffer,
        textureResources: this.textureResources,
        instrumentPaletteTexture: this.instrumentPaletteTexture,
        audioReactiveUniformBuffer: this.audioReactiveUniformBuffer,
        layoutType: this.layoutType,
      },
      this.shaderFile,
      this.deps.oscTextureRef?.current,
    );
    this.bindGroup = group;
    if (group && usesOscilloscope(this.shaderFile)) {
      this.boundOscTextureGeneration = this.oscTextureGeneration;
    }
    if (import.meta.env.DEV && usesInstrumentPalette(this.shaderFile) && !group) {
      console.warn(
        '[WebGPU] refreshBindGroup: null bind group for instrument-palette shader',
        this.shaderFile,
        { hasPaletteTexture: !!this.instrumentPaletteTexture },
      );
    }
    if (import.meta.env.DEV && usesOscilloscope(this.shaderFile) && !group) {
      console.warn(
        '[WebGPU] refreshBindGroup: null bind group for oscilloscope shader',
        this.shaderFile,
        {
          hasOscTexture: !!this.deps.oscTextureRef?.current,
          oscAlive: this.deps.oscTextureRef?.current
            ? pool.isAlive(this.deps.oscTextureRef.current)
            : false,
        },
      );
    }
    return group;
  }

  releaseShaderResources(): void {
    this.renderGeneration = this.lifecycle.bump();
    this.bindGroup = null;
    this.pipeline = null;
    this.bezelBindGroup = null;
    this.bezelPipeline = null;
    this.bezelTextureResources = null;
    this.textureResources = null;
    this.instrumentPaletteVersion = null;

    const pool = this.pool;
    if (pool && !pool.isDisposed) {
      if (this.cellsBuffer) {
        pool.releaseBuffer('cells', this.cellsBuffer, CELLS_USAGE);
      }
      if (this.rowFlagsBuffer) {
        pool.releaseBuffer('rowFlags', this.rowFlagsBuffer, CELLS_USAGE);
      }
      if (this.channelsBuffer) {
        pool.releaseBuffer('channels', this.channelsBuffer, CELLS_USAGE);
      }
      pool.disposeScope('shader');
      pool.disposeScope('matrix');
    }

    this.cellsBuffer = null;
    this.uniformBuffer = null;
    this.rowFlagsBuffer = null;
    this.channelsBuffer = null;
    this.bezelUniformBuffer = null;
    this.videoTexture = null;
    this.instrumentPaletteTexture = null;
    this.nullOscTexture();
    this.audioReactiveUniformBuffer = null;
  }

  async initDevice(
    canvas: HTMLCanvasElement,
    glCanvas: HTMLCanvasElement | null,
    syncCanvasSize: (canvas: HTMLCanvasElement, gl: HTMLCanvasElement | null) => void,
    options: { liteMode: boolean; isCancelled: () => boolean; deviceEpoch: number },
  ): Promise<void> {
    const { liteMode, isCancelled, deviceEpoch } = options;
    this.liteMode = liteMode;
    this.callbacks.onDeviceStatus?.(deviceEpoch > 0 ? 'lost' : 'initializing');

    const { device, preferredCanvasFormat } = await requestWebGPUDevice({
      liteMode,
      isCancelled,
    });
    if (isCancelled()) {
      try { device.destroy(); } catch { /* ignore */ }
      return;
    }

    const presents = await probeWebGPUCanvasPresentation(device, preferredCanvasFormat);
    if (isCancelled()) {
      try { device.destroy(); } catch { /* ignore */ }
      return;
    }
    if (!presents) {
      try { device.destroy(); } catch { /* ignore */ }
      markWebGPUSessionFailed(
        'canvas',
        'WebGPU canvas presentation failed (swapchain does not composite)',
      );
      throw new WebGPUInitError(
        'WebGPU canvas presentation failed (swapchain does not composite)',
        'device-failed',
        false,
      );
    }

    syncCanvasSize(canvas, glCanvas);
    const context = getWebGPUCanvasContext(canvas);
    const format = configureCanvasContext({
      device,
      context,
      format: preferredCanvasFormat,
    });
    this.canvasFormat = format;
    this.configuredCanvasSize = { w: canvas.width, h: canvas.height };

    this.markLostIntentional?.();
    this.markLostIntentional = attachDeviceLostHandler(device, {
      onLost: (info, intentional) => {
        if (isCancelled() || intentional) return;
        console.error(`[WebGPU] device lost (reason=${info.reason}): ${info.message}`);
        this.callbacks.onGpuReady?.(false);
        this.callbacks.onDeviceAcquired?.(false);
        this.lifecycle.bump();
        this.pool?.disposeAll();
        this.pool = null;
        this.disposeAnalysis();
        disposeNoteDurationCompute(this.device);
        this.computeState = null;
        this.device = null;
        this.context = null;
        this.pipeline = null;
        this.bindGroup = null;
        this.nullOscTexture();

        if (this.recoveryAttempts >= this.maxDeviceLostRecoveries) {
          markWebGPUSessionFailed(
            'lost',
            `DEVICE-LOST: ${info.reason} — recovery exhausted after ${this.maxDeviceLostRecoveries} attempts`,
          );
          this.callbacks.onDeviceStatus?.('device-failed');
          this.callbacks.onWebgpuAvailable?.(false);
          this.callbacks.onDebugInfo?.((prev) => ({
            ...prev,
            errors: [
              ...prev.errors.filter((e) => !e.startsWith('DEVICE-LOST')),
              `DEVICE-LOST: ${info.reason} — recovery exhausted after ${this.maxDeviceLostRecoveries} attempts`,
            ],
          }));
          return;
        }

        this.recoveryAttempts += 1;
        this.callbacks.onDeviceStatus?.('lost');
        this.callbacks.onDebugInfo?.((prev) => ({
          ...prev,
          errors: [
            ...prev.errors.filter((e) => !e.startsWith('DEVICE-LOST')),
            `DEVICE-LOST: ${info.reason} — recovering (${this.recoveryAttempts}/${this.maxDeviceLostRecoveries})…`,
          ],
        }));
        this.callbacks.onDeviceEpochBump?.();
        this.callbacks.onDeviceLost?.(info);
      },
    });

    this.pool?.disposeAll();
    this.pool = new GpuResourcePool(device);
    this.device = device;
    this.context = context;
    this.recoveryAttempts = 0;

    // Lite mode stays on the AnalyserNode path and never asks for timestamps.
    this.disposeAnalysis();
    this.callbacks.onDebugInfo?.((prev) => ({
      ...prev,
      gpuTimingStatus: liteMode
        ? 'lite'
        : (deviceHasTimestampQuery(device) ? 'ok' : 'unavailable'),
    }));
    if (!liteMode) {
      this.timestamps = GpuTimestampRecorder.create(device, [
        COMPUTE_ANALYSIS_PASS_LABEL,
        PATTERN_PASS_LABEL,
      ]);
      // Async, and deliberately not awaited: the first few frames run on the
      // CPU path while the compute pipeline compiles.
      this.computeAnalysisInit = ComputeAnalysis.create(device).then((analysis) => {
        if (this.device !== device) {
          analysis?.dispose();
          return;
        }
        this.computeAnalysis = analysis;
        // A shader may already have been selected while this was compiling.
        analysis?.setEnabled(this.gpuSpectrumWanted);
      });
      void this.computeAnalysisInit;
    }

    this.callbacks.onDeviceStatus?.('ready');
    this.callbacks.onDeviceAcquired?.(true);
    this.callbacks.onDebugInfo?.((prev) => ({
      ...prev,
      errors: prev.errors.filter((e) => !e.startsWith('DEVICE-LOST')),
    }));
  }

  /** Release the analysis compute pass and timestamp query set. */
  private disposeAnalysis(): void {
    this.computeAnalysisInit = null;
    this.gpuSpectrumWanted = false;
    this.computeAnalysis?.dispose();
    this.computeAnalysis = null;
    this.timestamps?.dispose();
    this.timestamps = null;
  }

  disposeDevice(): void {
    this.markLostIntentional?.();
    this.markLostIntentional = null;
    this.lifecycle.bump();
    this.releaseShaderResources();
    this.disposeAnalysis();
    disposeNoteDurationCompute(this.device);
    this.computeState = null;
    this.pool?.disposeAll();
    this.pool = null;
    if (this.device) {
      try { this.device.destroy(); } catch { /* ignore */ }
    }
    this.device = null;
    this.context = null;
    if (import.meta.env.DEV) {
      console.log('[WebGPU] device disposed on unmount');
    }
  }

  async initShader(
    shaderFile: string,
    params: WebGPURenderParams,
    isCancelled: () => boolean,
  ): Promise<void> {
    const device = this.device;
    const pool = this.pool;
    if (!device || !pool || pool.isDisposed) return;

    this.shaderFile = shaderFile;
    this.textureResources = null;
    this.bezelTextureResources = null;
    this.releaseShaderResources();

    let activeShaderFile = shaderFile;
    if (!getShaderMeta(activeShaderFile)) {
      const fallbackShader = getLiteRecommendedShader();
      console.warn(`[WebGPU] Shader "${activeShaderFile}" is not registered; falling back to "${fallbackShader}".`);
      activeShaderFile = fallbackShader;
    }
    this.shaderFile = activeShaderFile;

    const shaderSource = await fetchShaderSource(activeShaderFile);
    if (isCancelled() || pool.isDisposed) return;
    const module = device.createShaderModule({ code: shaderSource });
    if ('getCompilationInfo' in module) module.getCompilationInfo().catch(() => {});

    const layoutType = getLayoutType(activeShaderFile);
    this.layoutType = layoutType;
    const bindGroupLayout = createMainBindGroupLayout(device, activeShaderFile, layoutType);

    const enableAlphaBlend = shouldEnableAlphaBlending(activeShaderFile);
    const targets: GPUColorTargetState[] = [{
      format: this.canvasFormat,
      ...(enableAlphaBlend ? {
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      } : {}),
    }];
    try {
      this.pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets },
        primitive: { topology: 'triangle-list' },
      });
    } catch {
      this.pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: 'vertex_main' },
        fragment: { module, entryPoint: 'fragment_main', targets },
        primitive: { topology: 'triangle-list' },
      });
    }

    const uniformSize = layoutType === 'extended' ? 144 : (layoutType === 'texture' ? 64 : 32);
    this.uniformBuffer = pool.track(
      device.createBuffer({ size: alignTo(uniformSize, 256), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      'shader',
    );

    if (usesInstrumentPalette(activeShaderFile)) {
      const palette = params.instrumentPalette ?? generateEmptyInstrumentPalette();
      const texture = pool.track(
        device.createTexture({
          size: [MAX_INSTRUMENT_PALETTE_SIZE, 1, 1],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
        }),
        'shader',
      );
      device.queue.writeTexture(
        { texture },
        palette.buffer as ArrayBuffer,
        { bytesPerRow: MAX_INSTRUMENT_PALETTE_SIZE * 4, offset: palette.byteOffset },
        { width: MAX_INSTRUMENT_PALETTE_SIZE, height: 1, depthOrArrayLayers: 1 },
      );
      this.instrumentPaletteTexture = texture;
      this.instrumentPaletteVersion = palette;
    }

    if (usesOscilloscope(activeShaderFile)) {
      this.createOscTexture(device, pool);
    }

    // Only subscribe to the PCM bus while a shader that consumes GPU analysis
    // is on screen — subscribing is what turns on the worklet's PCM stream.
    this.gpuSpectrumWanted = usesGpuSpectrum(activeShaderFile);
    this.computeAnalysis?.setEnabled(this.gpuSpectrumWanted);

    if (usesAudioReactive(activeShaderFile) || usesAudioReactiveBezel(activeShaderFile)) {
      this.audioReactiveUniformBuffer = pool.track(
        device.createBuffer({
          size: alignTo(AUDIO_REACTIVE_UNIFORM_BYTES, 256),
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        'shader',
      );
    }

    if (shouldUseBackgroundPass(activeShaderFile)) {
      try {
        const backgroundShaderFile = getBackgroundShaderFile(activeShaderFile);
        const backgroundSource = await fetchShaderSource(backgroundShaderFile);
        if (isCancelled() || pool.isDisposed) return;
        const bezelModule = device.createShaderModule({ code: backgroundSource });
        const audioBezel = usesAudioReactiveBezel(activeShaderFile);
        const bezelBindEntries: GPUBindGroupLayoutEntry[] = [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        ];
        if (audioBezel) {
          bezelBindEntries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });
        }
        const bezelBindLayout = device.createBindGroupLayout({ entries: bezelBindEntries });
        this.bezelPipeline = device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [bezelBindLayout] }),
          vertex: { module: bezelModule, entryPoint: 'vs' },
          fragment: { module: bezelModule, entryPoint: 'fs', targets: [{ format: this.canvasFormat }] },
          primitive: { topology: 'triangle-list' },
        });
        this.bezelUniformBuffer = pool.track(
          device.createBuffer({ size: alignTo(96, 256), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
          'shader',
        );
        this.bezelTextureResources = await loadBezelTexture(device, pool, activeShaderFile);
        if (isCancelled() || pool.isDisposed) return;
        const bezelGroupEntries: GPUBindGroupEntry[] = [
          { binding: 0, resource: { buffer: this.bezelUniformBuffer } },
          { binding: 1, resource: this.bezelTextureResources.sampler },
          { binding: 2, resource: this.bezelTextureResources.view },
        ];
        if (audioBezel && this.audioReactiveUniformBuffer) {
          bezelGroupEntries.push({ binding: 3, resource: { buffer: this.audioReactiveUniformBuffer } });
        }
        this.bezelBindGroup = device.createBindGroup({ layout: bezelBindLayout, entries: bezelGroupEntries });
      } catch (e) {
        console.warn('Failed to initialize bezel shader', e);
      }
    }

    const isHighPrec = usesHighPrecisionPacking(activeShaderFile);
    if (isHighPrec && !this.computeState) {
      try {
        this.computeState = await initNoteDurationCompute(device);
      } catch (e) {
        console.warn('[DURA-001] Compute pipeline init failed, falling back to CPU:', e);
      }
    }

    const { buffer } = uploadCellsBuffer({
      device,
      pool,
      shaderFile: activeShaderFile,
      matrix: params.matrix,
      padTopChannel: params.padTopChannel,
      liteMode: this.liteMode,
      computeState: this.computeState,
      onParityError: (msg) => {
        this.callbacks.onDebugInfo?.((prev) => ({
          ...prev,
          errors: [...prev.errors.filter((e) => !e.startsWith('DURA-PARITY')), msg],
        }));
      },
    });
    this.cellsBuffer = buffer;

    const extState = this.extendedState;
    uploadExtendedBuffers({
      device,
      pool,
      matrix: params.matrix,
      params,
      layoutType,
      initEmpty: true,
    }, extState);
    this.extendedState = extState;

    const needsTexture = layoutType === 'texture' || layoutType === 'extended';
    if (needsTexture) {
      if (usesVideoPatternTexture(activeShaderFile)) {
        const { texture, resources } = ensureVideoPlaceholder(device, pool);
        this.videoTexture = texture;
        this.textureResources = resources;
      } else {
        this.textureResources = await ensureButtonTexture(device, pool, activeShaderFile);
      }
    }

    if (isCancelled() || pool.isDisposed) return;
    this.refreshBindGroup();
    if (!this.isShaderReady()) {
      throw new WebGPUInitError(
        `Shader init failed: incomplete bind group for "${activeShaderFile}"`,
        'device-failed',
        true,
      );
    }
    this.renderGeneration = this.lifecycle.bump();
    if (import.meta.env.DEV) {
      pool.logStats('WebGPU shader init');
    }
  }

  updateMatrix(
    matrix: PatternMatrix | null,
    _padTopChannel: boolean,
    params: WebGPURenderParams,
  ): void {
    const device = this.device;
    const pool = this.pool;
    if (!device || !pool || pool.isDisposed) return;

    const rawChannels = matrix?.numChannels ?? DEFAULT_CHANNELS;
    const numChannels = params.padTopChannel ? rawChannels + 1 : rawChannels;
    if (numChannels <= 0) return;
    const numRows = matrix?.numRows ?? DEFAULT_ROWS;

    this.renderFrameCount = 0;
    this.renderGeneration = this.lifecycle.bump();

    if (this.cellsBuffer) {
      pool.releaseBuffer('cells', this.cellsBuffer, CELLS_USAGE);
      this.cellsBuffer = null;
    }

    const { buffer } = uploadCellsBuffer({
      device,
      pool,
      shaderFile: this.shaderFile,
      matrix: params.matrix,
      padTopChannel: params.padTopChannel,
      liteMode: this.liteMode,
      computeState: this.computeState,
      onParityError: (msg) => {
        this.callbacks.onDebugInfo?.((prev) => ({
          ...prev,
          errors: [...prev.errors.filter((e) => !e.startsWith('DURA-PARITY')), msg],
        }));
      },
    });
    this.cellsBuffer = buffer;

    assertCellsBufferSize(this.cellsBuffer, numRows, numChannels);

    const extState = this.extendedState;
    uploadExtendedBuffers({
      device,
      pool,
      matrix,
      params,
      layoutType: this.layoutType,
      initEmpty: false,
      numChannelsOverride: numChannels,
    }, extState);
    this.extendedState = extState;

    this.renderGeneration = this.lifecycle.bump();
    const refreshed = this.refreshBindGroup();
    if (!refreshed && import.meta.env.DEV) {
      console.warn('[WebGPU] updateMatrix: refreshBindGroup returned null', this.shaderFile);
    }
    if (import.meta.env.DEV) {
      pool.logStats('WebGPU matrix update');
    }
  }

  syncChannels(params: WebGPURenderParams): boolean {
    const device = this.device;
    const pool = this.pool;
    if (!device || !pool || pool.isDisposed) return false;
    if (this.layoutType !== 'extended') return false;

    const extState = this.extendedState;
    const recreated = syncChannelBuffer(device, pool, params, extState);
    this.extendedState = extState;
    if (recreated || this.channelsBuffer) {
      this.refreshBindGroup();
    }
    return recreated;
  }

  renderFrame(canvas: HTMLCanvasElement, params: WebGPURenderParams): void {
    const frameGen = this.renderGeneration;
    if (!this.lifecycle.isCurrent(frameGen)) return;

    const device = this.device;
    const pool = this.pool;
    const context = this.context;
    if (!device || !pool || pool.isDisposed || !context || !canvas) return;

    const frameState: FrameDrawState = {
      pipeline: this.pipeline,
      bindGroup: this.bindGroup,
      uniformBuffer: this.uniformBuffer,
      cellsBuffer: this.cellsBuffer,
      channelsBuffer: this.channelsBuffer,
      channelBufferData: this.channelBufferData,
      channelDataView: this.channelDataView,
      layoutType: this.layoutType,
      bezelPipeline: this.bezelPipeline,
      bezelBindGroup: this.bezelBindGroup,
      bezelUniformBuffer: this.bezelUniformBuffer,
      instrumentPaletteTexture: this.instrumentPaletteTexture,
      instrumentPaletteVersion: this.instrumentPaletteVersion,
      audioReactiveUniformBuffer: this.audioReactiveUniformBuffer,
      canvasFormat: this.canvasFormat,
      configuredCanvasSize: this.configuredCanvasSize,
      videoState: {
        videoTexture: this.videoTexture,
        textureResources: this.textureResources,
      },
      renderFrameCount: this.renderFrameCount,
    };

    renderWebGPUFrame({
      device,
      pool,
      lifecycle: this.lifecycle,
      frameGen,
      context,
      canvas,
      shaderFile: this.shaderFile,
      params,
      state: frameState,
      scratch: this.scratch,
      bloomProcessor: this.deps.bloomProcessorRef?.current ?? null,
      oscTextureRef: this.deps.oscTextureRef,
      computeAnalysis: this.computeAnalysis,
      timestamps: this.timestamps,
      onRefreshBindGroup: () => {
        this.instrumentPaletteTexture = frameState.instrumentPaletteTexture;
        this.refreshBindGroup();
        frameState.bindGroup = this.bindGroup;
      },
      onDebugInfo: (updater) => this.callbacks.onDebugInfo?.(updater),
    });

    this.renderFrameCount = frameState.renderFrameCount;
    this.configuredCanvasSize = frameState.configuredCanvasSize;
    this.bindGroup = frameState.bindGroup;
    this.instrumentPaletteTexture = frameState.instrumentPaletteTexture;
    this.instrumentPaletteVersion = frameState.instrumentPaletteVersion;
    this.videoTexture = frameState.videoState.videoTexture;
    this.textureResources = frameState.videoState.textureResources;
  }
}
