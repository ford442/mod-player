export const REPO_ROOT: string;
export const JS_ENGINE_GLUE: 'libopenmpt-worklet.js';
export const JS_ENGINE_WASM: 'libopenmpt-worklet.wasm';
export const JS_ENGINE_MANIFEST_REL: string;
export const JS_ENGINE_MANIFEST_SCHEMA: number;
export const REQUIRED_C_EXPORTS: readonly string[];
export const REQUIRED_RUNTIME_MEMBERS: readonly string[];
export const FORBIDDEN_RUNTIME_MEMBERS: readonly string[];

export interface JsEngineManifest {
  schema: number;
  libopenmpt: string;
  emsdk: string;
  variant: string;
  exceptions: 'wasm' | 'js';
  simd: boolean;
  version: string;
  glue: { file: string; bytes: number; integrity: string };
  wasm: { file: string; bytes: number; integrity: string };
  cExportCount: number;
}

export interface WasmInspection {
  ok: boolean;
  exports: string[];
  imports: { module: string; name: string; kind: string }[];
  error?: string;
}

export interface GlueInspection {
  isWasm2js: boolean;
  hasEsmExport: boolean;
  replacesGlobalWebAssembly: boolean;
  referencesWasmFile: boolean;
  usesJsExceptionTrampolines: boolean;
  cExports: string[];
}

export function sha384Sri(buf: Uint8Array): string;
export function cacheKey(glueBuf: Uint8Array, wasmBuf: Uint8Array): string;
export function inspectWasm(bytes: Uint8Array): WasmInspection;
export function inspectGlue(text: string): GlueInspection;
export function resolveArtifactPaths(root?: string): {
  dir: string;
  glue: string;
  wasm: string;
  manifest: string;
};
export function buildManifest(opts: {
  root?: string;
  emcc: string;
  eh: string;
  simd: boolean | string | number;
  libopenmpt: string;
  variant: string;
  write?: boolean;
}): JsEngineManifest;
export function checkArtifacts(opts?: { root?: string }): {
  errors: string[];
  manifest: JsEngineManifest | null;
  wasm: WasmInspection | null;
};
export function smokeArtifacts(opts?: { root?: string; moduleBytes?: Uint8Array }): Promise<{
  errors: string[];
  initMs: number;
  peak: number;
  heapMiB: number;
}>;
