# CLAUDE.md — AI Assistant Guide for mod-player (XASM-1 Player)

> **Read this file first.** It supersedes any other documentation for the purpose of making code changes.
> Refer to `DEVELOPER_CONTEXT.md` for deeper architectural rationale and `AGENTS.md` for additional directives.

---

## Project Overview

**XASM-1 Player** is a browser-based tracker module player (MOD, XM, S3M, IT) with a WebGPU-powered visualization engine. It is designed to look and feel like a retro-futuristic hardware device.

**Core technology stack:**
- **React 18 + TypeScript + Vite** — UI framework and build tooling
- **libopenmpt (WASM)** — Accurate tracker module audio playback, loaded from CDN
- **Web Audio API + AudioWorklet** — Audio rendering pipeline (ScriptProcessorNode fallback)
- **WebGPU + WGSL** — Hardware-accelerated visualization; falls back to an HTML grid view
- **Tailwind CSS** — Styling
- **Three.js / React-Three-Fiber** — Optional 3D visualization mode

---

## Directory Structure

```
mod-player/
├── App.tsx                      # Root React component; orchestrates all state
├── index.tsx                    # React entry point
├── index.html                   # HTML shell; loads libopenmpt from CDN
├── types.ts                     # Core TypeScript interfaces (PatternCell, ChannelShadowState, etc.)
│
├── hooks/
│   ├── useLibOpenMPT.ts         # PRIMARY AUDIO HOOK — WASM init, playback, channel state
│   ├── useKeyboardShortcuts.ts  # Keyboard event handling
│   └── usePlaylist.ts           # Playlist management
│
├── components/
│   ├── PatternDisplay.tsx       # PRIMARY VISUALIZATION — WebGPU context, shaders, render loop
│   ├── Controls.tsx             # File upload, play/stop, volume/pan sliders
│   ├── PatternSequencer.tsx     # HTML fallback pattern grid (no WebGPU)
│   ├── MediaOverlay.tsx         # Synchronized image/video overlay during playback
│   ├── MediaPanel.tsx           # Media file management UI
│   ├── ChannelMeters.tsx        # Real-time per-channel VU meters
│   ├── MetadataPanel.tsx        # Module metadata (title, artist, BPM, channels)
│   ├── Header.tsx               # Status bar
│   ├── SeekBar.tsx              # Playback position scrubber
│   ├── Playlist.tsx             # Playlist UI
│   ├── Studio3D.tsx             # Three.js 3D mode
│   ├── CameraRig.tsx            # 3D camera controller
│   └── Icons.tsx                # SVG icon definitions
│
├── audio-worklet/
│   ├── OpenMPTWorkletEngine.ts  # WASM engine wrapper for the worklet thread
│   └── types.ts                 # Worklet-specific types (WorkletPatternRow, EngineState, etc.)
│
├── utils/
│   ├── geometryConstants.ts     # Canvas layout constants, polar ring geometry, layout detection
│   ├── bloomPostProcessor.ts    # WebGPU multi-pass bloom effect
│   └── remoteMedia.ts           # Fetches/caches MOD files and media from remote servers
│
├── shaders/                     # WGSL source shaders (~56 files, e.g. patternv0.45.wgsl)
├── shaders-enhanced/            # Experimental enhanced shader variants
├── public/
│   ├── worklets/                # openmpt-processor.js — runs on Audio Worklet thread (static asset)
│   ├── shaders/                 # Public-served copies of shaders
│   └── utils/                   # Static utility scripts
│
├── vite.config.ts               # Vite config (base path, CORS headers, WASM assets)
├── tsconfig.json                # TypeScript config (strict, ES2020, ESNext modules)
├── tailwind.config.js           # Tailwind (scoped content paths to avoid OOM)
├── postcss.config.js
└── package.json
```

---

## Development Commands

```bash
npm run dev          # Start Vite dev server at http://localhost:5173
npm run build        # tsc + Vite production build → dist/ (uses 4 GB heap)
npm run preview      # Preview production build locally
npm run typecheck    # TypeScript type-check only (no emit)
npm run lint         # ESLint (max 50 warnings tolerance)
npm run build:worklet # Build WASM audio worklet via Emscripten (build-wasm.sh)
npm run build:emcc   # Alternative Emscripten build (scripts/build-wasm.sh)
python3 deploy.py    # Build + SFTP upload to production server
```

**Browser requirement:** WebGPU requires Chrome 113+, Edge 113+, or Arc. For headless testing pass `--enable-unsafe-webgpu`.

**Deployment env var:** `VITE_APP_BASE_PATH=/xm-player/ npm run build` for subdirectory hosting.

---

## Architecture: The Two Worlds

Audio logic is split strictly between two contexts that **cannot share state directly**.

### Main Thread (`hooks/useLibOpenMPT.ts`)
- Initializes libopenmpt WASM from CDN (`window.libopenmptReady` promise)
- Loads module files into WASM memory (`libopenmpt_module_create_from_memory2()`)
- Creates `AudioContext` and attempts to use `AudioWorkletNode`; falls back to `ScriptProcessorNode`
- Sends control messages to the worklet via `port.postMessage()`
- Reads current row/channel state from WASM, double-buffers via mutable refs (`channelStatesRef`) to avoid React re-render floods
- Performs drift detection and timing correction for audio-visual sync

### Worklet Thread (`public/worklets/openmpt-processor.js`)
- Runs the actual libopenmpt render loop at audio sample rate (44.1 kHz)
- Sends position + VU data back to the main thread every ~16 ms (60 fps)
- **Rule:** No React state, no DOM APIs inside the worklet. All communication is strictly via `port.postMessage()`.

---

## Architecture: WebGPU Visualization

### `PatternDisplay.tsx` — The Rendering Engine
This is the largest and most complex file. It:
1. Initializes a WebGPU context on a `<canvas>` element
2. Parses the **shader filename** to determine rendering strategy (see Shader Versioning below)
3. Allocates GPU buffers for pattern data and channel states
4. Runs a render loop with up to two passes:
   - **Pass 1 (Chassis/Background):** Renders the bezel/device chassis texture
   - **Pass 2 (Pattern):** Renders tracker data as a grid, spectrum, or circular display
5. Handles canvas mouse events via polar coordinate hit-testing (for shader-embedded UI)

### Data Packing for GPU
Tracker cell data is bit-packed into `Uint32Array` buffers before upload:

- **Standard packing:** `[Note(8) | Instr(8) | VolCmd(8) | VolVal(8)]` in one `u32`
- **High-precision (v0.36+) — `PackedA/PackedB` split:**
  - `PackedA`: `[Note(8) | Instr(8) | VolCmd(8) | VolVal(8)]`
  - `PackedB`: `[Unused(16) | EffCmd(8) | EffVal(8)]`

**If you change data packing in TypeScript, you MUST update the bit-shifting logic in the corresponding WGSL shader(s).**

---

## Critical: Shader Versioning Logic

> **DO NOT** refactor the `if (shaderFile.includes('v0.XX'))` chains in `PatternDisplay.tsx`. They are load-bearing.

Shaders are named `patternv0.XX.wgsl` and `chassisv0.XX.wgsl`. The version number controls multiple behaviors detected at runtime by parsing the filename string:

| Version Range | Layout Type | Buffer Strategy | Canvas Size | Notes |
|---|---|---|---|---|
| `< v0.13` | `simple` | Standard 1×u32 | Default | Legacy |
| `v0.13+` | `extended` | 2×u32 per cell | Default | Extended layout |
| `v0.25`, `v0.26` | Circular | Extended | 2048×2016 | Large circular |
| `v0.35`, `v0.37`, `v0.38` | Circular | High-precision | 1024×1024 | Hybrid shader UI |
| `v0.37` | Circular | High-precision | 1024×1024 | Embedded UI controls + polar hit-testing |
| `v0.39`, `v0.40`, `v0.42–v0.44` | Horizontal | High-precision | — | |
| `v0.45–v0.49` | Circular | High-precision | — | Alpha blending enabled |

**When adding a new shader:**
1. Choose a version number that doesn't conflict with existing ones
2. Add the appropriate `if (shaderFile.includes('vX.XX'))` checks in `PatternDisplay.tsx`
3. Ensure uniform structs in WGSL match exactly what `createUniformPayload` sends
4. Update `utils/geometryConstants.ts` `getLayoutModeFromShader()` if it uses a new layout

---

## Key Type Definitions (`types.ts`, `audio-worklet/types.ts`)

```typescript
// Core tracker data
PatternCell    // { note, instrument, volCmd, volVal, effCmd, effVal }
PatternRow     // PatternCell[]
PatternMatrix  // PatternRow[]

// Real-time audio state fed to GPU
ChannelShadowState  // { volume, pan, frequency, active, ... }

// WASM bindings
LibOpenMPT     // Function bindings for the libopenmpt WASM module

// Worklet communication
WorkletPatternRow     // Serializable row for postMessage
WorkletPositionData   // { position, vuData, channelData }
EngineState           // Worklet engine lifecycle state
```

---

## Code Conventions

- **File naming:** PascalCase for React components (`.tsx`), camelCase for utilities and hooks (`.ts`)
- **Styling:** Tailwind utility classes; avoid custom CSS unless Tailwind can't express it
- **TypeScript:** Strict mode. All strict flags enabled including `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`
- **React patterns:** Functional components with hooks only; no class components
- **Mutable refs for audio state:** Channel states use refs, not React state, to prevent render-cycle flooding from high-frequency audio data
- **No test framework currently:** Validation is done via `tsc --noEmit` and ESLint; manual browser testing for WebGPU/audio features

---

## Common Pitfalls & Warnings

1. **Worklet cache:** Browsers cache AudioWorklet files aggressively. After editing `openmpt-processor.js`, hard-refresh or disable cache in DevTools.

2. **Shader-uniform coupling:** Shaders are **not** pure assets — they are tightly coupled to TypeScript host code. Any change to a shader's `struct Uniforms {}` requires a matching change in `createUniformPayload` in `PatternDisplay.tsx`.

3. **CORS / SharedArrayBuffer:** The Vite dev server sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. These are required for Emscripten WASM workers. Do not remove them.

4. **libopenmpt CDN load:** `libopenmptjs.js` is loaded in `index.html` from `https://wasm.noahcohn.com/libmpt/`. The app waits on `window.libopenmptReady` before initializing. This must load before any audio operations.

5. **Tailwind content paths:** `tailwind.config.js` explicitly scopes content to avoid OOM during builds. Do not add broad glob patterns.

6. **Symlink watcher:** Vite's FSWatcher is configured with `followSymlinks: false` to avoid an infinite-recursion crash from a CodeQL artifact symlink. Do not remove this.

7. **Video looping:** Video textures use a manual `requestAnimationFrame` loop for "ping-pong" playback — HTML5 native loop wasn't smooth enough. This is intentional.

8. **ScriptProcessorNode fallback:** When debugging audio glitches, determine which path is active (Worklet vs. ScriptProcessor). The messaging structure differs between the two.

9. **Race conditions in audio-visual sync:** `channelStatesRef` is a double-buffered mutable ref. Do not replace it with React state — it will cause jank.

---

## Critical Data Flows

### Module Load → Playback
```
User drops .mod file
  → App.tsx calls loadModule() on useLibOpenMPT hook
  → WASM allocates memory, parses module
  → AudioContext created → AudioWorkletNode (or ScriptProcessorNode) connected
  → Worklet starts audio render loop
  → Main thread polling loop reads row/channel state from WASM
  → React updates sequencerMatrix state
  → PatternDisplay receives new matrix → packs data → writes to GPU buffers → draw call
```

### Shader Switch
```
User selects a new shader in UI
  → App.tsx updates shaderFile state
  → PatternDisplay receives new shaderFile prop
  → Parses filename for version → determines layout/buffer strategy/canvas size
  → Re-initializes WebGPU pipeline (loads new WGSL, re-creates bind groups)
  → Resumes render loop with new pipeline
```

### Shader-Embedded UI Interaction (v0.37+)
```
User clicks on canvas
  → PatternDisplay canvas click handler fires
  → Polar coordinate hit-test against hardcoded UI zone definitions
  → Maps to action (play/stop/seek/volume/pan)
  → Calls corresponding callback (onPlay, onStop, onSeek, onVolumeChange, etc.)
```

---

## Geometry & Layout Constants (`utils/geometryConstants.ts`)

All shared canvas layout values live here:
- `GRID_RECT` — bounding box of the pattern grid area
- `POLAR_RINGS` — ring definitions for circular shader layouts
- `LAYOUT_MODES` — enum of layout types (`simple`, `horizontal`, `circular`)
- `getLayoutModeFromShader(filename)` — maps shader filename → layout mode
- `calculateHorizontalCellSize()` / `calculateCapScale()` — geometry helpers

---

## Build Notes

- Production build requires `node --max-old-space-size=4096` (set in `package.json`)
- WASM `.wasm` files are included as Vite assets (`assetsInclude: ['**/*.wasm']`)
- `openmpt-native` is excluded from Vite's pre-bundling optimization
- Emscripten build for native WASM worklet: `bash build-wasm.sh` or `bash scripts/build-wasm.sh`

---

## What NOT To Do

- **Do not** push to `master` directly — use feature branches
- **Do not** refactor the shader version `if`-chains without understanding every downstream effect
- **Do not** replace `channelStatesRef` with React state
- **Do not** use DOM APIs inside the AudioWorklet processor
- **Do not** add broad glob patterns to `tailwind.config.js`
- **Do not** remove the Vite CORS headers (breaks SharedArrayBuffer / WASM workers)
- **Do not** assume WebGPU is available — always check for fallback paths
