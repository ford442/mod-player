/**
 * Shared WebGPU device + canvas-context initialization.
 *
 * All production and experimental PatternDisplay paths should use this module
 * instead of calling requestAdapter / requestDevice / context.configure ad-hoc.
 *
 * ## Feature policy
 *
 * Only request optional features that production host code actually uses.
 * Requesting unused experimental features can fail on Safari Tech Preview /
 * Firefox WebGPU even when the core path would work.
 *
 * | Feature              | Used by                                      | Fallback if missing        |
 * |----------------------|----------------------------------------------|----------------------------|
 * | `float32-filterable` | Video/button textures as `rgba32float` with  | Use `rgba8unorm` textures  |
 * |                      | linear filtering (useWebGPURender)           |                            |
 * | `timestamp-query`    | GPU compute / render pass durations in the   | Skip queries; debug panel  |
 * |                      | debug panel (renderers/webgpu/timestampQuery)| reports "unavailable"      |
 *
 * `timestamp-query` is requested for full mode only — lite mode is running on a
 * power budget and has no debug panel to show the numbers in.
 *
 * Explicitly NOT requested (no production shader or bloom usage):
 *   float32-blendable, clip-distances, depth32float-stencil8,
 *   dual-source-blending, subgroups, texture-component-swizzle, shader-f16
 *
 * `subgroups` / `shader-f16` stay off the list until a *measured* FFT kernel
 * needs them and Safari/Firefox still boot without them — the compute analysis
 * pass (shaders/lib/fft.wgsl) is written to core WGSL for that reason.
 *
 * Bloom uses `rgba16float` intermediates — filterable without float32-filterable.
 *
 * ## Viz policy (this phase)
 *
 * WebGPU is required for the GPU visualizer. Probe / init failure is a **hard
 * fail** for viz — do not auto-start WebGL2/HTML shader backends. After a
 * session hard-fail, this module refuses further `requestDevice()` calls (#395).
 *
 * ## Limits
 *
 * We soft-request a storage-buffer binding size large enough for dense patterns
 * (e.g. 256 rows × 128 channels × 8 B high-precision cells ≈ 256 KiB; headroom
 * for compute readback and multi-buffer layouts). If the adapter cannot meet a
 * requested limit we skip it and log a clear console warning rather than failing hard.
 *
 * ## Adapter / device ladder
 *
 * 1. core adapter → `requestDevice` with soft limits + optional features,
 *    then features only, then bare;
 * 2. only if the core adapter is null or every rung above failed:
 *    `requestAdapter({ featureLevel: 'compatibility' })` and the same device
 *    rungs (#492). Compatibility-mode hardware (OpenGL ES 3.1 / D3D11-class)
 *    gets no core adapter at all; its default `maxStorageBuffersInVertexStage`
 *    is 0 while the pattern shaders read cells from a vertex-visible storage
 *    buffer, so that rung also asks for the adapter's per-stage maxima.
 *
 * ## Power preference
 *
 * Lite mode (`?lite=1`, mobile detection, user toggle) → `low-power`.
 * Desktop / full mode → `high-performance`.
 *
 * ## Canvas configuration (#492)
 *
 * `configure()` runs once per device and once per output-format change — never
 * on resize: the canvas texture follows `canvas.width/height` on the next
 * `getCurrentTexture()`. The output is the preferred 8-bit format, or — only
 * for `ShaderMeta.hdrOutput` shaders on a `(dynamic-range: high)` display whose
 * WebGPU canvas implements `toneMapping` — `rgba16float` with
 * `toneMapping: { mode: 'extended' }` (`resolveCanvasOutput`).
 */

import {
  isWebGPUSessionBlocked,
  getWebGPUSessionBlockReason,
  markWebGPUSessionFailed,
  publishWebGPUProbeReady,
  readAdapterInfo,
  type WebGPUProbeAdapterInfo,
} from './webgpuProbe';
import { createLogger } from './log';

const log = createLogger('WebGPU');

/** Optional features that production code may enable when the adapter supports them. */
export const OPTIONAL_PRODUCTION_FEATURES: readonly GPUFeatureName[] = [
  'float32-filterable',
] as const;

/**
 * Optional features requested only in full (non-lite) mode.
 *
 * Same policy as OPTIONAL_PRODUCTION_FEATURES — enabled when the adapter has
 * them, silently skipped when it does not. Never move an entry here into the
 * hard-required list.
 */
export const OPTIONAL_FULL_MODE_FEATURES: readonly GPUFeatureName[] = [
  'timestamp-query',
] as const;

/**
 * Features previously requested unconditionally. Kept here as documentation so
 * they are not re-added without a concrete shader/host consumer.
 */
export const DOCUMENTED_UNUSED_FEATURES: readonly string[] = [
  'float32-blendable',
  'clip-distances',
  'depth32float-stencil8',
  'dual-source-blending',
  'subgroups',
  'texture-component-swizzle',
  'shader-f16',
] as const;

/** Minimum storage-buffer binding size we prefer (16 MiB). Plenty for tracker patterns. */
export const PREFERRED_MAX_STORAGE_BUFFER_BINDING_SIZE = 16 * 1024 * 1024;

/** Soft preference for max storage buffers per shader stage (default is often 8). */
export const PREFERRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE = 8;

/**
 * Canvas texture usage: render target + COPY_SRC for screenshot / pixel-readback export.
 * Numeric fallbacks match the WebGPU spec so this module can load when the
 * GPUTextureUsage global is absent (non-WebGPU browsers).
 */
export const DEFAULT_CANVAS_USAGE: GPUTextureUsageFlags =
  typeof GPUTextureUsage !== 'undefined'
    ? GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    : ((0x10 | 0x01) as GPUTextureUsageFlags); // RENDER_ATTACHMENT | COPY_SRC

export type WebGPUDeviceStatus =
  | 'initializing'
  | 'unsupported'
  | 'no-adapter'
  | 'device-failed'
  | 'ready'
  | 'lost';

export interface RequestWebGPUDeviceOptions {
  /** When true, prefer low-power adapter (lite / mobile). Default false. */
  liteMode?: boolean;
  /**
   * Extra optional features to enable if the adapter supports them.
   * Merged with OPTIONAL_PRODUCTION_FEATURES; never hard-required.
   */
  extraOptionalFeatures?: readonly GPUFeatureName[];
  /**
   * Features that MUST be present. If any are missing, request fails with a
   * clear error. Prefer optional enablement for broad browser support.
   */
  requiredFeatures?: readonly GPUFeatureName[];
  /** Override power preference (wins over liteMode mapping). */
  powerPreference?: GPUPowerPreference;
  /** Abort / ignore if true when checked during async work. */
  isCancelled?: () => boolean;
}

/** Which rung of the adapter ladder produced the device. */
export type WebGPUFeatureLevel = 'core' | 'compatibility';

export interface WebGPUDeviceResult {
  adapter: GPUAdapter;
  device: GPUDevice;
  featureLevel: WebGPUFeatureLevel;
  /** Features that were successfully enabled on the device. */
  enabledFeatures: GPUFeatureName[];
  /** Limits that were successfully requested (subset of preferred). */
  appliedLimits: Record<string, number>;
  /** Preferred presentation format for this browser/OS. */
  preferredCanvasFormat: GPUTextureFormat;
}

export interface ConfigureCanvasOptions {
  device: GPUDevice;
  context: GPUCanvasContext;
  /** Defaults to navigator.gpu.getPreferredCanvasFormat(). */
  format?: GPUTextureFormat;
  alphaMode?: GPUCanvasAlphaMode;
  /** Defaults to RENDER_ATTACHMENT | COPY_SRC. */
  usage?: GPUTextureUsageFlags;
  viewFormats?: GPUTextureFormat[];
  colorSpace?: PredefinedColorSpace;
  /** Omitted (= the browser's `standard` default) unless set. */
  toneMapping?: GPUCanvasToneMapping;
}

export class WebGPUInitError extends Error {
  readonly status: WebGPUDeviceStatus;
  readonly recoverable: boolean;

  constructor(message: string, status: WebGPUDeviceStatus, recoverable = true) {
    super(message);
    this.name = 'WebGPUInitError';
    this.status = status;
    this.recoverable = recoverable;
  }
}

/** Map lite / full mode to adapter power preference. */
export function powerPreferenceForMode(liteMode: boolean): GPUPowerPreference {
  return liteMode ? 'low-power' : 'high-performance';
}

/** True when the WebGPU API exists on this navigator. */
export function isWebGPUApiAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null;
}

/**
 * Select optional features that are both in our production allow-list (plus
 * caller extras) and present on the adapter.
 */
export function selectOptionalFeatures(
  adapter: GPUAdapter,
  extra: readonly GPUFeatureName[] = [],
): GPUFeatureName[] {
  const candidates = new Set<GPUFeatureName>([
    ...OPTIONAL_PRODUCTION_FEATURES,
    ...extra,
  ]);
  const selected: GPUFeatureName[] = [];
  for (const feature of candidates) {
    if (adapter.features.has(feature)) {
      selected.push(feature);
    }
  }
  return selected;
}

const PREFERRED_LIMITS: Readonly<Record<string, number>> = {
  maxStorageBufferBindingSize: PREFERRED_MAX_STORAGE_BUFFER_BINDING_SIZE,
  maxStorageBuffersPerShaderStage: PREFERRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE,
};

/**
 * Compatibility rung only: its per-stage storage-buffer defaults are 0 in the
 * vertex stage, which no pattern bind group layout can live with. Soft, like
 * every other limit — clamped to whatever the adapter reports.
 */
export const COMPATIBILITY_PREFERRED_LIMITS: Readonly<Record<string, number>> = {
  ...PREFERRED_LIMITS,
  maxStorageBuffersInVertexStage: PREFERRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE,
  maxStorageBuffersInFragmentStage: PREFERRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE,
};

/**
 * Build requiredLimits that are within adapter capabilities.
 * Skips any preferred limit the adapter cannot meet (soft fail + log).
 */
export function buildSoftRequiredLimits(
  adapter: GPUAdapter,
  preferred: Readonly<Record<string, number>> = PREFERRED_LIMITS,
): Record<string, number> {
  const applied: Record<string, number> = {};
  const adapterLimits = adapter.limits as unknown as Record<string, number>;

  for (const [key, wanted] of Object.entries(preferred)) {
    const adapterMax = adapterLimits[key];
    if (typeof adapterMax !== 'number') {
      console.warn(
        `[WebGPU] Limit "${key}" not reported by adapter; skipping request (wanted ${wanted}).`,
      );
      continue;
    }
    if (adapterMax < wanted) {
      // Soft fail: use the adapter maximum rather than aborting init.
      console.warn(
        `[WebGPU] Adapter limit ${key}=${adapterMax} is below preferred ${wanted}; ` +
          `requesting adapter maximum. Large patterns may fail soft at buffer creation.`,
      );
      applied[key] = adapterMax;
    } else {
      applied[key] = wanted;
    }
  }

  return applied;
}

/**
 * `requestAdapter` options, in the order they are tried. The compatibility
 * rung (#492) is last and only reached when the core adapter is null or every
 * `requestDevice` rung on it failed. A browser without feature levels ignores
 * the member, so that rung then simply repeats the core request.
 */
export function adapterRequestLadder(powerPreference: GPUPowerPreference): GPURequestAdapterOptions[] {
  return [
    { powerPreference },
    { powerPreference, featureLevel: 'compatibility' },
  ];
}

/**
 * The soft-limits device ladder on one adapter: preferred limits + optional
 * features, then the features alone, then a bare device. Rejects with the last
 * error once all three fail.
 */
export async function requestDeviceWithSoftLimits(
  adapter: GPUAdapter,
  requiredFeatures: GPUFeatureName[],
  requiredLimits: Record<string, number>,
): Promise<GPUDevice> {
  try {
    return await adapter.requestDevice({ requiredFeatures, requiredLimits });
  } catch (err) {
    // Retry without custom limits if the browser rejected the limit dict.
    console.warn(
      '[WebGPU] requestDevice with preferred limits failed; retrying with defaults:',
      err instanceof Error ? err.message : err,
    );
  }
  try {
    return await adapter.requestDevice({ requiredFeatures });
  } catch (err) {
    // Last resort: bare device (no optional features) for maximum compatibility.
    console.warn(
      '[WebGPU] requestDevice with optional features failed; retrying bare device:',
      err instanceof Error ? err.message : err,
    );
  }
  return adapter.requestDevice();
}

let latestDeviceRequest: Promise<WebGPUDeviceResult> | null = null;

/**
 * Snapshot of whichever `requestWebGPUDevice()` call is currently in flight
 * (or has most recently resolved), if any. This is the one real
 * `requestAdapter`/`requestDevice` call site in production code — other
 * modules that only need a capability hint (the renderer-selection probe,
 * `deviceCapabilities.ts`'s lite-mode heuristic) should peek this instead of
 * calling `navigator.gpu.requestAdapter()` themselves, so a dual-GPU laptop
 * never binds an iGPU probe adapter ahead of the dGPU the real device ends up
 * using. Cleared on rejection so a later peek doesn't replay a stale error.
 */
export function peekInFlightWebGPUDeviceRequest(): Promise<WebGPUDeviceResult> | null {
  return latestDeviceRequest;
}

const deviceRequestWaiters: Array<(request: Promise<WebGPUDeviceResult>) => void> = [];

/** How long a capability-hint peek waits for the real device request to start. */
export const ADAPTER_HINT_WAIT_MS = 5000;

/**
 * One-off adapter-info peek for early device-capability heuristics
 * (`utils/deviceCapabilities.ts`'s integrated-GPU → lite-mode refinement).
 *
 * Only ever reports the adapter owned by `requestWebGPUDevice()`: it never
 * issues its own `requestAdapter()`, which on a dual-GPU laptop could bind a
 * different (e.g. low-power iGPU) adapter than the live device and misreport
 * it. When no device request has started yet it waits up to `waitMs` for one,
 * then gives up with `undefined`. Never throws.
 */
export async function peekAdapterInfoForCapabilityHint(
  waitMs: number = ADAPTER_HINT_WAIT_MS,
): Promise<GPUAdapterInfo | undefined> {
  let request = latestDeviceRequest;
  if (!request) {
    // Boxed: resolving with the request promise itself would await it here.
    const boxed = await new Promise<{ request: Promise<WebGPUDeviceResult> } | null>((resolve) => {
      const waiter = (r: Promise<WebGPUDeviceResult>) => {
        clearTimeout(timer);
        resolve({ request: r });
      };
      const timer = setTimeout(() => {
        const i = deviceRequestWaiters.indexOf(waiter);
        if (i >= 0) deviceRequestWaiters.splice(i, 1);
        resolve(null);
      }, waitMs);
      deviceRequestWaiters.push(waiter);
    });
    request = boxed?.request ?? null;
  }
  if (!request) return undefined;
  try {
    const result = await request;
    return result.adapter.info as GPUAdapterInfo | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Request a GPUAdapter + GPUDevice with production feature policy, soft limits,
 * and power preference. Throws WebGPUInitError on hard failure.
 *
 * The only production call site for `requestAdapter`/`requestDevice` — see
 * `peekInFlightWebGPUDeviceRequest` / `peekAdapterInfoForCapabilityHint` for
 * how other modules observe this instead of requesting their own adapter.
 */
export async function requestWebGPUDevice(
  options: RequestWebGPUDeviceOptions = {},
): Promise<WebGPUDeviceResult> {
  const requestPromise = requestWebGPUDeviceUncached(options);
  latestDeviceRequest = requestPromise;
  for (const notify of deviceRequestWaiters.splice(0)) notify(requestPromise);
  requestPromise.catch(() => {
    if (latestDeviceRequest === requestPromise) {
      latestDeviceRequest = null;
    }
  });
  return requestPromise;
}

interface LadderFailure {
  stage: 'adapter' | 'device';
  message: string;
  adapterInfo: WebGPUProbeAdapterInfo | undefined;
}

interface LadderPick {
  adapter: GPUAdapter;
  device: GPUDevice;
  requiredFeatures: GPUFeatureName[];
  appliedLimits: Record<string, number>;
  adapterInfo: WebGPUProbeAdapterInfo | undefined;
  featureLevel: WebGPUFeatureLevel;
}

async function requestWebGPUDeviceUncached(
  options: RequestWebGPUDeviceOptions = {},
): Promise<WebGPUDeviceResult> {
  // #395 — after a hard probe fail, never call requestDevice again this session.
  if (isWebGPUSessionBlocked()) {
    const reason = getWebGPUSessionBlockReason() ?? 'WebGPU session blocked';
    throw new WebGPUInitError(
      `WebGPU session blocked (no further requestDevice): ${reason}`,
      'device-failed',
      false,
    );
  }

  if (!isWebGPUApiAvailable()) {
    markWebGPUSessionFailed('api', 'WebGPU API not available in this browser');
    throw new WebGPUInitError(
      'WebGPU API not available in this browser',
      'unsupported',
      false,
    );
  }

  const liteMode = options.liteMode ?? false;
  const powerPreference =
    options.powerPreference ?? powerPreferenceForMode(liteMode);

  // Hard-required features (rare — prefer optional for Safari/Firefox compatibility).
  const hardRequired = options.requiredFeatures ?? [];
  let failure: LadderFailure | null = null;
  let picked: LadderPick | null = null;

  for (const rung of adapterRequestLadder(powerPreference)) {
    const featureLevel: WebGPUFeatureLevel = rung.featureLevel === 'compatibility' ? 'compatibility' : 'core';
    const adapter = await navigator.gpu.requestAdapter(rung);
    if (options.isCancelled?.()) {
      throw new WebGPUInitError('WebGPU init cancelled', 'device-failed', true);
    }
    if (!adapter) {
      // A device failure on an earlier rung is the more useful report.
      failure ??= {
        stage: 'adapter',
        message: `requestAdapter returned null (powerPreference=${powerPreference})`,
        adapterInfo: undefined,
      };
      continue;
    }

    const adapterInfo = await readAdapterInfo(adapter);

    const missingRequired = hardRequired.filter((f) => !adapter.features.has(f));
    if (missingRequired.length > 0) {
      const msg = `Required GPU features not available: ${missingRequired.join(', ')}`;
      markWebGPUSessionFailed('device', msg, adapterInfo);
      throw new WebGPUInitError(msg, 'device-failed', false);
    }

    const optionalEnabled = selectOptionalFeatures(adapter, [
      ...(options.extraOptionalFeatures ?? []),
      ...(liteMode ? [] : OPTIONAL_FULL_MODE_FEATURES),
    ]);
    const requiredFeatures: GPUFeatureName[] = [
      ...hardRequired,
      ...optionalEnabled.filter((f) => !hardRequired.includes(f)),
    ];
    const appliedLimits = buildSoftRequiredLimits(
      adapter,
      featureLevel === 'compatibility' ? COMPATIBILITY_PREFERRED_LIMITS : PREFERRED_LIMITS,
    );

    try {
      const device = await requestDeviceWithSoftLimits(adapter, requiredFeatures, appliedLimits);
      picked = { adapter, device, requiredFeatures, appliedLimits, adapterInfo, featureLevel };
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failure = { stage: 'device', message: `requestDevice failed: ${msg}`, adapterInfo };
    }
  }

  if (!picked) {
    // Every ladder rung records a failure before moving on, so `failure` is set.
    const { stage, message, adapterInfo } = failure!;
    markWebGPUSessionFailed(stage, message, adapterInfo);
    throw new WebGPUInitError(message, stage === 'adapter' ? 'no-adapter' : 'device-failed', false);
  }
  const { adapter, device, requiredFeatures, appliedLimits, adapterInfo, featureLevel } = picked;

  if (options.isCancelled?.()) {
    try {
      device.destroy();
    } catch {
      /* ignore */
    }
    throw new WebGPUInitError('WebGPU init cancelled', 'device-failed', true);
  }

  const enabledFeatures = requiredFeatures.filter((f) => device.features.has(f));

  publishWebGPUProbeReady(adapterInfo);

  log.log(
    `device ready (featureLevel=${featureLevel}, power=${powerPreference}, features=[${enabledFeatures.join(', ') || 'none'}], ` +
      `limits={maxStorageBufferBindingSize=${device.limits.maxStorageBufferBindingSize}})`,
  );

  return {
    adapter,
    device,
    featureLevel,
    enabledFeatures,
    appliedLimits,
    preferredCanvasFormat: navigator.gpu.getPreferredCanvasFormat(),
  };
}

/**
 * Verify that WebGPU can present pixels to an HTML canvas.
 *
 * Some Chrome / SwiftShader / headless environments expose a usable adapter and
 * device, but swapchain contents never composite (createImageBitmap reads as
 * transparent black). Pattern shaders then look "broken" for every file even
 * though pipelines and submit succeed. Call after requestDevice; returns false
 * when presentation is unusable (hard-fail viz; do not start WebGL2 shaders).
 *
 * Configures via `configureCanvasContext` — the same helper the real
 * swapchain uses — so the probe and runtime never disagree on alphaMode /
 * usage / format (bloom, screenshot and createImageBitmap paths all assume
 * one configuration). The probe's clear is fully opaque (a=1), so
 * premultiplied vs. opaque compositing reads back identically here.
 *
 * Also reports whether this browser's canvas implements `toneMapping` (the
 * HDR output gate), read off the probe's own configuration so the real canvas
 * is configured exactly once.
 */
export async function probeWebGPUCanvasPresentation(
  device: GPUDevice,
  format?: GPUTextureFormat,
): Promise<CanvasPresentationProbe> {
  const result = { presents: false, extendedToneMapping: false };
  if (typeof document === 'undefined') return result;

  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) return result;

  const fmt = format ?? navigator.gpu.getPreferredCanvasFormat();
  try {
    configureCanvasContext({ device, context, format: fmt });
    result.extendedToneMapping = canvasSupportsToneMapping(context);

    const tex = context.getCurrentTexture();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: tex.createView(),
        loadOp: 'clear',
        clearValue: { r: 1, g: 0, b: 0, a: 1 },
        storeOp: 'store',
      }],
    });
    pass.end();
    device.queue.submit([encoder.finish()]);

    try {
      await device.queue.onSubmittedWorkDone();
    } catch {
      /* optional sync point — older browsers may lack it */
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    const bitmap = await createImageBitmap(canvas);
    const offscreen = document.createElement('canvas');
    offscreen.width = 8;
    offscreen.height = 8;
    const ctx2d = offscreen.getContext('2d');
    if (!ctx2d) {
      bitmap.close();
      return result;
    }
    ctx2d.drawImage(bitmap, 0, 0);
    bitmap.close();
    const data = ctx2d.getImageData(0, 0, 8, 8).data;
    let maxA = 0;
    let maxR = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] ?? 0;
      const r = data[i] ?? 0;
      if (a > maxA) maxA = a;
      if (r > maxR) maxR = r;
    }
    // Opaque red clear must survive presentation. Transparent black (maxA === 0)
    // means the swapchain never reached the canvas.
    result.presents = maxA > 128 && maxR > 128;
    return result;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn(
        '[WebGPU] canvas presentation probe failed:',
        err instanceof Error ? err.message : err,
      );
    }
    return result;
  } finally {
    try {
      context.unconfigure();
    } catch {
      /* ignore */
    }
  }
}

export interface CanvasPresentationProbe {
  /** An opaque clear reached the page (false = hard-fail viz). */
  presents: boolean;
  /** The canvas implements `toneMapping` (see `canvasSupportsToneMapping`). */
  extendedToneMapping: boolean;
}

/**
 * Configure a canvas GPUCanvasContext with explicit usage for rendering and
 * optional screenshot copy-out. Once per device and per output format — a
 * resize needs no reconfigure (the next `getCurrentTexture()` follows
 * `canvas.width/height`), and `configure()` resets the canvas contents.
 *
 * Default `alphaMode` is `'premultiplied'`, not `'opaque'`: the chassis/bezel
 * pass and bloom composite the pattern canvas over dark HTML chrome, and
 * `probeWebGPUCanvasPresentation` shares this exact helper so the boot probe
 * never disagrees with the runtime swapchain about how alpha is composited.
 */
export function configureCanvasContext(options: ConfigureCanvasOptions): GPUTextureFormat {
  const format =
    options.format ?? navigator.gpu.getPreferredCanvasFormat();
  const usage = options.usage ?? DEFAULT_CANVAS_USAGE;

  const config: GPUCanvasConfiguration = {
    device: options.device,
    format,
    alphaMode: options.alphaMode ?? 'premultiplied',
    usage,
  };

  if (options.viewFormats && options.viewFormats.length > 0) {
    config.viewFormats = options.viewFormats;
  }
  if (options.colorSpace) {
    config.colorSpace = options.colorSpace;
  }
  if (options.toneMapping) {
    config.toneMapping = options.toneMapping;
  }

  options.context.configure(config);
  return format;
}

/** Canvas format for HDR output: always a valid canvas format, filterable and renderable. */
export const HDR_CANVAS_FORMAT: GPUTextureFormat = 'rgba16float';

/**
 * `configure()` members added for HDR output. The colour space is explicit:
 * the scene is authored as sRGB-encoded values, so `rgba16float` + 'srgb'
 * shows [0, 1] exactly like the 8-bit canvas and only values above 1 brighter.
 */
export const HDR_CANVAS_CONFIG = {
  colorSpace: 'srgb',
  toneMapping: { mode: 'extended' },
} as const satisfies Pick<ConfigureCanvasOptions, 'colorSpace' | 'toneMapping'>;

/** Media query a display matches when it can show more than SDR white. */
export const HIGH_DYNAMIC_RANGE_QUERY = '(dynamic-range: high)';

/** The swapchain's output: `format` plus whether it is the extended-range HDR config. */
export interface CanvasOutput {
  format: GPUTextureFormat;
  hdr: boolean;
}

/**
 * HDR output only when every gate holds: the shader opted in
 * (`ShaderMeta.hdrOutput`), the display reports high dynamic range, the
 * browser's canvas implements `toneMapping`, and this is not lite mode (no
 * bloom there, so nothing exceeds SDR white). Otherwise the preferred 8-bit
 * format, exactly as before #492.
 */
export function resolveCanvasOutput(gates: {
  preferredFormat: GPUTextureFormat;
  shaderWantsHdr: boolean;
  displayHdr: boolean;
  toneMappingSupported: boolean;
  liteMode: boolean;
}): CanvasOutput {
  const hdr = gates.shaderWantsHdr && gates.displayHdr && gates.toneMappingSupported && !gates.liteMode;
  return { format: hdr ? HDR_CANVAS_FORMAT : gates.preferredFormat, hdr };
}

/**
 * Feature detection the spec prescribes: an implementation without tone
 * mapping leaves `toneMapping` out of `getConfiguration()`. Call on a
 * configured context.
 */
export function canvasSupportsToneMapping(context: GPUCanvasContext): boolean {
  try {
    return context.getConfiguration?.()?.toneMapping !== undefined;
  } catch {
    return false;
  }
}

/** The `(dynamic-range: high)` query — re-evaluated when the window changes display. Null without matchMedia. */
export function highDynamicRangeQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(HIGH_DYNAMIC_RANGE_QUERY)
    : null;
}

/**
 * Obtain a WebGPU canvas context or throw a clear error.
 */
export function getWebGPUCanvasContext(
  canvas: HTMLCanvasElement,
): GPUCanvasContext {
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) {
    throw new WebGPUInitError(
      'Failed to get WebGPU canvas context (getContext("webgpu") returned null)',
      'device-failed',
      true,
    );
  }
  return context;
}

export interface DeviceLostHandlers {
  /**
   * Called when the device is lost while still attached.
   * `intentional` is true for `reason === 'destroyed'` (device.destroy()).
   */
  onLost: (info: GPUDeviceLostInfo, intentional: boolean) => void;
}

/**
 * Attach a device.lost watcher. Returns a detach: after it runs, a lost event
 * (typically the device.destroy() of an effect cleanup) is not delivered.
 */
export function attachDeviceLostHandler(
  device: GPUDevice,
  handlers: DeviceLostHandlers,
): () => void {
  let detached = false;

  device.lost.then((info) => {
    if (detached) return;
    handlers.onLost(info, info.reason === 'destroyed');
  }).catch(() => {
    /* device.lost rejection is not expected; ignore */
  });

  return () => {
    detached = true;
  };
}

/**
 * Prefer float32 textures only when the device enabled float32-filterable
 * (linear filtering of rgba32float). Otherwise rgba8unorm.
 */
export function preferredSampledImageFormat(device: GPUDevice): GPUTextureFormat {
  return device.features.has('float32-filterable') ? 'rgba32float' : 'rgba8unorm';
}
