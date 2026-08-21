/**
 * GPU audio-analysis host (compute_analysis.wgsl).
 *
 * Owns the PCM → compute → uniforms/texture pipeline that feeds audio-reactive
 * visuals, so new visuals become shader work instead of more host packing:
 *
 *   PCM block (pcmBus)
 *     → storage buffer (double-buffered, ≤ PCM_FRAME_CAPACITY stereo frames)
 *     → pass A: waveform min/max tiles  → r32float oscilloscope texture
 *     → pass B: Hann → radix-2 FFT      → 4 bands + 32 log bins
 *     → readback → AudioBandSnapshot for `audio.frequencies`
 *
 * ## What this is NOT
 *
 * The tracker engine stays on CPU/WASM. Nothing here touches pattern data,
 * note triggering, packing, or the playhead — it only reads rendered PCM.
 *
 * ## Failure policy
 *
 * A missing *device* is a hard fail for the visualizer (utils/webgpuDevice.ts).
 * A missing *compute kernel* is not: `ComputeAnalysis.create()` returns null on
 * any pipeline/shader failure and every caller falls back to the existing
 * AnalyserNode / CPU oscilloscope path. Lite mode never even tries.
 */

import { withBase } from '../../lib/paths';
import {
  OSC_SAMPLE_COUNT,
  type AudioBandSnapshot,
} from '../../../utils/audioReactive';
import { subscribePcm, type PcmBlock } from '../../../utils/pcmBus';
import type { GpuTimestampRecorder } from './timestampQuery';

/** Stereo frames retained for analysis. 2048 @ 44.1 kHz ≈ 46 ms of audio. */
export const PCM_FRAME_CAPACITY = 2048;

/** Must match MAX_FFT_SIZE in shaders/lib/fft.wgsl. */
export const MAX_FFT_SIZE = 1024;

/** Must match WAVEFORM_WORKGROUP_SIZE in shaders/lib/waveform_minmax.wgsl. */
const WAVEFORM_WORKGROUP_SIZE = 64;

/** Must match SPECTRUM_BIN_COUNT in shaders/lib/spectrum_bands.wgsl. */
export const SPECTRUM_BIN_COUNT = 32;

/** f32 slots in the spectrum meta buffer — see compute_analysis.wgsl. */
const META_FLOATS = 8;
const META_BASS = 0;
const META_LOW_MID = 1;
const META_HIGH_MID = 2;
const META_TREBLE = 3;
const META_AMPLITUDE = 4;
const META_RMS = 5;
const META_PEAK = 6;
const META_VALID = 7;

/** AnalysisParams in compute_analysis.wgsl: 8 × u32/f32. */
const PARAMS_FLOATS = 8;

/** Timestamp label for the analysis compute pass. */
export const COMPUTE_ANALYSIS_PASS_LABEL = 'compute-analysis';

/** Supported FFT window lengths. Larger needs more workgroup storage than the WebGPU baseline. */
const SUPPORTED_FFT_SIZES = [256, 512, 1024] as const;
export type FftSize = (typeof SUPPORTED_FFT_SIZES)[number];

/**
 * Bass-flux beat estimate. Matches the shape of the worklet's `AR_BEAT` well
 * enough that a shader cannot tell which path produced it.
 */
const BEAT_FLUX_GAIN = 6;
const BEAT_DECAY = 0.85;

/**
 * PCM older than this counts as silence. The worklet stops emitting blocks the
 * moment playback stops, so without this the chassis would hold the last
 * spectrum indefinitely.
 */
const PCM_STALE_MS = 250;

/** performance.now() where available; Date.now() in a worker/test context. */
const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export interface SpectrumSnapshot extends AudioBandSnapshot {
  /** Four-band split, before the CPU-compatible fold into bass/mid/high. */
  bands: { bass: number; lowMid: number; highMid: number; treble: number };
  /** Log-spaced magnitudes, SPECTRUM_BIN_COUNT entries. */
  bins: Float32Array;
}

export interface ComputeAnalysisOptions {
  /** Oscilloscope texel count; defaults to OSC_SAMPLE_COUNT. */
  oscSampleCount?: number;
  /** FFT window length; defaults to 1024. */
  fftSize?: FftSize;
}

/** Clamp an arbitrary number to a supported FFT window length. */
export function clampFftSize(requested: number): FftSize {
  let best: FftSize = SUPPORTED_FFT_SIZES[SUPPORTED_FFT_SIZES.length - 1] as FftSize;
  for (const size of SUPPORTED_FFT_SIZES) {
    if (requested <= size) return size;
    best = size;
  }
  return best;
}

/**
 * Fold the GPU's four bands into the three the existing `AudioReactive` uniform
 * carries. highMid and treble are combined in energy, not amplitude, so the
 * result matches what a single wideband "high" filter would have measured.
 */
export function foldBandsToSnapshot(
  meta: Float32Array,
  beat: number,
): SpectrumSnapshot {
  const bass = meta[META_BASS] ?? 0;
  const lowMid = meta[META_LOW_MID] ?? 0;
  const highMid = meta[META_HIGH_MID] ?? 0;
  const treble = meta[META_TREBLE] ?? 0;
  const rms = meta[META_RMS] ?? 0;
  const peak = meta[META_PEAK] ?? 0;

  return {
    bass,
    mid: lowMid,
    high: Math.sqrt(highMid * highMid + treble * treble),
    amplitude: meta[META_AMPLITUDE] ?? 0,
    beat,
    peakL: peak,
    peakR: peak,
    rmsL: rms,
    rmsR: rms,
    bands: { bass, lowMid, highMid, treble },
    bins: new Float32Array(SPECTRUM_BIN_COUNT),
  };
}

/**
 * Advance the bass-flux beat envelope. Exported for the CPU reference test —
 * the GPU never sees this, it runs on the readback.
 */
export function nextBeatEnvelope(
  bass: number,
  previousBass: number,
  previousBeat: number,
): number {
  const flux = Math.max(0, bass - previousBass) * BEAT_FLUX_GAIN;
  return Math.min(1, Math.max(flux, previousBeat * BEAT_DECAY));
}

/**
 * Fixed-capacity interleaved PCM ring.
 *
 * The worklet posts ~512-frame blocks, which is shorter than the FFT window —
 * blocks accumulate here so `spectrum_main` always sees a contiguous run of the
 * most recent frames rather than one short block padded with silence.
 *
 * Separate from ComputeAnalysis (and exported) because the wrap arithmetic is
 * the part worth testing without a GPU.
 */
export class PcmRing {
  private readonly storage: Float32Array;
  private writeFrame = 0;
  private validFrames = 0;
  private interleavedChannels: 1 | 2 = 2;
  private rate = 44100;

  constructor(readonly capacityFrames: number) {
    this.storage = new Float32Array(capacityFrames * 2);
  }

  /** Frames currently valid, saturating at `capacityFrames`. */
  get frames(): number {
    return this.validFrames;
  }

  get channels(): 1 | 2 {
    return this.interleavedChannels;
  }

  get sampleRate(): number {
    return this.rate;
  }

  reset(): void {
    this.writeFrame = 0;
    this.validFrames = 0;
  }

  /**
   * Append a block. Returns false when there was nothing to append.
   * A channel-count change discards whatever was already buffered — the old
   * frames have the wrong stride.
   */
  write(samples: Float32Array, channels: 1 | 2, sampleRate: number): boolean {
    const frameCount = Math.floor(samples.length / channels);
    if (frameCount <= 0) return false;

    if (channels !== this.interleavedChannels) {
      this.interleavedChannels = channels;
      this.reset();
    }
    if (sampleRate > 0) this.rate = sampleRate;

    // A block longer than the ring can only contribute its newest frames.
    const keep = Math.min(frameCount, this.capacityFrames);
    let src = (frameCount - keep) * channels;
    let remaining = keep;

    while (remaining > 0) {
      const chunk = Math.min(remaining, this.capacityFrames - this.writeFrame);
      this.storage.set(
        samples.subarray(src, src + chunk * channels),
        this.writeFrame * channels,
      );
      this.writeFrame = (this.writeFrame + chunk) % this.capacityFrames;
      src += chunk * channels;
      remaining -= chunk;
    }

    this.validFrames = Math.min(this.capacityFrames, this.validFrames + keep);
    return true;
  }

  /**
   * Unwrap into `out`, oldest frame first.
   * @returns the number of *samples* written (frames × channels).
   */
  linearise(out: Float32Array): number {
    const channels = this.interleavedChannels;
    const frames = this.validFrames;
    const start = (this.writeFrame - frames + this.capacityFrames) % this.capacityFrames;
    const head = Math.min(frames, this.capacityFrames - start);

    out.set(this.storage.subarray(start * channels, (start + head) * channels), 0);
    if (head < frames) {
      out.set(this.storage.subarray(0, (frames - head) * channels), head * channels);
    }
    return frames * channels;
  }
}

export class ComputeAnalysis {
  private readonly pcm = new PcmRing(PCM_FRAME_CAPACITY);
  /** Upload staging: the ring unwrapped oldest-first. */
  private readonly pcmScratch = new Float32Array(PCM_FRAME_CAPACITY * 2);
  private pcmDirty = false;

  private readonly paramsScratch = new ArrayBuffer(PARAMS_FLOATS * 4);
  private readonly paramsU32 = new Uint32Array(this.paramsScratch);
  private readonly paramsF32 = new Float32Array(this.paramsScratch);

  private readonly binsSnapshot = new Float32Array(SPECTRUM_BIN_COUNT);
  private snapshot: SpectrumSnapshot | null = null;
  private previousBass = 0;
  private previousBeat = 0;

  private readbackPending = false;
  private readbackEncoded = false;
  private unsubscribePcm: (() => void) | null = null;
  private lastPcmAt = 0;
  private disposed = false;

  private constructor(
    private readonly device: GPUDevice,
    private readonly pipelines: { waveform: GPUComputePipeline; spectrum: GPUComputePipeline },
    private readonly bindGroup: GPUBindGroup,
    private readonly buffers: {
      params: GPUBuffer;
      pcm: GPUBuffer;
      oscEnvelope: GPUBuffer;
      oscExtrema: GPUBuffer;
      meta: GPUBuffer;
      bins: GPUBuffer;
      metaStaging: GPUBuffer;
      binsStaging: GPUBuffer;
    },
    readonly spectrumTexture: GPUTexture,
    private readonly oscSampleCount: number,
    private fftSize: FftSize,
  ) {}

  /**
   * Build the pipeline, or return null when it cannot be built. Never throws —
   * a missing compute kernel degrades to the CPU path, it does not fail viz.
   */
  static async create(
    device: GPUDevice | null | undefined,
    options: ComputeAnalysisOptions = {},
  ): Promise<ComputeAnalysis | null> {
    if (!device) return null;

    const oscSampleCount = options.oscSampleCount ?? OSC_SAMPLE_COUNT;
    const fftSize = clampFftSize(options.fftSize ?? MAX_FFT_SIZE);

    try {
      const url = withBase('shaders/compute_analysis.wgsl');
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`fetch ${url} → ${response.status}`);
      }
      const code = await response.text();
      const module = device.createShaderModule({ code, label: 'compute_analysis' });

      const compilation = await module.getCompilationInfo?.();
      const errors = compilation?.messages.filter((m) => m.type === 'error') ?? [];
      if (errors.length > 0) {
        throw new Error(
          `compute_analysis.wgsl: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`,
        );
      }

      const storage = (): GPUBufferBindingLayout => ({ type: 'storage' });
      const bindGroupLayout = device.createBindGroupLayout({
        label: 'compute_analysis',
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: storage() },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: storage() },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: storage() },
          { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: storage() },
        ],
      });
      const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

      const waveform = device.createComputePipeline({
        label: 'compute_analysis:waveform',
        layout,
        compute: { module, entryPoint: 'waveform_main' },
      });
      const spectrum = device.createComputePipeline({
        label: 'compute_analysis:spectrum',
        layout,
        compute: { module, entryPoint: 'spectrum_main' },
      });

      const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
      const params = device.createBuffer({
        size: PARAMS_FLOATS * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const pcm = device.createBuffer({
        size: PCM_FRAME_CAPACITY * 2 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const oscEnvelope = device.createBuffer({ size: oscSampleCount * 4, usage: STORAGE });
      const oscExtrema = device.createBuffer({ size: oscSampleCount * 8, usage: STORAGE });
      const meta = device.createBuffer({ size: META_FLOATS * 4, usage: STORAGE });
      const bins = device.createBuffer({ size: SPECTRUM_BIN_COUNT * 4, usage: STORAGE });
      const metaStaging = device.createBuffer({
        size: META_FLOATS * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const binsStaging = device.createBuffer({
        size: SPECTRUM_BIN_COUNT * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      const bindGroup = device.createBindGroup({
        label: 'compute_analysis',
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: pcm } },
          { binding: 2, resource: { buffer: oscEnvelope } },
          { binding: 3, resource: { buffer: oscExtrema } },
          { binding: 4, resource: { buffer: meta } },
          { binding: 5, resource: { buffer: bins } },
        ],
      });

      // 32×1 r32float — the spectrum chassis binding a future shader will read.
      const spectrumTexture = device.createTexture({
        label: 'compute_analysis:spectrum',
        size: [SPECTRUM_BIN_COUNT, 1, 1],
        format: 'r32float',
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });

      const analysis = new ComputeAnalysis(
        device,
        { waveform, spectrum },
        bindGroup,
        { params, pcm, oscEnvelope, oscExtrema, meta, bins, metaStaging, binsStaging },
        spectrumTexture,
        oscSampleCount,
        fftSize,
      );
      return analysis;
    } catch (err) {
      console.warn(
        '[WebGPU] compute audio analysis unavailable; using the CPU AnalyserNode path:',
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  /**
   * Attach to / detach from the PCM bus.
   *
   * Subscribing is what makes the worklet start interleaving and posting PCM
   * blocks (see utils/pcmBus.ts), so this stays off unless a shader with
   * `usesGpuSpectrum` is actually on screen — the worklet's per-quantum budget
   * is the reason that stream is opt-in in the first place.
   */
  setEnabled(enabled: boolean): void {
    if (this.disposed) return;
    if (enabled === (this.unsubscribePcm !== null)) return;
    if (enabled) {
      this.unsubscribePcm = subscribePcm((block) => this.writePcmBlock(block));
    } else {
      this.unsubscribePcm?.();
      this.unsubscribePcm = null;
      this.pcm.reset();
      this.snapshot = null;
    }
  }

  /** Active FFT window length. */
  get windowSize(): FftSize {
    return this.fftSize;
  }

  /** True once at least one PCM block has arrived since the last encode. */
  get hasPcm(): boolean {
    return this.pcm.frames > 0;
  }

  /** Change the FFT window length. Cheap — the kernel reads it from a uniform. */
  resize(fftSize: number): void {
    this.fftSize = clampFftSize(fftSize);
  }

  /** Feed one PCM block from the bus (or a test). Keeps the newest frames. */
  writePcm(samples: Float32Array, channels: 1 | 2, sampleRate: number): void {
    this.writePcmBlock({
      samples,
      channels,
      sampleRate,
      frameCount: Math.floor(samples.length / channels),
    });
  }

  private writePcmBlock(block: PcmBlock): void {
    if (this.disposed) return;
    if (!this.pcm.write(block.samples, block.channels, block.sampleRate)) return;
    this.pcmDirty = true;
    this.lastPcmAt = now();
  }

  /**
   * Encode both analysis passes. Call once per frame, before the pattern pass,
   * on the same command encoder. No-op until PCM is flowing.
   */
  encode(encoder: GPUCommandEncoder, timestamps?: GpuTimestampRecorder | null): boolean {
    if (this.disposed || this.pcm.frames === 0) return false;

    // Playback stopped (or the worklet fell back to ScriptProcessor): stop
    // reporting a frozen spectrum and let the caller drop back to the CPU path.
    if (now() - this.lastPcmAt > PCM_STALE_MS) {
      this.pcm.reset();
      this.snapshot = null;
      return false;
    }

    if (this.pcmDirty) {
      const used = this.pcm.linearise(this.pcmScratch);
      this.device.queue.writeBuffer(
        this.buffers.pcm,
        0,
        this.pcmScratch.buffer,
        this.pcmScratch.byteOffset,
        used * 4,
      );
      this.pcmDirty = false;
    }

    this.paramsU32[0] = this.pcm.frames;
    this.paramsU32[1] = this.pcm.channels;
    this.paramsU32[2] = this.oscSampleCount;
    this.paramsU32[3] = this.fftSize;
    this.paramsU32[4] = Math.log2(this.fftSize);
    this.paramsF32[5] = this.pcm.sampleRate;
    this.paramsU32[6] = 0;
    this.paramsU32[7] = 0;
    this.device.queue.writeBuffer(this.buffers.params, 0, this.paramsScratch, 0, PARAMS_FLOATS * 4);

    const timestampWrites = timestamps?.timestampWrites(COMPUTE_ANALYSIS_PASS_LABEL);
    const pass = encoder.beginComputePass({
      label: COMPUTE_ANALYSIS_PASS_LABEL,
      ...(timestampWrites ? { timestampWrites } : {}),
    });
    pass.setBindGroup(0, this.bindGroup);

    pass.setPipeline(this.pipelines.waveform);
    pass.dispatchWorkgroups(Math.ceil(this.oscSampleCount / WAVEFORM_WORKGROUP_SIZE), 1, 1);

    // One workgroup: the FFT lives entirely in workgroup storage.
    pass.setPipeline(this.pipelines.spectrum);
    pass.dispatchWorkgroups(1, 1, 1);
    pass.end();

    encoder.copyBufferToTexture(
      { buffer: this.buffers.bins },
      { texture: this.spectrumTexture },
      { width: SPECTRUM_BIN_COUNT, height: 1, depthOrArrayLayers: 1 },
    );
    return true;
  }

  /**
   * Copy the compute oscilloscope envelope into the v0.55 r32float texture.
   * Encode after `encode()`, on the same encoder.
   */
  blitOscilloscope(encoder: GPUCommandEncoder, target: GPUTexture): void {
    if (this.disposed || this.pcm.frames === 0) return;
    encoder.copyBufferToTexture(
      { buffer: this.buffers.oscEnvelope },
      { texture: target },
      { width: Math.min(this.oscSampleCount, target.width), height: 1, depthOrArrayLayers: 1 },
    );
  }

  /**
   * Record the band/bin readback copies onto the frame encoder. Call after
   * `encode()`, before `encoder.finish()` — mapping a staging buffer that still
   * has an unsubmitted copy pending would fail validation at submit.
   */
  encodeReadback(encoder: GPUCommandEncoder): void {
    if (this.disposed || this.readbackPending || this.pcm.frames === 0) return;
    encoder.copyBufferToBuffer(this.buffers.meta, 0, this.buffers.metaStaging, 0, META_FLOATS * 4);
    encoder.copyBufferToBuffer(this.buffers.bins, 0, this.buffers.binsStaging, 0, SPECTRUM_BIN_COUNT * 4);
    this.readbackEncoded = true;
  }

  /**
   * Map the copies recorded by `encodeReadback`. Call after `queue.submit()`.
   * Results land in `readBands()` a frame or two later — the analysis is one
   * frame behind the audio, which no shader can perceive at 60 fps.
   */
  poll(): void {
    if (this.disposed || this.readbackPending || !this.readbackEncoded) return;
    this.readbackEncoded = false;
    this.readbackPending = true;
    Promise.all([
      this.buffers.metaStaging.mapAsync(GPUMapMode.READ),
      this.buffers.binsStaging.mapAsync(GPUMapMode.READ),
    ])
      .then(() => {
        if (this.disposed) return;
        const meta = new Float32Array(this.buffers.metaStaging.getMappedRange().slice(0));
        this.binsSnapshot.set(new Float32Array(this.buffers.binsStaging.getMappedRange().slice(0)));
        if ((meta[META_VALID] ?? 0) < 0.5) return;

        const bass = meta[META_BASS] ?? 0;
        const beat = nextBeatEnvelope(bass, this.previousBass, this.previousBeat);
        this.previousBass = bass;
        this.previousBeat = beat;

        const next = foldBandsToSnapshot(meta, beat);
        next.bins.set(this.binsSnapshot);
        this.snapshot = next;
      })
      .catch(() => {
        /* buffer destroyed or device lost — keep the previous snapshot */
      })
      .finally(() => {
        if (!this.disposed) {
          try { this.buffers.metaStaging.unmap(); } catch { /* already unmapped */ }
          try { this.buffers.binsStaging.unmap(); } catch { /* already unmapped */ }
        }
        this.readbackPending = false;
      });
  }

  /**
   * Latest analysis result, or null before the first readback lands.
   * Callers fall back to `readAudioBands(meta)` while this is null.
   */
  readBands(): SpectrumSnapshot | null {
    return this.snapshot;
  }

  dispose(): void {
    if (this.disposed) return;
    this.unsubscribePcm?.();
    this.unsubscribePcm = null;
    this.disposed = true;
    this.snapshot = null;
    for (const buffer of Object.values(this.buffers)) {
      try { buffer.destroy(); } catch { /* device may be lost */ }
    }
    try { this.spectrumTexture.destroy(); } catch { /* device may be lost */ }
  }
}
