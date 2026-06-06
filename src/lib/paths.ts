/**
 * URL path utilities for subpath-aware asset loading
 * 
 * Use these helpers instead of hardcoded paths to ensure assets load correctly
 * when the app is deployed under a subpath (e.g., /xm-player/)
 */

/**
 * Detect the runtime base URL for asset loading, handling subdirectory deployments.
 * Prefers the Vite-injected BASE_URL; falls back to inferring from `window.location`.
 */
export const detectRuntimeBase = (): string => {
  const viteBase = import.meta.env.BASE_URL;
  if (viteBase && viteBase !== '/') {
    return viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
  }
  const pathname = window.location.pathname || '/';
  if (pathname.endsWith('/')) {
    return pathname;
  }
  const lastSlash = pathname.lastIndexOf('/');
  return lastSlash >= 0 ? pathname.slice(0, lastSlash + 1) : '/';
};

/**
 * Prepends the base URL to a path for proper subpath deployment support.
 * @param p - The path to resolve (e.g., 'worklets/openmpt-worklet.js')
 * @returns The full URL with base path
 */
export const withBase = (p: string): string => {
  const base = detectRuntimeBase();
  const cleanPath = p.replace(/^\//, '');
  return `${base}${cleanPath}`;
};

/**
 * Creates an absolute URL from a path, handling base URL correctly.
 * @param p - The path to resolve
 * @returns Full absolute URL string
 */
export const withBaseAbsolute = (p: string): string => {
  const base = detectRuntimeBase();
  const cleanPath = p.replace(/^\//, '');
  return new URL(cleanPath, `${window.location.origin}${base}`).toString();
};
