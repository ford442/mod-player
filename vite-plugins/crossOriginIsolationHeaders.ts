/**
 * COOP/COEP headers required for SharedArrayBuffer / Atomics (Emscripten WASM workers).
 * Used by Vite dev, preview (CI visual-smoke), and documented for production (.htaccess).
 */
export const CROSS_ORIGIN_ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  // credentialless unlocks SharedArrayBuffer while allowing cross-origin CDN resources.
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

/** Rollup manualChunks: isolate three.js ecosystem from the main app bundle. */
export function threeVendorManualChunk(id: string): string | undefined {
  if (
    id.includes('node_modules/three') ||
    id.includes('node_modules/@react-three/fiber') ||
    id.includes('node_modules/@react-three/drei')
  ) {
    return 'three-r3f';
  }
  return undefined;
}
