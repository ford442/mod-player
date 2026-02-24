
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/xm-player/',
  plugins: [react()],
  server: {
    headers: {
      // Required for SharedArrayBuffer (Emscripten AUDIO_WORKLET=1)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    // Don't pre-bundle the Emscripten-generated glue code
    exclude: ['openmpt-native'],
  },
  assetsInclude: ['**/*.wasm'],
})
