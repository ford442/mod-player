/**
 * URL path utilities for subpath-aware asset loading
 * 
 * Use these helpers instead of hardcoded paths to ensure assets load correctly
 * when the app is deployed under a subpath (e.g., /xm-player/)
 */

/**
 * Prepends the base URL to a path for proper subpath deployment support.
 * @param p - The path to resolve (e.g., 'worklets/openmpt-worklet.js')
 * @returns The full URL with base path
 */
export const withBase = (p: string): string => {
  const base = import.meta.env.BASE_URL || '/'
  // Remove leading slash from path to avoid double slashes
  const cleanPath = p.replace(/^\//, '')
  // Combine base (which always ends with /) with clean path
  return base + cleanPath
}

/**
 * Creates an absolute URL from a path, handling base URL correctly.
 * @param p - The path to resolve
 * @returns Full absolute URL string
 */
export const withBaseAbsolute = (p: string): string => {
  const base = import.meta.env.BASE_URL || '/'
  const cleanPath = p.replace(/^\//, '')
  return new URL(cleanPath, window.location.origin + base).toString()
}
