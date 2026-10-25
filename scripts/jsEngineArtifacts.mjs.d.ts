export const REPO_ROOT: string;
export const JS_ENGINE_GLUE: 'libopenmpt-worklet.js';
export const JS_ENGINE_WASM: 'libopenmpt-worklet.wasm';
export const JS_ENGINE_MANIFEST_REL: string;
export const JS_ENGINE_MANIFEST_SCHEMA: number;
export type JsEngineArtifact = 'shared' | 'playback';
export const JS_ENGINE_ARTIFACTS: Readonly<Record<JsEngineArtifact, {
  glue: string;
  wasm: string;
  manifestRel: string;
  sharedMemory: boolean;
  buildFlag: string;
}>>;
export const PLAYBACK_C_EXPORTS: readonly string[];
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
  /** Read from the wasm's memory section/import: true only for the playback heap. */
  sharedMemory?: boolean;
  version: string;
  glue: { file: string; bytes: number; integrity: string };
  wasm: { file: string; bytes: number; integrity: string };
  cExportCount: number;
}

export interface WasmMemoryLimits {
  imported: boolean;
  shared: boolean;
  minPages: number;
  maxPages: number | null;
}

export interface WasmInspection {
  ok: boolean;
  exports: string[];
  imports: { module: string; name: string; kind: string }[];
  memory: WasmMemoryLimits | null;
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
export function wasmMemoryLimits(bytes: Uint8Array): WasmMemoryLimits | null;
export function inspectGlue(text: string, wasmFile?: string): GlueInspection;
export function resolveArtifactPaths(root?: string, artifact?: JsEngineArtifact): {
  dir: string;
  glue: string;
  wasm: string;
  manifest: string;
};
export function buildManifest(opts: {
  root?: string;
  artifact?: JsEngineArtifact;
  emcc: string;
  eh: string;
  simd: boolean | string | number;
  libopenmpt: string;
  variant: string;
  write?: boolean;
}): JsEngineManifest;
export function checkArtifacts(opts?: { root?: string; artifact?: JsEngineArtifact }): {
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
export function smokePlaybackArtifacts(opts?: { root?: string; largeModuleBytes?: Uint8Array }): Promise<{
  errors: string[];
  createMs: number;
  quantaDuringCreate: number;
  heapMiB: number;
}>;
