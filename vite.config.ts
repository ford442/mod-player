
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/xm-player/',
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
  },
  optimizeDeps: {
    // Don't pre-bundle the Emscripten-generated glue code
    exclude: ['openmpt-native'],
  },
  assetsInclude: ['**/*.wasm'],
})
