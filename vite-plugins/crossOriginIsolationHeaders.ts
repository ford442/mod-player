/**
 * COOP/COEP headers required for SharedArrayBuffer / Atomics (Emscripten WASM workers).
 * Used by Vite dev, preview (CI visual-smoke), and documented for production (.htaccess).
 */
export const CROSS_ORIGIN_ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  // credentialless unlocks SharedArrayBuffer while allowing cross-origin CDN resources.
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export const THREE_CHUNK = 'three-r3f';
export const REACT_VENDOR_CHUNK = 'react-vendor';

const NODE_MODULES = 'node_modules/';
/** Packages the main app and the three.js ecosystem both import — they must live in neither's chunk. */
const REACT_VENDOR_PACKAGES = new Set(['react', 'react-dom', 'zustand']);
/** Rollup/Vite helper modules that are not under node_modules but are shared the same way. */
const REACT_VENDOR_VIRTUAL_PREFIXES = ['\0vite/preload-helper', '\0commonjsHelpers'];

/**
 * Only the *top-level* copy of a shared package counts: `@react-three/fiber` and `tunnel-rat` carry
 * their own nested `zustand@3`, and root `scheduler` is the 0.21 copy used by react-reconciler —
 * those are three-only and stay with the three chunk. The one nested exception is react-dom's own
 * `scheduler`, which react-dom needs.
 */
function isReactVendorModule(id: string): boolean {
  if (REACT_VENDOR_VIRTUAL_PREFIXES.some((prefix) => id.startsWith(prefix))) return true;
  const first = id.indexOf(NODE_MODULES);
  if (first === -1) return false;
  const rel = id.slice(first + NODE_MODULES.length);
  const pkg = rel.slice(0, rel.indexOf('/'));
  if (!REACT_VENDOR_PACKAGES.has(pkg)) return false;
  return !rel.includes(NODE_MODULES) || rel.startsWith('react-dom/node_modules/scheduler/');
}

/**
 * Rollup manualChunks: isolate the three.js ecosystem from the main app bundle.
 *
 * Why react-vendor exists: Rollup pulls every *unassigned* static dependency of a manual-chunk
 * module into that chunk. With only `three-r3f` defined, react / react-dom / scheduler / zustand
 * and the preload + commonjs helpers all landed inside it, the entry statically imported them from
 * there, and `index.html` modulepreloaded the ~1 MB chunk on every page load. Modules that are
 * explicitly assigned here are never pulled into another manual chunk, so naming the shared set
 * keeps three-r3f reachable only through the lazy 3D view. `scripts/verify-bundle-budget.mjs`
 * fails the build if that regresses.
 */
export function vendorManualChunk(id: string): string | undefined {
  if (
    id.includes('node_modules/three') ||
    id.includes('node_modules/@react-three/fiber') ||
    id.includes('node_modules/@react-three/drei')
  ) {
    return THREE_CHUNK;
  }
  if (isReactVendorModule(id)) return REACT_VENDOR_CHUNK;
  return undefined;
}
