/** Throw if a GPUShaderModule reported WGSL compile errors. */
export async function assertShaderModuleCompiled(
  module: GPUShaderModule,
  label: string,
): Promise<void> {
  if (!('getCompilationInfo' in module)) return;
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter((m) => m.type === 'error');
  if (errors.length === 0) return;
  throw new Error(
    `${label}: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`,
  );
}

/**
 * Create a shader module and wait for its compilation info, throwing a
 * readable `label: line:col message` error on WGSL errors. Every production
 * shader module (pattern, bezel, bloom, compute) goes through here so a broken
 * shader never silently yields an invalid module.
 */
export async function createCheckedShaderModule(
  device: GPUDevice,
  code: string,
  label: string,
): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ code, label });
  await assertShaderModuleCompiled(module, label);
  return module;
}

function describePipelineError(label: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${label}: pipeline creation failed — ${message}`);
}

/**
 * `createRenderPipelineAsync` with a labelled error. Unlike the synchronous
 * `createRenderPipeline` (which returns an invalid pipeline on validation
 * failure and never throws), this rejects, and it compiles off the main thread.
 */
export async function createRenderPipelineChecked(
  device: GPUDevice,
  descriptor: GPURenderPipelineDescriptor,
  label: string,
): Promise<GPURenderPipeline> {
  try {
    return await device.createRenderPipelineAsync({ label, ...descriptor });
  } catch (e) {
    throw describePipelineError(label, e);
  }
}

/** Compute counterpart of {@link createRenderPipelineChecked}. */
export async function createComputePipelineChecked(
  device: GPUDevice,
  descriptor: GPUComputePipelineDescriptor,
  label: string,
): Promise<GPUComputePipeline> {
  try {
    return await device.createComputePipelineAsync({ label, ...descriptor });
  } catch (e) {
    throw describePipelineError(label, e);
  }
}

/** Prefix for errors surfaced from the device's `uncapturederror` event. */
export const GPU_ERROR_PREFIX = 'GPU-ERROR';
/** Max GPU-ERROR lines kept in DebugInfo.errors (newest win). */
export const MAX_GPU_ERRORS = 5;

/**
 * Route `uncapturederror` events into a callback with a readable message.
 * Returns a detach function.
 */
export function attachUncapturedErrorHandler(
  device: GPUDevice,
  onError: (message: string) => void,
): () => void {
  if (typeof device.addEventListener !== 'function') return () => {};
  const handler = (event: Event) => {
    const error = (event as GPUUncapturedErrorEvent).error;
    const kind = error?.constructor?.name ?? 'GPUError';
    const message = `${GPU_ERROR_PREFIX}: ${kind}: ${error?.message ?? 'unknown error'}`;
    console.error(`[WebGPU] ${message}`);
    onError(message);
  };
  device.addEventListener('uncapturederror', handler);
  return () => device.removeEventListener('uncapturederror', handler);
}

/** Append a GPU-ERROR line to an errors list, deduped and capped at MAX_GPU_ERRORS. */
export function appendGpuError(errors: readonly string[], message: string): string[] {
  if (errors.includes(message)) return errors as string[];
  const gpuErrors = errors.filter((e) => e.startsWith(GPU_ERROR_PREFIX));
  const others = errors.filter((e) => !e.startsWith(GPU_ERROR_PREFIX));
  return [...others, ...gpuErrors.slice(-(MAX_GPU_ERRORS - 1)), message];
}
