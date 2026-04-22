# Copilot Instructions for mod-player

This document guides AI assistants working on the mod-player repository. For deeper architectural rationale, refer to `CLAUDE.md` and `DEVELOPER_CONTEXT.md`.

---

## Build, Test, and Lint Commands

### Development
```bash
npm install                    # Install dependencies (required before any other command)
npm run dev                    # Start Vite dev server at http://localhost:5173
npm run typecheck              # Type-check only (no emit); faster than build
npm run build                  # Full production build (uses --max-old-space-size=4096)
npm run preview                # Serve the production build locally for testing
npm run lint                   # ESLint (currently a no-op: `exit 0`)
```

### WASM Audio Worklet Build (Optional)
```bash
npm run build:worklet          # Build via ./build-wasm.sh
npm run build:emcc             # Build via scripts/build-wasm.sh
```
**Prerequisite:** Emscripten SDK 4.0+ activated in your shell. The scripts auto-clone and build libopenmpt from GitHub if needed.

### Deployment
```bash
VITE_APP_BASE_PATH=/xm-player/ npm run build    # Build for subdirectory hosting
python3 deploy.py                                # Build + SFTP upload to production
```

### Browser Requirements
- **WebGPU visualization:** Chrome 113+, Edge 113+, or Arc
- **Headless testing:** Pass `--enable-unsafe-webgpu` flag
- **Fallback:** HTML pattern grid works in any modern browser if WebGPU is unavailable

---

## High-Level Architecture

### Core Purpose
**mod-player** is a browser-based audio tracker module player (MOD, XM, S3M, IT) with a hardware-accelerated WebGPU visualization engine. It emulates a retro-futuristic device interface.

### The Four Tiers of Audio-Visual Processing

#### 1. Main Thread (`hooks/useLibOpenMPT.ts`)
- Initializes libopenmpt WASM from CDN (`window.libopenmptReady` promise set in `index.html`)
- Loads module files into WASM memory
- Manages React state (play/pause, volume, pan, loop, seek)
- Creates `AudioContext` and instantiates either `AudioWorkletNode` (preferred) or `ScriptProcessorNode` (fallback)
- Sends control messages to worklet via `port.postMessage()`
- Reads playback state via mutable refs (`channelStatesRef`) to avoid 60 Hz re-render floods

#### 2. Audio Worklet Thread (`public/worklets/openmpt-worklet.js`)
- Runs the libopenmpt render loop at audio sample rate (44.1 kHz)
- Sends position + VU data back to main thread every ~16 ms (60 fps)
- **Critical rule:** No React state, no DOM APIs. All communication via `port.postMessage()`

#### 3. WebGPU Renderer (`components/PatternDisplay.tsx`)
- Initializes WebGPU context on a canvas
- Dynamically loads WGSL shader files from `/shaders` directory
- Parses shader filename (e.g., `patternv0.37.wgsl`) to determine rendering strategy:
  - **Layout:** simple, horizontal, or circular
  - **Buffer strategy:** standard 1×u32 or high-precision 2×u32 packing
  - **Canvas size:** version-specific (v0.26 → 2048×2016, v0.37 → 1024×1024)
  - **UI mode:** v0.37+ includes shader-embedded UI controls with polar coordinate hit-testing
- Runs a render loop with up to two passes: Background (chassis) → Pattern (data)
- Falls back to HTML grid if WebGPU is unavailable

#### 4. Media Overlay (`components/MediaOverlay.tsx`)
- Displays images, GIFs, and videos synchronized to playback
- Managed via state in `App.tsx`

### Data Flow: Module Load → Playback → Visualization
```
User drops .mod file
  → App.tsx calls loadModule() on useLibOpenMPT
  → WASM parses module, allocates memory
  → AudioContext + Worklet initialized
  → Main thread polling loop reads row/channel state
  → React sequencerMatrix state updated
  → PatternDisplay packs data → writes GPU buffers → draw call
```

### Shader Versioning (Critical)
Shaders are named `patternv0.XX.wgsl` and `chassisv0.XX.wgsl`. The version number in the filename **controls multiple behaviors** detected at runtime by parsing the string:

| Version Range | Layout Type | Buffer Strategy | Canvas Size | Notes |
|---|---|---|---|---|
| `< v0.13` | Simple | Standard 1×u32 | Default | Legacy |
| `v0.13+` | Extended | 2×u32 per cell | Default | Extended layout |
| `v0.25`, `v0.26` | Circular | Extended | 2048×2016 | Large circular |
| `v0.35`, `v0.37`, `v0.38` | Circular | High-precision | 1024×1024 | Hybrid UI |
| `v0.45–v0.50` | Circular | High-precision | — | Alpha blending enabled |

**DO NOT refactor the `if (shaderFile.includes('v0.XX'))` chains in `PatternDisplay.tsx`** — they are load-bearing. When adding a new shader, update the corresponding version checks in `PatternDisplay.tsx`.

### Data Packing for GPU
Tracker cells are bit-packed into `Uint32Array` before upload:

- **Standard:** `[Note(8) | Instr(8) | VolCmd(8) | VolVal(8)]` in one `u32`
- **High-precision (v0.36+):**
  - `PackedA`: `[Note(8) | Instr(8) | VolCmd(8) | VolVal(8)]`
  - `PackedB`: `[Unused(16) | EffCmd(8) | EffVal(8)]`

**Critical:** If you change data packing in TypeScript, you **MUST** update bit-shifting logic in corresponding WGSL shaders.

---

## Key Conventions

### File Naming
- **React components:** PascalCase (`.tsx`): `PatternDisplay.tsx`, `Controls.tsx`
- **Hooks:** camelCase (`.ts`): `useLibOpenMPT.ts`, `useKeyboardShortcuts.ts`
- **Utilities:** camelCase (`.ts`): `patternExtractor.ts`, `bloomPostProcessor.ts`

### TypeScript Strictness
All strict flags are enabled (see `tsconfig.json`):
- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`

**No loosening allowed without justification.**

### React Patterns
- Functional components with hooks only; no class components
- State for UI logic; mutable refs for high-frequency audio data (channel states)
- Props are preferred over context except for deeply nested state

### Tailwind CSS
- Use utility classes only; avoid custom CSS unless Tailwind cannot express it
- **Critical:** `tailwind.config.js` has explicit content paths to avoid OOM during builds. Do not add broad glob patterns like `"./**/*.{js,ts,jsx,tsx}"`.

### Styling & CSS
- Custom scrollbars and device bezel styling live in `index.css`
- Shader-embedded UI uses polar coordinate hit-testing for interactions

### CORS & Security
`vite.config.ts` sets:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

These enable `SharedArrayBuffer` / Atomics for Emscripten WASM workers while allowing cross-origin CDN resources (e.g., libopenmpt). **Do not remove these headers.**

### Asset Caching Gotchas
- **AudioWorklet files** are cached aggressively. After editing `public/worklets/openmpt-worklet.js`, hard-refresh or disable cache in DevTools.
- **Shader files** must exist in both `/shaders` (source) and `/public/shaders` (served). Keep them in sync. Vite copies `public/` to `dist/`.
- **libopenmpt:** Loaded from CDN (`https://wasm.noahcohn.com/libmpt/`) in `index.html`. The app waits on `window.libopenmptReady` promise before starting audio.

### Base Path Awareness
Almost all asset URLs use `import.meta.env.BASE_URL` to support deployment under a subdirectory. When deploying to a non-root path, set `VITE_APP_BASE_PATH` before building.

### Vite Configuration Special Notes
- `watch.followSymlinks: false` — Guards against CodeQL's self-referential symlink (`_codeql_detected_source_root`) causing infinite recursion and ELOOP crash.
- `assetsInclude: ['**/*.wasm']` — Ensures `.wasm` files are included as Vite assets.
- `optimizeDeps.exclude: ['openmpt-native']` — Prevents pre-bundling of Emscripten glue code.

---

## Architecture: Shader-Uniform Coupling

**Shaders are NOT pure assets** — they are tightly coupled to TypeScript host code.

### Pattern: Shader-Driven Rendering Strategy
1. `PatternDisplay.tsx` receives `shaderFile` prop (e.g., `patternv0.37.wgsl`)
2. Filename is parsed to extract version number
3. Version number triggers version-specific checks:
   ```typescript
   if (shaderFile.includes('v0.37')) {
     // Use high-precision 2×u32 packing
     // Expect polar-coordinate UI zone definitions
     // Set canvas size to 1024×1024
     // Enable shader-embedded UI input handling
   }
   ```
4. Correct uniform struct is sent via `createUniformPayload()`
5. Correct GPU buffers (layout, packing strategy) are allocated

**When modifying a shader's `struct Uniforms`:**
1. Update `createUniformPayload()` in `PatternDisplay.tsx` to match
2. Test with `npm run dev` to ensure no garbage/corruption on screen
3. Verify in production build via `npm run build && npm run preview`

---

## Common Pitfalls & Warnings

### 1. Worklet Caching
Browsers cache AudioWorklet files aggressively. After editing `openmpt-worklet.js`, always hard-refresh (Ctrl+Shift+R) or disable cache in DevTools.

### 2. Shader Drift
Pattern WGSL files must exist in both `/shaders` (source) and `/public/shaders` (served). If you add a new shader, copy it to both locations.

### 3. Base Path Mismatch
Deploying to a subdirectory without setting `VITE_APP_BASE_PATH` breaks shader fetches, worklet loads, and default module fetch. Use `deploy.py` or set the env var manually before building.

### 4. Tailwind Content Paths
Do not broaden the `content` glob in `tailwind.config.js`. The explicit scoping prevents OOM crashes during production builds by excluding `node_modules`.

### 5. Node OOM During Build
The production build uses `--max-old-space-size=4096` (see `package.json`). If you hit OOM anyway, check `tailwind.config.js` — a broad glob pattern likely matched too many files.

### 6. libopenmpt CDN Load
`libopenmptjs.js` must load from `https://wasm.noahcohn.com/libmpt/` in `index.html`. If offline, host it locally and update the script src. The app waits on `window.libopenmptReady` before starting.

### 7. ScriptProcessorNode vs. AudioWorkletNode
When debugging audio glitches, determine which path is active. The messaging structure differs:
- **AudioWorkletNode:** Preferred, modern, smoother performance
- **ScriptProcessorNode:** Deprecated fallback, used if worklet fails to initialize WASM

Check `useLibOpenMPT.ts` for the fallback logic in `hooks/useAudioGraph.ts`.

### 8. Race Conditions in Audio-Visual Sync
`channelStatesRef` is a double-buffered mutable ref. **Do not replace it with React state** — it will cause jank from 60 Hz audio data updates. Use refs for high-frequency data.

### 9. Symlink Watcher Infinite Loop
The CodeQL scanner leaves a self-referential symlink. The Vite config mitigates this with `watch.followSymlinks: false`. Do not remove this setting.

### 10. Video Looping Not Smooth
HTML5 native loop wasn't smooth enough for the aesthetic. `PatternDisplay.tsx` uses manual `requestAnimationFrame` loops for "ping-pong" video playback. This is intentional.

---

## Key Files Quick Reference

| File | Purpose |
|---|---|
| `App.tsx` | Root React component; orchestrates all state and layout |
| `hooks/useLibOpenMPT.ts` | **PRIMARY AUDIO HOOK** — WASM init, playback, channel state |
| `components/PatternDisplay.tsx` | **PRIMARY VISUALIZATION** — WebGPU pipeline, shaders, render loop |
| `components/Controls.tsx` | File upload, play/stop, volume/pan sliders |
| `components/PatternSequencer.tsx` | HTML fallback grid (no WebGPU) |
| `components/MediaOverlay.tsx` | Image/video sync layer |
| `components/ChannelMeters.tsx` | Real-time per-channel VU meters |
| `types.ts` | Core interfaces: `PatternCell`, `ChannelShadowState`, `ModuleMetadata` |
| `utils/geometryConstants.ts` | Canvas layout, polar rings, layout detection |
| `utils/bloomPostProcessor.ts` | WebGPU bloom post-processing |
| `public/worklets/openmpt-worklet.js` | AudioWorklet processor (static asset) |
| `index.html` | Entry point; loads libopenmpt from CDN |
| `vite.config.ts` | CORS headers, WASM assets, symlink handling |
| `tailwind.config.js` | Scoped content paths (explicit, not broad globs) |

---

## Testing & Verification

### Manual Testing Checklist
- [ ] `npm run dev` starts without errors
- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds (production build)
- [ ] `npm run preview` loads without errors
- [ ] Load a .mod file and play; verify audio and visualization sync
- [ ] Toggle between shaders; verify no GPU errors
- [ ] Test on Chrome, Edge, or Arc (WebGPU requirement)

### GitHub Actions CI
- **Job 1 (lint-and-build):** Runs linting (soft fail), type-check, build, and verifies build artifacts
- **Job 2 (wasm-smoke-test):** Checks build script syntax (full WASM build skipped to save time)

---

## Deployment

### Local Preview
```bash
npm run build
npm run preview
```

### Production Deployment
```bash
# Option 1: Via deploy.py (recommended)
python3 deploy.py

# Option 2: Manual build for subdirectory
VITE_APP_BASE_PATH=/xm-player/ npm run build
# Then upload dist/ to your server
```

The `deploy.py` script automatically derives the base path and handles SFTP upload.

---

## Module Load Failures & Debugging

### Common Issues
1. **"Failed to load libopenmpt script from CDN"** — Check internet connection; libopenmpt CDN may be down
2. **CORS errors loading media files** — Remote server must send proper CORS headers
3. **WebGPU device lost** — GPU driver crash; refresh the page or update drivers
4. **Shader syntax error** — Check WGSL shader file for typos; use `npm run dev` to see GPU errors in console

### Debug Helpers
- Open DevTools → Console; check for error messages from `libopenmpt`, worklet, or WebGPU
- `PatternDisplay.tsx` logs shader version info and uniforms payload
- `useLibOpenMPT.ts` logs audio state transitions

---

## Updating Dependencies

Run `npm install` after modifying `package.json`. The project uses:
- **React 18** (not 19+, for stability)
- **TypeScript 5.4** (strict mode)
- **Vite 5** (build tooling)
- **Tailwind 3.3** (styling)
- **Three.js + React-Three-Fiber** (optional 3D mode)

Test the full build after upgrading major versions (`npm run build`).

---

## MCP Servers

This project integrates with **Playwright** and **Node.js** MCP servers for enhanced development capabilities:

### Playwright MCP
- **Purpose:** Browser automation and end-to-end testing
- **Use cases:** 
  - Verify WebGPU rendering and shader correctness
  - Test module loading and playback
  - Screenshot comparisons across browsers
  - Test with `--enable-unsafe-webgpu` flag for headless Chrome
- **Configuration:** Add to Copilot cloud agent or local MCP setup

### Node.js MCP
- **Purpose:** Execute build scripts, run npm commands, inspect the file system
- **Use cases:**
  - Run `npm run dev`, `npm run build`, `npm run typecheck` with full output
  - Execute Emscripten WASM builds (`npm run build:emcc`)
  - Test shader loading and asset bundling
  - Manipulate `.wasm` files or auto-generate shader references
- **Configuration:** Add to Copilot cloud agent or local MCP setup

---

## Questions or Unclear Architecture?

- **What does this component do?** Check the file header comment or component prop types.
- **How does audio sync to visuals?** Read `DEVELOPER_CONTEXT.md` § 4 (Audio-Visual Synchronization).
- **Why is there a shader version check?** See the **Shader Versioning** section above.
- **Can I refactor the if-chains?** No. They are load-bearing. Read `DEVELOPER_CONTEXT.md` § 3.A before attempting.
