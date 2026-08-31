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
