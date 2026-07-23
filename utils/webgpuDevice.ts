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
 *
 * Explicitly NOT requested (no production shader or bloom usage):
 *   float32-blendable, clip-distances, depth32float-stencil8,
 *   dual-source-blending, subgroups, texture-component-swizzle, shader-f16
 *
 * Bloom uses `rgba16float` intermediates — filterable without float32-filterable.
 *
 * ## Limits
 *
 * We soft-request a storage-buffer binding size large enough for dense patterns
 * (e.g. 256 rows × 128 channels × 8 B high-precision cells ≈ 256 KiB; headroom
 * for compute readback and multi-buffer layouts). If the adapter cannot meet a
 * requested limit we skip it and log a clear console warning rather than failing hard.
 *
 * ## Power preference
 *
 * Lite mode (`?lite=1`, mobile detection, user toggle) → `low-power`.
 * Desktop / full mode → `high-performance`.
 */

/** Optional features that production code may enable when the adapter supports them. */
export const OPTIONAL_PRODUCTION_FEATURES: readonly GPUFeatureName[] = [
  'float32-filterable',
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

export interface WebGPUDeviceResult {
  adapter: GPUAdapter;
  device: GPUDevice;
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

/**
 * Build requiredLimits that are within adapter capabilities.
 * Skips any preferred limit the adapter cannot meet (soft fail + log).
 */
export function buildSoftRequiredLimits(
  adapter: GPUAdapter,
  preferred: Record<string, number> = {
    maxStorageBufferBindingSize: PREFERRED_MAX_STORAGE_BUFFER_BINDING_SIZE,
    maxStorageBuffersPerShaderStage: PREFERRED_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE,
  },
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
 * Request a GPUAdapter + GPUDevice with production feature policy, soft limits,
 * and power preference. Throws WebGPUInitError on hard failure.
 */
export async function requestWebGPUDevice(
  options: RequestWebGPUDeviceOptions = {},
): Promise<WebGPUDeviceResult> {
  if (!isWebGPUApiAvailable()) {
    throw new WebGPUInitError(
      'WebGPU API not available in this browser',
      'unsupported',
      false,
    );
  }

  const liteMode = options.liteMode ?? false;
  const powerPreference =
    options.powerPreference ?? powerPreferenceForMode(liteMode);

  const adapter = await navigator.gpu.requestAdapter({ powerPreference });
  if (options.isCancelled?.()) {
    throw new WebGPUInitError('WebGPU init cancelled', 'device-failed', true);
  }
  if (!adapter) {
    throw new WebGPUInitError(
      `requestAdapter returned null (powerPreference=${powerPreference})`,
      'no-adapter',
      true,
    );
  }

  // Hard-required features (rare — prefer optional for Safari/Firefox compatibility).
  const hardRequired = options.requiredFeatures ?? [];
  const missingRequired = hardRequired.filter((f) => !adapter.features.has(f));
  if (missingRequired.length > 0) {
    throw new WebGPUInitError(
      `Required GPU features not available: ${missingRequired.join(', ')}`,
      'device-failed',
      false,
    );
  }

  const optionalEnabled = selectOptionalFeatures(
    adapter,
    options.extraOptionalFeatures ?? [],
  );
  const requiredFeatures: GPUFeatureName[] = [
    ...hardRequired,
    ...optionalEnabled.filter((f) => !hardRequired.includes(f)),
  ];

  const appliedLimits = buildSoftRequiredLimits(adapter);

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({
      requiredFeatures,
      requiredLimits: appliedLimits,
    });
  } catch (err) {
    // Retry without custom limits if the browser rejected the limit dict.
    console.warn(
      '[WebGPU] requestDevice with preferred limits failed; retrying with defaults:',
      err instanceof Error ? err.message : err,
    );
    try {
      device = await adapter.requestDevice({ requiredFeatures });
    } catch (err2) {
      // Last resort: bare device (no optional features) for maximum compatibility.
      console.warn(
        '[WebGPU] requestDevice with optional features failed; retrying bare device:',
        err2 instanceof Error ? err2.message : err2,
      );
      try {
        device = await adapter.requestDevice();
      } catch (err3) {
        const msg = err3 instanceof Error ? err3.message : String(err3);
        throw new WebGPUInitError(
          `requestDevice failed: ${msg}`,
          'device-failed',
          true,
        );
      }
    }
  }

  if (options.isCancelled?.()) {
    try {
      device.destroy();
    } catch {
      /* ignore */
    }
    throw new WebGPUInitError('WebGPU init cancelled', 'device-failed', true);
  }

  const enabledFeatures = requiredFeatures.filter((f) => device.features.has(f));

  if (import.meta.env.DEV) {
    console.info(
      `[WebGPU] device ready (power=${powerPreference}, features=[${enabledFeatures.join(', ') || 'none'}], ` +
        `limits={maxStorageBufferBindingSize=${device.limits.maxStorageBufferBindingSize}})`,
    );
  }

  return {
    adapter,
    device,
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
 * when we should fall back to WebGL2/HTML.
 */
export async function probeWebGPUCanvasPresentation(
  device: GPUDevice,
  format?: GPUTextureFormat,
): Promise<boolean> {
  if (typeof document === 'undefined') return false;

  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) return false;

  const fmt = format ?? navigator.gpu.getPreferredCanvasFormat();
  try {
    context.configure({
      device,
      format: fmt,
      alphaMode: 'opaque',
      usage: DEFAULT_CANVAS_USAGE,
    });

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
      return false;
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
    return maxA > 128 && maxR > 128;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn(
        '[WebGPU] canvas presentation probe failed:',
        err instanceof Error ? err.message : err,
      );
    }
    return false;
  } finally {
    try {
      context.unconfigure();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Configure a canvas GPUCanvasContext with explicit usage for rendering and
 * optional screenshot copy-out. Re-call after canvas resize.
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

  options.context.configure(config);
  return format;
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
   * Called when the device is lost for any reason.
   * `intentional` is true when the app called device.destroy() during cleanup.
   */
  onLost: (info: GPUDeviceLostInfo, intentional: boolean) => void;
}

/**
 * Attach a device.lost watcher. Returns a disposer that marks subsequent lost
 * events as intentional (used on effect cleanup before device.destroy()).
 */
export function attachDeviceLostHandler(
  device: GPUDevice,
  handlers: DeviceLostHandlers,
): () => void {
  let intentional = false;
  let disposed = false;

  device.lost.then((info) => {
    if (disposed) return;
    handlers.onLost(info, intentional || info.reason === 'destroyed');
  }).catch(() => {
    /* device.lost rejection is not expected; ignore */
  });

  return () => {
    intentional = true;
    disposed = true;
  };
}

/**
 * Prefer float32 textures only when the device enabled float32-filterable
 * (linear filtering of rgba32float). Otherwise rgba8unorm.
 */
export function preferredSampledImageFormat(device: GPUDevice): GPUTextureFormat {
  return device.features.has('float32-filterable') ? 'rgba32float' : 'rgba8unorm';
}
