import type { WebGPURenderParams, DebugInfo } from '../params';
import { resolveLiveChannels } from '../params';
import {
  clampPlayhead,
  fillUniformPayload,
  fillChannelStates,
  DEFAULT_ROWS,
  DEFAULT_CHANNELS,
} from '../../../utils/gpuPacking';
import {
  isSinglePassCompositeShader,
  isCircularLayoutShader,
  getBackgroundShaderFile,
  supportsStepsLength,
  usesPlayheadRowAsFloat,
  usesAudioReactive,
  usesAudioReactiveBezel,
  usesInstrumentPalette,
  getUiExtraInstances,
  usesNightModeBezel,
  needsChassisControlFields,
  resolveShaderMeta,
  usesOscilloscope,
  WEBGL_HYBRID_SHADERS,
} from '../../../utils/shaderVersion';
import { GRID_RECT, getPolarRadii } from '../../../utils/geometryConstants';
import { resolveWebGpuVisibleRows } from '../../../utils/overlayLayout';
import { isV030bTimingDebugEnabled } from '../../../utils/timingDebug';
import { configureCanvasContext } from '../../../utils/webgpuDevice';
import {
  AUDIO_REACTIVE_UNIFORM_BYTES,
  OSC_SAMPLE_COUNT,
  packAudioReactiveUniform,
  readAudioBands,
} from '../../../utils/audioReactive';
import {
  instrumentPalettesEqual,
  MAX_INSTRUMENT_PALETTE_SIZE,
} from '../../../utils/instrumentPalette';
import type { BloomPostProcessor } from '../../../utils/bloomPostProcessor';
import type { GpuResourcePool } from '../../../utils/gpuResourcePool';
import type { GpuLifecycle } from '../../../utils/gpuLifecycle';
import type { LayoutType } from '../../../utils/shaderVersion';
import type React from 'react';
import { updateVideoTexture, type VideoTextureState } from './textures';

/** Upload worklet oscilloscope ring buffer into the 1D GPU texture (binding 6). */
export function uploadOscilloscopeTexture(
  device: GPUDevice,
  pool: GpuResourcePool,
  shaderFile: string,
  oscTexture: GPUTexture | null | undefined,
  oscBufferRef: React.MutableRefObject<Float32Array | null> | undefined,
): void {
  if (!usesOscilloscope(shaderFile) || !oscTexture || !pool.isAlive(oscTexture)) return;
  const oscBuf = oscBufferRef?.current;
  if (!oscBuf) return;
  device.queue.writeTexture(
    { texture: oscTexture },
    oscBuf.buffer as ArrayBuffer,
    { offset: oscBuf.byteOffset, bytesPerRow: OSC_SAMPLE_COUNT * 4 },
    { width: OSC_SAMPLE_COUNT, height: 1, depthOrArrayLayers: 1 },
  );
}

export interface FrameDrawState {
  pipeline: GPURenderPipeline | null;
  bindGroup: GPUBindGroup | null;
  uniformBuffer: GPUBuffer | null;
  cellsBuffer: GPUBuffer | null;
  channelsBuffer: GPUBuffer | null;
  channelBufferData: ArrayBuffer | null;
  channelDataView: DataView | null;
  layoutType: LayoutType;
  bezelPipeline: GPURenderPipeline | null;
  bezelBindGroup: GPUBindGroup | null;
  bezelUniformBuffer: GPUBuffer | null;
  instrumentPaletteTexture: GPUTexture | null;
  instrumentPaletteVersion: Uint8Array | null;
  audioReactiveUniformBuffer: GPUBuffer | null;
  canvasFormat: GPUTextureFormat;
  configuredCanvasSize: { w: number; h: number } | null;
  videoState: VideoTextureState;
  renderFrameCount: number;
}

export interface FrameDrawScratch {
  uniformBufferData: ArrayBuffer;
  uniformUint: Uint32Array;
  uniformFloat: Float32Array;
  bezelBufferData: ArrayBuffer;
  bezelFloat: Float32Array;
  bezelUint: Uint32Array;
  audioReactiveUniformData: Float32Array;
}

export interface FrameDrawContext {
  device: GPUDevice;
  pool: GpuResourcePool;
  lifecycle: GpuLifecycle;
  frameGen: number;
  context: GPUCanvasContext;
  canvas: HTMLCanvasElement;
  shaderFile: string;
  params: WebGPURenderParams;
  state: FrameDrawState;
  scratch: FrameDrawScratch;
  bloomProcessor: BloomPostProcessor | null | undefined;
  oscTextureRef?: React.MutableRefObject<GPUTexture | null> | undefined;
  onRefreshBindGroup: () => void;
  onDebugInfo: (updater: (prev: DebugInfo) => DebugInfo) => void;
}

export function renderWebGPUFrame(ctx: FrameDrawContext): void {
  const {
    device,
    pool,
    lifecycle,
    frameGen,
    context,
    canvas,
    shaderFile,
    params: p,
    state,
    scratch,
    bloomProcessor,
    oscTextureRef,
    onRefreshBindGroup,
    onDebugInfo,
  } = ctx;

  if (!state.pipeline || !state.bindGroup || !state.uniformBuffer || !state.cellsBuffer) {
    if (import.meta.env.DEV && state.pipeline && !state.bindGroup) {
      if (usesInstrumentPalette(shaderFile)) {
        console.warn('[WebGPU] render skipped: null bind group for instrument-palette shader', shaderFile);
      }
      if (usesOscilloscope(shaderFile)) {
        console.warn('[WebGPU] render skipped: null bind group for oscilloscope shader', shaderFile);
      }
    }
    return;
  }
  if (!pool.isAlive(state.uniformBuffer) || !pool.isAlive(state.cellsBuffer)) return;

  const configured = state.configuredCanvasSize;
  if (!configured || configured.w !== canvas.width || configured.h !== canvas.height) {
    try {
      configureCanvasContext({
        device,
        context,
        format: state.canvasFormat ?? undefined,
      });
      state.configuredCanvasSize = { w: canvas.width, h: canvas.height };
      bloomProcessor?.resize(canvas.width, canvas.height);
    } catch (e) {
      console.error('[WebGPU] mid-frame configure failed:', e);
      return;
    }
  }

  if (
    state.audioReactiveUniformBuffer &&
    (usesAudioReactive(shaderFile) || usesAudioReactiveBezel(shaderFile))
  ) {
    const meta = p.audioReactiveRef?.current;
    const bands = meta ? readAudioBands(meta) : {
      bass: 0, mid: 0, high: 0, amplitude: 0, beat: 0,
      peakL: 0, peakR: 0, rmsL: 0, rmsR: 0,
    };
    const enabled = !!(p.reactiveMode && meta);
    packAudioReactiveUniform(
      bands,
      enabled,
      p.bloomIntensity ?? 1,
      scratch.audioReactiveUniformData,
    );
    device.queue.writeBuffer(
      state.audioReactiveUniformBuffer,
      0,
      scratch.audioReactiveUniformData.buffer as ArrayBuffer,
      0,
      AUDIO_REACTIVE_UNIFORM_BYTES,
    );
    if (enabled && p.playbackStateRef?.current) {
      p.playbackStateRef.current.kickTrigger = bands.beat;
    }
  }

  if (
    usesInstrumentPalette(shaderFile)
    && p.instrumentPalette
    && !instrumentPalettesEqual(p.instrumentPalette, state.instrumentPaletteVersion)
  ) {
    if (state.instrumentPaletteTexture) {
      pool.destroyTracked(state.instrumentPaletteTexture);
    }
    const palette = p.instrumentPalette as Uint8Array;
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
    state.instrumentPaletteTexture = texture;
    state.instrumentPaletteVersion = palette;
    if (!lifecycle.isCurrent(frameGen)) return;
    onRefreshBindGroup();
  }

  uploadOscilloscopeTexture(
    device,
    pool,
    shaderFile,
    oscTextureRef?.current,
    p.oscBufferRef,
  );

  if (state.uniformBuffer) {
    const numRows = p.matrix?.numRows ?? DEFAULT_ROWS;
    const rawChannels = p.matrix?.numChannels ?? DEFAULT_CHANNELS;
    const numChannels = p.padTopChannel ? rawChannels + 1 : rawChannels;
    if (numChannels <= 0) return;
    const stepsCount = p.stepsLength ?? 32;
    const visibleRows = resolveWebGpuVisibleRows(shaderFile, numRows, stepsCount);
    const rowLimit = Math.max(1, visibleRows);

    const refState = p.playbackStateRef?.current;
    const livePlayheadRow = refState?.playheadRow ?? p.playheadRow;
    const liveBeatPhase = refState?.beatPhase ?? p.beatPhase;
    const liveKickTrigger = refState?.kickTrigger ?? p.kickTrigger;
    const liveGrooveAmount = refState?.grooveAmount ?? p.grooveAmount;
    const liveTimeSec = refState?.timeSec ?? p.timeSec;

    state.renderFrameCount++;

    const tickRow = clampPlayhead(livePlayheadRow, rowLimit);
    const computedTickOffset = tickRow - Math.floor(tickRow);
    const fractionalTick = Math.min(1, Math.max(0, Number.isFinite(computedTickOffset) ? computedTickOffset : p.tickOffset));
    const effectiveTime = p.isModuleLoaded ? liveTimeSec : p.localTime;

    const actualCanvasW = canvas.width;
    const actualCanvasH = canvas.height;

    let effectiveCellW = p.cellWidth;
    let effectiveCellH = p.cellHeight;
    const cellMode = resolveShaderMeta(shaderFile).cellSizeMode;
    if (cellMode === 'gridRect') {
      effectiveCellW = (GRID_RECT.w * actualCanvasW) / stepsCount;
      effectiveCellH = (GRID_RECT.h * actualCanvasH) / numChannels;
    } else if (cellMode === 'fullCanvas') {
      effectiveCellW = actualCanvasW / stepsCount;
      effectiveCellH = actualCanvasH / numChannels;
    }

    const { innerRadius, outerRadius } = getPolarRadii(actualCanvasW, actualCanvasH, shaderFile);

    const uniformByteLength = fillUniformPayload(state.layoutType, {
      numRows: visibleRows,
      numChannels,
      playheadRow: tickRow,
      playheadRowAsFloat: usesPlayheadRowAsFloat(shaderFile),
      isPlaying: p.isPlaying,
      cellW: effectiveCellW,
      cellH: effectiveCellH,
      canvasW: actualCanvasW,
      canvasH: actualCanvasH,
      tickOffset: fractionalTick,
      bpm: p.bpm,
      timeSec: effectiveTime,
      beatPhase: liveBeatPhase,
      groove: Math.min(1, Math.max(0, liveGrooveAmount)),
      kickTrigger: liveKickTrigger,
      activeChannels: p.activeChannels,
      isModuleLoaded: p.isModuleLoaded,
      bloomIntensity: p.bloomIntensity,
      bloomThreshold: p.bloomThreshold,
      invertChannels: isV030bTimingDebugEnabled(shaderFile)
        ? 2
        : (p.invertChannels ? 1 : 0),
      dimFactor: p.dimFactor,
      innerRadius,
      outerRadius,
      colorPalette: p.colorPalette ?? 0,
      gridRect: GRID_RECT,
      vignetteStrength: p.vignetteStrength ?? 0.0,
      themeBlend: p.themeBlend ?? 0.0,
      filmGrain: p.filmGrain ?? 0.0,
      nightPreset: p.nightPreset ?? 0,
      invertMix: p.invertMix ?? 0.0,
      paletteMode: p.paletteMode ?? 0,
      highlightInstrument: p.highlightInstrument ?? 0,
      // Only pass accessibility uniforms (slots 34/35) for shaders that declare support.
      // Shaders without supportsReducedMotion keep neutral defaults (motionScale=1.0,
      // highContrast=0) so the extra buffer bytes are written but semantically inert.
      motionScale: resolveShaderMeta(shaderFile).supportsReducedMotion
        ? (p.reducedMotion ? 0.0 : 1.0)
        : 1.0,
      highContrast: resolveShaderMeta(shaderFile).supportsReducedMotion
        ? (p.highContrast ? 1 : 0)
        : 0,
      ...(supportsStepsLength(shaderFile)
        ? { stepsLength: p.stepsLength ?? 32 }
        : {}),
    }, scratch.uniformUint, scratch.uniformFloat);
    device.queue.writeBuffer(state.uniformBuffer, 0, scratch.uniformBufferData, 0, uniformByteLength);
  }

  if (state.layoutType === 'extended' && state.channelsBuffer && state.channelDataView) {
    const rawCh = p.matrix?.numChannels ?? DEFAULT_CHANNELS;
    const channelsCount = Math.max(1, rawCh);
    const totalCount = p.padTopChannel ? channelsCount + 1 : channelsCount;
    const requiredSize = totalCount * 32;
    if (state.channelBufferData && state.channelBufferData.byteLength >= requiredSize) {
      fillChannelStates(resolveLiveChannels(p), channelsCount, state.channelDataView, p.padTopChannel);
      device.queue.writeBuffer(state.channelsBuffer, 0, state.channelBufferData, 0, requiredSize);
    }
  }

  updateVideoTexture(
    device,
    pool,
    shaderFile,
    p.externalVideoSource,
    state.videoState,
    () => {
      if (!lifecycle.isCurrent(frameGen)) return;
      onRefreshBindGroup();
    },
  );

  const numRows = p.matrix?.numRows ?? DEFAULT_ROWS;
  const stepsCount = p.stepsLength ?? 32;
  const visibleRows = resolveWebGpuVisibleRows(shaderFile, numRows, stepsCount);
  const rawChannels = p.matrix?.numChannels ?? DEFAULT_CHANNELS;
  const numChannels = p.padTopChannel ? rawChannels + 1 : rawChannels;
  let totalInstances = visibleRows * numChannels;
  totalInstances += getUiExtraInstances(shaderFile);

  const pipeline = state.pipeline;
  const bindGroup = state.bindGroup;

  const renderScene = (pass: GPURenderPassEncoder) => {
    const needsBackground = !isSinglePassCompositeShader(shaderFile);
    if (state.bezelPipeline && state.bezelBindGroup && needsBackground && state.bezelUniformBuffer) {
      const actualCanvasW = canvas.width;
      const actualCanvasH = canvas.height;
      const minDim = Math.min(actualCanvasW, actualCanvasH);
      const isCircShader = isCircularLayoutShader(shaderFile);
      const backgroundShader = getBackgroundShaderFile(shaderFile);
      const needsUIFields = needsChassisControlFields(shaderFile);

      const bezelData = scratch.bezelFloat;
      bezelData[0] = actualCanvasW;
      bezelData[1] = actualCanvasH;
      bezelData[2] = minDim * (isCircShader ? 0.05 : 0.07);

      if (p.chassisDark) {
        bezelData[3] = 0.06; bezelData[4] = 0.06; bezelData[5] = 0.07;
        bezelData[6] = 0.04; bezelData[7] = 0.04; bezelData[8] = 0.05;
        bezelData[9] = 0.04;
      } else {
        bezelData[3] = 0.92; bezelData[4] = 0.93; bezelData[5] = 0.95;
        bezelData[6] = 0.88; bezelData[7] = 0.89; bezelData[8] = 0.91;
        bezelData[9] = 0.015;
      }

      if (usesNightModeBezel(shaderFile)) {
        bezelData[10] = 0.0; bezelData[11] = 0.95; bezelData[12] = 0.32;
      } else {
        bezelData[10] = isCircShader ? 0.0 : 1.0;
        bezelData[11] = isCircShader ? 0.95 : 1.25;
        bezelData[12] = isCircShader ? 0.32 : 0.0;
      }
      bezelData[13] = usesNightModeBezel(shaderFile) ? 0.10 : (isCircShader ? 0.0 : 0.02);
      bezelData[14] = p.dimFactor ?? 1.0;
      bezelData[15] = p.isPlaying ? 1.0 : 0.0;

      if (needsUIFields) {
        const livePlayheadRow = p.playbackStateRef?.current?.playheadRow ?? p.playheadRow;
        bezelData[16] = p.volume;
        bezelData[17] = p.pan;
        bezelData[18] = p.bpm ?? 120.0;

        const chassisEnc = resolveShaderMeta(shaderFile).chassisControlEncoding;
        if (chassisEnc === 'frosted-f32' || backgroundShader === 'chassis_frosted.wgsl') {
          bezelData[19] = p.isLooping ? 1.0 : 0.0;
          bezelData[20] = 0.0;
          bezelData[21] = livePlayheadRow;
          bezelData[22] = p.clickedButton;
          bezelData[23] = 0.0;
        } else {
          const bezelUint = scratch.bezelUint;
          bezelUint[19] = p.isLooping ? 1 : 0;
          bezelUint[20] = 0;
          bezelUint[21] = Math.floor(livePlayheadRow);
          bezelUint[22] = p.clickedButton;
        }
      }

      device.queue.writeBuffer(state.bezelUniformBuffer, 0, scratch.bezelBufferData, 0, 96);
      pass.setPipeline(state.bezelPipeline);
      pass.setBindGroup(0, state.bezelBindGroup);
      pass.draw(6, 1, 0, 0);
    }

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);

    if (totalInstances > 0) {
      if (isSinglePassCompositeShader(shaderFile)) {
        if (getUiExtraInstances(shaderFile) > 0) {
          pass.draw(6, totalInstances, 0, 0);
        } else {
          pass.draw(6, 1, 0, totalInstances);
          pass.draw(6, totalInstances, 0, 0);
        }
      } else {
        pass.draw(6, totalInstances, 0, 0);
      }
    }
  };

  const encoder = device.createCommandEncoder();
  if (!lifecycle.isCurrent(frameGen)) return;
  if (bloomProcessor) {
    bloomProcessor.render(encoder, renderScene);
  } else {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: 'store',
      }],
    });
    renderScene(pass);
    pass.end();
  }
  device.queue.submit([encoder.finish()]);

  if (import.meta.env.DEV && state.renderFrameCount % 600 === 0) {
    pool.logStats('WebGPU render');
  }

  const isOverlayActive = WEBGL_HYBRID_SHADERS.has(shaderFile);
  const layoutModeName = isCircularLayoutShader(shaderFile) ? 'CIRCULAR (WebGPU)' :
    p.isHorizontal ? 'HORIZONTAL (WebGPU)' : 'STANDARD (WebGPU)';
  onDebugInfo((prev: DebugInfo) => ({
    ...prev,
    layoutMode: layoutModeName,
    uniforms: {
      shader: shaderFile,
      overlay: isOverlayActive ? 'ACTIVE' : 'NONE',
      numRows: p.matrix?.numRows ?? DEFAULT_ROWS,
      numChannels,
      totalInstances,
      playheadRow: (p.playbackStateRef?.current?.playheadRow ?? p.playheadRow).toFixed(2),
    },
    errors: prev.errors.filter(
      (e) => e.startsWith('DEVICE-LOST') || e.startsWith('DEVICE-INIT'),
    ),
  }));
}
