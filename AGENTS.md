# AGENTS.md

## Project Overview
**mod-player** (package name `react-libopenmpt-viewer`) is a browser-based MOD/tracker music player that combines retro audio emulation with modern graphics. It plays tracker module files (.mod, .xm, .s3m, .it, etc.) using `libopenmpt` compiled to WebAssembly, and renders real-time pattern visualizations via WebGPU WGSL shaders. The app also includes a 3D studio mode (React Three Fiber), a media overlay for images/video, and PWA support.

## Technology Stack
- **Frontend:** React 18 (TypeScript 5.4), JSX via `react-jsx`
- **Bundler / Dev Server:** Vite 5
- **Styling:** Tailwind CSS 3.3 + PostCSS + Autoprefixer, with custom scrollbars and a five-theme CSS variable system in `index.css`
- **3D Graphics:** `@react-three/fiber` + `@react-three/drei` + `three`
- **Visualization:** WebGPU (WGSL shaders) primary; **WebGL2** GLSL reference renderer (`src/renderers/webgl2/`) and **HTML** fallback
- **Audio Backend:** `libopenmpt` (WASM) inside a customized AudioWorklet
- **Native Audio Engine:** C++17 → Emscripten (`scripts/build-wasm.sh` / `npm run build:emcc` only; outputs `openmpt-native.*`)
- **Module System:** ES modules (`"type": "module"` in `package.json`)

## Key Configuration Files
- **`package.json`** — Defines scripts (`dev`, `build`, `typecheck`, `lint`, `preview`, `build:worklet`, `build:emcc`), dependencies, and `"type": "module"`.
- **`tsconfig.json`** — High strictness. Excludes `archive/`, `jules_patch` (not production).
- **`tsconfig.node.json`** — Composite project reference for `vite.config.ts`.
- **`vite.config.ts`** — Base path from `VITE_APP_BASE_PATH`; React plugin; COOP/COEP headers (`same-origin` / `credentialless`); `watch.followSymlinks: false` (guards against CodeQL self-referential symlink); `optimizeDeps.exclude: ['openmpt-native']`; `assetsInclude: ['**/*.wasm']`.
- **`tailwind.config.js`** — Explicit `content` paths only (no broad globs) to prevent build OOM. Custom theme extensions for `panel`, `edge`, `accent`, `glow`, `borderColor`, and `boxShadow`.
- **`postcss.config.js`** — TailwindCSS + Autoprefixer.
- **`eslint.config.js`** — Ignores `dist`, `public`, `vendor`, `archive`, `node_modules`, `jules_patch`, `subdir`, `scripts`, `cpp`. CI: `npm run lint` (max 100 warnings).
- **`package-lock.json`** — Committed for reproducible installs. CI uses `npm ci`.

## Audio Architecture (Three Tiers + Fallback)
The audio logic is split across the **Main Thread** and the **Audio Worklet Thread**, with an optional high-performance native C++ worklet.

### 1. Main Thread
Managed by `hooks/useLibOpenMPT.ts`. Responsibilities:
- Initialize `libopenmpt` (loaded from CDN in `index.html` via `window.libopenmptReady`)
- Load module files, extract pattern matrices (`utils/patternExtractor.ts`)
- Maintain React UI state (play/pause, volume, pan, loop, seek position)
- Send commands to the worklet via `port.postMessage()`
- Read high-frequency playback data via a mutable ref (`playbackStateRef`) to avoid 60 Hz re-renders

### 2. JS AudioWorklet Engine
Files: `public/worklets/openmpt-worklet.js` + `libopenmpt-audioworklet.js` (tracked in git)
- Processor is an `AudioWorkletProcessor` loaded via `audioWorklet.addModule()` (cache-busted `?v=` from `useWorkletLoader.ts`).
- Main thread fetches `libopenmpt-audioworklet.js` and posts `{ type: 'initLib', scriptText }` into the worklet; the worklet evaluates it with `new Function` (classic scripts cannot `import()` / `importScripts()`).
- **`libopenmpt-audioworklet.js` is wasm2js** (~5 MB): the runtime is embedded in JS. There is **no** sibling `libopenmpt.wasm` on this path. Do not re-add a fake/HTML `.wasm`.
- Runs the `libopenmpt` render loop, reports position (~60 Hz) back to the main thread, and handles seek/load messages.
- **Rule:** You cannot use React state or DOM APIs inside the worklet. Communication is strictly via `port.postMessage()`.
- **Hygiene:** `npm run verify:wasm` fails CI if any `public/**/*.wasm` or `dist/**/*.wasm` is HTML/tiny/missing `\0asm` magic. See `public/worklets/README.md`.

### 3. Native C++/Wasm AudioWorklet Engine (Optional)
Files: `audio-worklet/OpenMPTWorkletEngine.ts`, `cpp/openmpt_wrapper.cpp`, `cpp/worklet_processor.cpp`
- Built with `scripts/build-wasm.sh` (requires Emscripten SDK).
- Emscripten flags: `-sAUDIO_WORKLET=1`, `-sWASM_WORKERS=1`, `-sMODULARIZE=1`, `-sEXPORT_NAME=createOpenMPTModule`.
- Outputs: `public/worklets/openmpt-native.js`, `.wasm`, `.aw.js` (these are `.gitignore`d until built).
- `useLibOpenMPT.ts` probes for `openmpt-native.js` at startup; if present, it instantiates `OpenMPTWorkletEngine`, which creates its own `AudioContext` + worklet thread in C++ land.
- The native engine polls a shared-memory `PositionInfo` struct for row/BPM/channel VU data.

### Fallback Path
If the JS AudioWorklet fails to initialize WASM, `hooks/useAudioGraph.ts` falls back to a `ScriptProcessorNode` on the main thread (deprecated but functional). This is triggered by the worklet posting an `error` message.

## WebGPU & Shaders
- **Language:** WGSL (WebGPU Shading Language).
- **Location:** Source shaders live in `/shaders`. There are 50+ versioned files (e.g., `patternv0.50.wgsl`, `chassisv0.40.wgsl`). Served copies must also exist in `/public/shaders`.
- **Includes:** Source shaders can compose shared logic via `//#include "lib/<fragment>.wgsl"` directives (tolerated as WGSL comments). `npm run sync:shaders` expands these recursively into flat, self-contained output in `/public/shaders`. Shared fragments live in `/shaders/lib/` and are excluded from the public copy. Never hand-edit `/public/shaders/`.
  - **Canonical libs:** `packing.wgsl` (TRIG-001 / PackedA/B), `emitters.wgsl` (three-emitter lens), `polar_layout.wgsl` (ring geometry), `night_theme.wgsl` + `theme_night_5x.wgsl` (palettes). Night circular variants **v0.52–v0.54** are theme-only entries over `circular_night_body.wgsl`.
  - **Verify:** `npm run test:shader-includes`
- **Shader Groups (in `App.tsx`):**
  - **Square:** v0.44, v0.43, v0.40, v0.39, v0.21
  - **Circular:** v0.50, v0.49, v0.48, v0.47, v0.46, v0.45, v0.45b, v0.42, v0.38, v0.35_bloom, v0.30
  - **Video:** v0.23 (Clouds), v0.24 (Tunnel)
- **Pipeline:** Shaders are fetched as raw text strings (often via `fetch()` or bundled strings) and passed into the WebGPU render pipeline in components like `PatternDisplay.tsx` and `Studio3D.tsx`.
- **Bloom:** Post-processing bloom passes live in `utils/bloomPostProcessor.ts`; presets are defined in `types/bloomPresets.ts`.
- **Compatibility:** Three-tier renderer chain: WebGPU → WebGL2 → HTML. Select with `?renderer=webgpu|webgl2|html`, debug panel, or `window.DEBUG_RENDERER`. HTML fallback: `src/renderers/html/PatternHTMLFallback.tsx` (wraps `PatternSequencer.tsx`).
- **Agent/CI:** `window.currentPatternRenderer` exposes `readPixels()`, `setDebugMode()`, `getCanvas()` on WebGL2/HTML backends.
- **Critical Coupling:** Shaders are not pure assets. `PatternDisplay.tsx` parses the shader **filename** (e.g., `patternv0.37.wgsl`) to determine layout type, buffer packing strategy, canvas size, and whether shader-embedded UI controls exist. Changing a shader's uniform struct requires a matching update to `createUniformPayload()` in TypeScript.

## Data Packing for GPU
Tracker cells are bit-packed into `Uint32Array` before upload to the GPU:
- **Standard:** `[Note(8) | Instr(8) | VolCmd(8) | VolVal(8)]` in one `u32`
- **High-precision (v0.36+):**
  - `PackedA`: `[Note(8) | Instr(8) | VolCmd(8) | VolVal(8)]`
  - `PackedB`: `[Unused(16) | EffCmd(8) | EffVal(8)]`

**Critical:** If you modify how data is packed in TypeScript, you **must** update the corresponding bit-shifting logic in the WGSL shaders.

## Directory Map
- **`/components`** – React UI elements (`App.tsx`, `PatternDisplay.tsx`, `Controls.tsx`, `Studio3D.tsx`, `MediaOverlay.tsx`, `ChannelMeters.tsx`, `PatternSequencer.tsx`, `Playlist.tsx`, `SeekBar.tsx`, etc.)
- **`/src/renderers`** – Pattern renderer selection + WebGL2 reference implementation + HTML fallback wrapper
- **`/hooks`** – Core logic hooks
  - `useLibOpenMPT.ts` – Main audio bridge and state
  - `useAudioGraph.ts` – Audio graph construction and playback start
  - `useWorkletLoader.ts` – AudioWorklet module loading with retry/diagnostics
  - `usePlaylist.ts`, `useKeyboardShortcuts.ts`, `useWebGPURender.ts`, `useWebGLOverlay.ts`, `useLocalStorage.ts`
- **`/audio-worklet`** – TypeScript wrapper for the native C++ engine (`OpenMPTWorkletEngine.ts`, `types.ts`, `diagnostics.ts`)
- **`/cpp`** – C++ source for the native worklet (`openmpt_wrapper.cpp`, `openmpt_wrapper.h`, `worklet_processor.cpp`, `pre.js`)
- **`/public/worklets`** – AudioWorklet JS processors served as static assets
  - `openmpt-worklet.js` – JS worklet processor (tracked in git)
  - `libopenmpt-audioworklet.js` – WASM glue for the JS worklet
  - `openmpt-native.js` / `.wasm` / `.aw.js` – Generated by Emscripten (ignored in git)
- **`/shaders`** – WGSL shader source files (50+ versioned files)
- **`/shaders-enhanced`** – Additional experimental WGSL shaders (`audio-viz.wgsl`, `bloom.wgsl`, `pattern-vfx.wgsl`)
- **`/utils`** – `patternExtractor.ts`, `bloomPostProcessor.ts`, `remoteMedia.ts`, `colorSchemes.ts`, `gpuPacking.ts`, `geometryConstants.ts`, `shaderVersion.ts`, `cn.ts`, plus `__debug__/packingInvariants.test.cjs`
- **`/types`** – Shared TS types, including `types.ts` (core interfaces) and `bloomPresets.ts`
- **`/src`** – Supplementary code
  - `src/lib/paths.ts` – Path helpers
  - `src/utils/shaderHelpers.ts` – Shader utility functions
  - `src/shaders/polar_chassis.wgsl` – Polar chassis shader
- **`/docs`** – Technical guides (`BLOOM.md`, `planning/`, `agent-swarm/`)
- **`/scripts`** – `build-wasm.sh`, `benchmark_loadFromURL.cjs`, `make_bezel_transparent.py`, `smoke-test-webgpu.mjs`, `verify-packing.mts`
- **`/shaders-enhanced`** – Experimental WGSL prototypes (promote via `shaderRegistry.ts` when ready)
- **`/archive`** – Demoted experiments; not imported by the app (see `docs/REPO_LAYOUT.md`)
- **`/dist`** – Vite production build output (deployment artifact)

## Build, Dev, Test & Deploy Commands

### Development
```bash
npm ci             # preferred: clean install from package-lock.json
# or: npm install  # updates lockfile when package.json changes
npm run dev        # Vite dev server (needs WebGPU-enabled browser, e.g., Chrome/Edge/Arc)
```

### Build
```bash
npm run build           # tsc && vite build (uses 4GB max-old-space-size)
npm run typecheck       # tsc --noEmit
npm run lint            # eslint . --max-warnings 100 (hard CI gate)
npm run preview         # Preview the production build locally
```

### package-lock.json (reproducible installs)
`package-lock.json` is **committed** and used by CI via `npm ci`.

| Task | Command |
|------|---------|
| Clean install (CI / local parity) | `npm ci` |
| After changing `package.json` deps | `npm install` (rewrites lockfile) then commit both |
| Force regenerate lockfile | `rm -rf node_modules package-lock.json && npm install` then commit `package-lock.json` |

Do **not** add `package-lock.json` to `.gitignore`.

### Native Audio Engine Build (single supported path)
Requires Emscripten **emsdk 3.1.50** (CI pin; override with `EMSDK_PIN` only for experiments):

```bash
# Install pin (once)
git clone https://github.com/emscripten-core/emsdk.git && cd emsdk
./emsdk install 3.1.50 && ./emsdk activate 3.1.50
source ./emsdk_env.sh

# From repo root — only supported native build:
npm run build:emcc
# equivalent: bash scripts/build-wasm.sh [--debug] [--safe-heap]
# npm run build:worklet  → same script (deprecated alias name)
```

| Output (gitignored) | Role |
|---------------------|------|
| `public/worklets/openmpt-native.js` | Emscripten modular glue (`createOpenMPTModule`) |
| `public/worklets/openmpt-native.wasm` | WASM binary |
| `public/worklets/openmpt-native.aw.js` | AudioWorklet bootstrap |

**Never** overwrites tracked `public/worklets/openmpt-worklet.js` (JS processor).  
Root `./build-wasm.sh` is a deprecated alias that only forwards to `scripts/build-wasm.sh`.  
Export audit: `npm run verify:native-exports`.

### Deployment
```bash
python3 deploy.py
```
- Builds the project with `VITE_APP_BASE_PATH` automatically derived from the `REMOTE_DIRECTORY` variable inside `deploy.py`.
- SFTP-uploads the `dist/` folder to the configured remote server.
- For manual subdirectory deployment: `VITE_APP_BASE_PATH=/xm-player/ npm run build`

## Code Style & Conventions
- **TypeScript strictness is high:** `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- **File naming:** PascalCase for components (`PatternDisplay.tsx`), camelCase for hooks/utilities (`useLibOpenMPT.ts`, `patternExtractor.ts`).
- **Tailwind content paths are explicit** (not a broad `**/*` glob) to avoid build OOMs caused by `node_modules` matches.
- **Fix comments:** The codebase prefixes engineering fixes with identifiers like `AUDIO-001 FIX` and `TIMING FIX`.
- **Base URL awareness:** Almost all asset URLs are constructed with `import.meta.env.BASE_URL` so the app works when deployed under a subdirectory.
- **React patterns:** Functional components with hooks only; no class components. State for UI logic; mutable refs for high-frequency audio data. Props are preferred over context except for deeply nested state.
- **ESLint:** Configured in `eslint.config.js` (typescript-eslint + react-hooks + react-refresh). `npm run lint` runs `eslint . --max-warnings 100` and is a **hard CI gate**. Remaining warnings are tracked for a follow-up cleanup PR (ratchet the budget down over time).

## Testing
- **No formal unit-test framework** is currently installed (no Jest/Vitest/Playwright tests in `package.json`).
- **Debug invariant test:** `utils/__debug__/packingInvariants.test.cjs` contains a Node.js script that tests GPU packing logic for buffer-size mismatches.
- **Shader renderer screenshot check:** `scripts/screenshot-shader-check.mjs` captures the pattern visualizer for each renderer (`webgl2`, `html`, optionally `webgpu`) and a configurable list of shaders. Run it against a local preview with:
  ```bash
  npm run preview -- --port 4173 &
  npm run screenshot:shaders
  ```
  Outputs are written to `/mnt/ramdisk/mod-player-screenshots` by default, including `report.json` and `SCREENSHOT_REPORT.md`.
- **GitHub Actions** (`.github/workflows/ci.yml`) runs two jobs:
  1. `lint-and-build` – `npm ci` → `npm run lint` (hard fail) → `npm run typecheck` → `npm run build` → verifies `dist/index.html` and `dist/assets` exist.
  2. `wasm-smoke-test` – Installs Emscripten **3.1.50**, verifies safe native build scripts, `verify:native-exports`, `bash -n`, and that tracked `openmpt-worklet.js` still looks like the JS processor.
  3. `native-wasm-scheduled.yml` – Weekly (and manual) full `npm run build:emcc`; uploads `openmpt-native.*` artifacts and asserts the JS worklet is unchanged.

## Security & CORS Considerations
- **COOP/COEP headers:** `vite.config.ts` sets:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: credentialless`
  - This unlocks `SharedArrayBuffer` / Atomics for Emscripten WASM workers while still allowing cross-origin CDN resources (e.g., the esm.sh React importmap and the libopenmpt script).
- **CORS:** Loading MOD files or WASM from external URLs can trigger CORS errors. `utils/remoteMedia.ts` handles remote fetching; ensure servers send proper CORS headers.
- **Service Worker:** `public/sw.js` is scope-aware and works under any base path. It caches module files (`.mod`, `.xm`, `.s3m`, `.it`, `.mptm`, `.wasm`) with a cache-first strategy. SW registration only happens in production builds (`import.meta.env.PROD`).
- **PWA:** `public/manifest.json` and `sw.js` provide installability.

## Common Pitfalls
1. **Worklet Caching:** Browsers cache AudioWorklet files aggressively. If you edit `openmpt-worklet.js` or any worklet asset, hard-refresh or disable cache in DevTools.
2. **Shader Imports:** If you rename a shader file in `/shaders`, you **must** update the reference in `App.tsx` (the `SHADER_GROUPS` constant) and in any component that fetches the file by name (e.g., `PatternDisplay.tsx`). WGSL files must also be kept in sync between `/shaders` (source) and `/public/shaders` (served).
3. **Base Path Mismatch:** Deploying to a subdirectory without setting `VITE_APP_BASE_PATH` will break shader fetches, worklet loads, and the default module fetch. Use `deploy.py` or set the env var manually before building.
4. **Missing Native Engine:** `openmpt-native.js` does not exist in the repo by default. Run `npm run build:emcc` after activating emsdk **3.1.50**.
5. **Node OOM during build:** The Tailwind config was intentionally narrowed to explicit paths. Do not broaden the `content` glob to `"./**/*.{js,ts,jsx,tsx}"` or production builds may run out of heap memory.
6. **Native vs JS worklet names:** Native glue is always `openmpt-native.*`. The tracked production processor is `openmpt-worklet.js`. Both `npm run build:emcc` and `npm run build:worklet` call `scripts/build-wasm.sh` and refuse to clobber the JS processor.
7. **Shader-Uniform coupling:** Shaders are tightly coupled to TypeScript host code. Changing a shader's `struct Uniforms` requires a matching change to `createUniformPayload()` in `PatternDisplay.tsx`. Adding a new shader often requires manually updating version checks in `PatternDisplay.tsx` for layout, packing, canvas size, and input handling.
8. **Symlink watcher infinite loop:** The CodeQL scanner leaves a self-referential symlink (`_codeql_detected_source_root` → `.`). The Vite config mitigates this with `watch.followSymlinks: false`. Do not remove this setting.

## Cursor Cloud specific instructions
This is a **frontend-only** app; there is no backend to run for local dev. `libopenmpt` is self-hosted under `public/libmpt/` and sample modules (`4-mat_madness.mod`, `test.xm`, `libopenmpt-test.mod`) ship in `public/`, so the player works fully offline with no CDN or storage API. `VITE_STORAGE_API_URL` (proxied `/api`, `/songs`) is optional and only needed for the remote song browser.
- **Run/build/test/lint:** use the standard scripts in `package.json` (`npm run dev` → Vite on `http://localhost:5173`, `npm run build`, `npm test` (Vitest, 50 tests), `npm run typecheck`, `npm run lint`). See README/AGENTS build sections above.
- **Base path:** default dev and `npm run build` use site root (`VITE_APP_BASE_PATH=/` in `.env.development` / `.env.production`). The live deploy at `test.1ink.us/xm-player/` uses `npm run build:xm-player` which bakes `/xm-player/` into asset URLs. If you see 404s for `/xm-player/assets/*` or `libopenmptjs.js` while testing at root, you built with the xm-player profile — use `npm run dev` or a root-base `npm run build` instead.
- **Browser testing without WebGPU:** the cloud VM's Chrome has no WebGPU by default. Append `?renderer=webgl2` (or `?renderer=html`) to the dev URL to use the fallback renderers; the app otherwise tries WebGPU first and may show a blank visualizer. Audio playback requires a user gesture (click Play).
- **Hello-world check:** open `http://localhost:5173/?renderer=webgl2`, wait for the default module `4-mat_madness.mod` to auto-load, click Play, and confirm the position/order/row counters advance and the visualizer animates.
