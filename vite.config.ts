import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env[.mode] files so VITE_-prefixed vars are available here in the
  // config (Vite only injects them into import.meta.env, not process.env).
  // Without this, .env.production's VITE_APP_BASE_PATH never reaches `base`.
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  // Use env-driven base for flexible deployment to different paths.
  // Precedence: inline/shell env var > .env[.mode] file > default '/'.
  // dev default: /
  // deploy build: VITE_APP_BASE_PATH=/xm-player/ npm run build (or .env.production)
  const base = process.env.VITE_APP_BASE_PATH || env.VITE_APP_BASE_PATH || '/'
  const storageApiUrl = process.env.VITE_STORAGE_API_URL || env.VITE_STORAGE_API_URL || 'http://localhost:8000'
  const storageProxyTarget = (() => {
    try {
      return new URL(storageApiUrl).origin
    } catch {
      return storageApiUrl
    }
  })()
  
  return {
    base,
    plugins: [react()],
    server: {
      // The CodeQL scanner leaves behind a self-referential symlink
      // (_codeql_detected_source_root → .) which causes Vite's chokidar FSWatcher
      // to recurse infinitely and crash with ELOOP.  Turning off symlink-following
      // and adding an explicit ignore pattern both guard against this.
      watch: {
        followSymlinks: false,
        ignored: ['**/_codeql_detected_source_root**', '**/node_modules/**'],
      },
      headers: {
        // Required for SharedArrayBuffer / Atomics (Emscripten WASM Workers)
        'Cross-Origin-Opener-Policy': 'same-origin',
        // 'credentialless' still unlocks SharedArrayBuffer but lets cross-origin
        // resources (e.g. the CDN-hosted libopenmpt) load without a
        // Cross-Origin-Resource-Policy header.  'require-corp' would block them.
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      proxy: {
        '/api': {
          target: storageProxyTarget,
          changeOrigin: true,
          secure: false,
        },
        '/songs': {
          target: storageProxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    optimizeDeps: {
      // Don't pre-bundle the Emscripten-generated glue code
      exclude: ['openmpt-native'],
    },
    assetsInclude: ['**/*.wasm'],
  }
})
