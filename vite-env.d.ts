
/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

interface ImportMetaEnv {
  readonly VITE_STORAGE_API_URL?: string;
  /** Optional CDN override for libopenmpt JS/WASM (dev / experiments). */
  readonly VITE_LIBOPENMPT_CDN_URL?: string;
}
