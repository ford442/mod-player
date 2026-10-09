# CLAUDE.md — AI Assistant Guide for mod-player (XASM-1 Player)

> **Read this file first.** It supersedes any other documentation for the purpose of making code changes.
> Refer to `docs/DEVELOPER_CONTEXT.md` for deeper architectural rationale and `AGENTS.md` for additional directives.

---

## Project Overview

**XASM-1 Player** is a browser-based tracker module player (MOD, XM, S3M, IT) with a WebGPU-powered visualization engine. It is designed to look and feel like a retro-futuristic hardware device.

**Core technology stack:**
- **React 18 + TypeScript + Vite** — UI framework and build tooling
- **libopenmpt (WASM)** — Accurate tracker module audio playback; a self-hosted real-WASM build (`public/worklets/libopenmpt-worklet.{js,wasm}`, see pitfall 4)
- **Web Audio API + AudioWorklet** — Audio rendering pipeline (ScriptProcessorNode fallback)
- **WebGPU + WGSL** — Hardware-accelerated visualization; **WebGL2** GLSL reference renderer and **HTML** grid as fallbacks
- **Tailwind CSS** — Styling
- **Three.js / React-Three-Fiber** — Optional 3D visualization mode

---

## Directory Structure

```
mod-player/
├── App.tsx                      # Root React component; wires state into the session/features contexts
├── appConfig.ts                 # SHADER_GROUPS (picker), default shader, theme/feature config
├── index.tsx, index.html        # Entry point; HTML shell (libopenmpt glue is injected by vite-plugins/libopenmptHtml.ts)
├── types.ts                     # Core TypeScript interfaces (PatternCell, ChannelShadowState, etc.)
│
├── app/                         # App-level hooks split out of App.tsx (keyboard actions, playlist, media, test hooks, lazy 3D shell)
├── context/                     # PlayerSession / PlayerFeatures contexts (refs stay on mutable objects, not Zustand)
├── store/                       # Zustand stores (player UI, shader prefs, local library)
├── hooks/
│   ├── useLibOpenMPT.ts         # PRIMARY AUDIO HOOK — composes the pieces below
│   ├── libOpenMPT/              # Refs/state, module loading, transport actions, UI loop (createUpdateUI)
│   ├── audioGraph/              # Engine start paths: JS worklet, native C++ worklet, ScriptProcessor fallback
│   └── useKeyboardShortcuts.ts, usePlaylist.ts, useWebGPURender.ts, …
│
├── components/
│   ├── PatternDisplay.tsx       # PRIMARY VISUALIZATION — WebGPU context, shaders, render loop
│   ├── Controls.tsx, TransportBar.tsx, SeekBar.tsx   # Transport UI
│   ├── PatternSequencer.tsx     # HTML fallback pattern grid (wired via src/renderers/html/)
│   ├── ChannelMeters.tsx, MetadataPanel.tsx, Playlist.tsx, MediaOverlay.tsx, …
│   └── Studio3D.tsx, CameraRig.tsx, icons.tsx        # Three.js 3D mode (lazy), SVG icons
│
├── audio-worklet/
│   ├── js/openmpt-processor.ts  # JS AudioWorklet processor SOURCE (esbuild → public/worklets/openmpt-worklet.js)
│   ├── libRuntimeReady.ts, workletProtocolConstants.ts   # Bundled into the worklet
│   ├── protocol.ts, jsWorkletDispatch.ts     # Main-thread side of the worklet message protocol
│   └── OpenMPTWorkletEngine.ts  # Native C++ engine wrapper
│
├── workers/                     # Parser and export Web Workers
├── utils/                       # Pure helpers: shaderRegistry/shaderVersion, gpuPacking, geometryConstants, playheadPrediction, …
├── src/renderers/               # Pattern renderer abstraction (webgpu/webgl2/html selection)
├── shaders/                     # WGSL source shaders (+ shaders/lib/ includes); synced to public/shaders/
├── cpp/                         # Native libopenmpt AudioWorklet engine (C++/emscripten)
├── vite-plugins/                # COOP/COEP headers + chunking, libopenmpt <script> injection
├── scripts/                     # Build/verify/smoke scripts (Node + shell)
├── tests/                       # Vitest suite (npm test)
├── docs/                        # Architecture notes, planning, smoke-test guides
├── public/
│   ├── worklets/                # openmpt-worklet.js (generated processor) + libopenmpt-worklet.{js,wasm} (real-WASM libopenmpt: worklet, main thread, parser worker) (static assets)
│   └── shaders/                 # Public-served copies of shaders
├── archive/                     # Experimental code that is NOT built or linted
│
├── vite.config.ts               # Vite config (base path, CORS headers, WASM assets, chunking)
├── tsconfig*.json               # app (strict), node (configs), scripts, worklet, tests
├── tailwind.config.js           # Tailwind (scoped content paths to avoid OOM)
├── eslint.config.js, postcss.config.js
└── package.json
```

---

## Development Commands

```bash
npm run dev          # Start Vite dev server at http://localhost:5173
npm run build        # tsc + Vite production build → dist/
npm run preview      # Preview production build locally
npm run typecheck    # TypeScript type-check only (no emit): app + vite/vitest configs + scripts/ (tsconfig.node.json, tsconfig.scripts.json)
npm run preflight    # Run before every commit: CI's `lint-and-build` job *is* this chain (stops at first failure, no network needed after `npm ci`)
npm run verify:lockfile # package-lock.json metadata guard (lockfileVersion 3, resolved + integrity)
npm run lint         # ESLint (max 40 warnings budget; hard CI gate)
npm run build:emcc   # Native C++ worklet → openmpt-native.* (scripts/build-wasm.sh, emsdk 3.1.51)
npm run build:worklet # Alias of build:emcc (never overwrites openmpt-worklet.js)
npm run build:js-worklet # Compile audio-worklet/js/openmpt-processor.ts → public/worklets/openmpt-worklet.js (esbuild)
npm run build:js-libopenmpt # Real-WASM libopenmpt for the JS engine → public/worklets/libopenmpt-worklet.{js,wasm} (emsdk 3.1.51; committed)
npm run verify:js-libopenmpt # Static + boot/render/corrupt-input checks of that pair (no emsdk needed)
python3 deploy.py    # Build + SFTP upload to production server
```

**Browser requirement:** WebGPU requires Chrome 113+, Edge 113+, or Arc. For headless testing pass `--enable-unsafe-webgpu`. Use `?renderer=webgl2` when WebGPU is unavailable or for GLSL-based debugging.

### Pattern Renderer Backends

| Backend | Entry | Use case |
|---------|-------|----------|
| `webgpu` | default | Production visuals (WGSL + bloom) — **required** for GPU viz this phase |
| `webgl2` | deferred | GLSL reference path exists but is **not** auto-selected; `?renderer=webgl2` no-ops to WebGPU |
| `html` | `?renderer=html` | DOM pattern grid (tracker UI), not a GLSL shader session |

Toggle via debug panel (🔍), `localStorage.xasm1_pattern_renderer`, or `window.DEBUG_RENDERER`. WebGL2 debug: **Alt+D** cycles wireframe/UV/playhead modes (dev only).

**Deployment env var:** `VITE_APP_BASE_PATH=/xm-player/ npm run build` for subdirectory hosting.

---

## Architecture: The Two Worlds

Audio logic is split strictly between two contexts that **cannot share state directly**.

### Main Thread (`hooks/useLibOpenMPT.ts`)
- Initializes the self-hosted real-WASM libopenmpt (`window.libopenmptReady` promise; see pitfall 4)
- Loads module files into WASM memory (`libopenmpt_module_create_from_memory2()`)
- Acquires the one shared `AudioContext` from `utils/audioContextFactory.ts` and attempts to use `AudioWorkletNode`; falls back to `ScriptProcessorNode`
- Sends control messages to the worklet via `port.postMessage()`
- Reads current row/channel state from WASM, double-buffers via mutable refs (`channelStatesRef`) to avoid React re-render floods
- Performs drift detection and timing correction for audio-visual sync

### Worklet Thread (`audio-worklet/js/openmpt-processor.ts`, compiled to `public/worklets/openmpt-worklet.js`)
- Runs the actual libopenmpt render loop at the AudioContext sample rate (locked to 48 kHz, pitfall 12)
- Sends position + VU data back to the main thread every ~16 ms (60 fps)
- **Rule:** No React state, no DOM APIs inside the worklet. All communication is strictly via `port.postMessage()`.

---

## Architecture: WebGPU Visualization

### `PatternDisplay.tsx` — The Rendering Engine
This is the largest and most complex file. It:
1. Initializes a WebGPU context on a `<canvas>` element
2. Resolves **shader capabilities** from `utils/shaderRegistry.ts` (not filename `includes()` chains)
3. Allocates GPU buffers for pattern data and channel states
4. Runs a render loop with up to two passes:
   - **Pass 1 (Chassis/Background):** Renders the bezel/device chassis texture
   - **Pass 2 (Pattern):** Renders tracker data as a grid, spectrum, or circular display
5. Handles canvas mouse events via polar hit-testing when `hitTestProfile` is set

### Data Packing for GPU
Tracker cell data is bit-packed into `Uint32Array` buffers before upload:

- **Standard packing:** `[Note(8) | Instr(8) | VolCmd(8) | VolVal(8)]` in one `u32`
- **High-precision (v0.36+) — `PackedA/PackedB` split:**
  - `PackedA`: `[Note(8) | Instr(8) | VolCmd(8) | VolVal(8)]`
  - `PackedB`: `[Unused(16) | EffCmd(8) | EffVal(8)]`

**If you change data packing in TypeScript, you MUST update the bit-shifting logic in the corresponding WGSL shader(s).**

---

## Critical: Shader Registry (single source of truth)

> **Edit `utils/shaderRegistry.ts` + `appConfig.ts` + the WGSL file.**  
> Do **not** add new `shaderFile.includes('v0.XX')` chains in PatternDisplay / hooks.

Capabilities (layout, packing, canvas size, hit-test, oscilloscope, palette, bloom, etc.) live on `ShaderMeta` in `SHADER_REGISTRY`. Helpers in `utils/shaderVersion.ts` and geometry helpers read the registry via `resolveShaderMeta()`.

**When adding a new shader:**
1. Add `shaders/patternvX.YY.wgsl` (reuse `shaders/lib/` via `//#include`; run `npm run sync:shaders`)
2. Register one `ShaderMeta` block in `utils/shaderRegistry.ts`
3. Add a picker entry in `appConfig.ts` `SHADER_GROUPS`
4. Ensure WGSL uniforms match `fillUniformPayload` (`utils/gpuPacking.ts`, called from `src/renderers/webgpu/frameDraw.ts`)
5. Run `npm run test:shader-includes` + `npm run test:shader-registry`

**Include migration:** See `shaders/README.md` and `AGENTS.md` migration table. Capabilities live in `utils/shaderRegistry.ts` (not `shaderFile.includes()` chains).

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
- **Tests:** Vitest (`npm test` runs `tests/**/*.test.ts`), plus `tsc` (app, worklet, tests, configs, scripts) and ESLint — all part of `npm run preflight`. WebGPU/audio behaviour needs a real browser: CI runs the Playwright smoke jobs (`smoke:visual`, `smoke:audio`, `smoke:playhead`)

---

## Common Pitfalls & Warnings

1. **Worklet cache:** Browsers cache AudioWorklet files aggressively. After editing `audio-worklet/js/openmpt-processor.ts` (and rebuilding `public/worklets/openmpt-worklet.js`), hard-refresh or disable cache in DevTools. The loader appends a content-hash `?v=`, so normal users pick up changes automatically.

2. **Shader-uniform coupling:** Shaders are **not** pure assets — they are tightly coupled to TypeScript host code. Any change to a shader's `struct Uniforms {}` requires a matching change in `fillUniformPayload` in `utils/gpuPacking.ts`.

3. **CORS / SharedArrayBuffer:** The Vite dev server sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. These are required for Emscripten WASM workers. Do not remove them.

4. **libopenmpt is self-hosted real WASM:** `public/worklets/libopenmpt-worklet.{js,wasm}` (built by `npm run build:js-libopenmpt`, emsdk 3.1.51; tracked in git) is loaded in `index.html` (injected by `vite-plugins/libopenmptHtml.ts` with SRI + `?v=`) and is the **same pair** the AudioWorklet and the parser worker use. The app waits on `window.libopenmptReady` before initializing. It never replaces `globalThis.WebAssembly` — do not reintroduce a wasm2js glue or a `__NATIVE_WEBASSEMBLY__` snapshot. Readiness = `onRuntimeInitialized` (`audio-worklet/libRuntimeReady.ts`), never "`_openmpt_*` is defined". Never export a real `stringToUTF8` from the glue (the app polyfills its own with a different signature); `npm run verify:js-libopenmpt` guards this.

5. **Tailwind content paths:** `tailwind.config.js` explicitly scopes content to avoid OOM during builds. Do not add broad glob patterns.

6. **Symlink watcher:** Vite's FSWatcher is configured with `followSymlinks: false` to avoid an infinite-recursion crash from a CodeQL artifact symlink. Do not remove this.

7. **Video looping:** Video textures use a manual `requestAnimationFrame` loop for "ping-pong" playback — HTML5 native loop wasn't smooth enough. This is intentional.

8. **ScriptProcessorNode fallback:** When debugging audio glitches, determine which path is active (Worklet vs. ScriptProcessor). The messaging structure differs between the two.

9. **Race conditions in audio-visual sync:** `channelStatesRef` is a double-buffered mutable ref. Do not replace it with React state — it will cause jank.

10. **MOD/XM playback regressions (#329 / #330):** libopenmpt must init **once** per `AudioWorkletGlobalScope`; reuse the worklet node on module reload; never `suspend()` `AudioContext` on normal stop; throttle worklet `position` postMessage to ~60 Hz; skip `node.disconnect()` on hot reload. See `docs/WORKLET_AUDIO_BUG.md` and `tests/workletAudioLifecycle.test.ts`.

11. **JS worklet is generated (#435):** `public/worklets/openmpt-worklet.js` is compiled from `audio-worklet/js/openmpt-processor.ts` via `npm run build:js-worklet` (esbuild → classic IIFE script; AudioWorklet globals still can't `import()` reliably). It carries a `// generated — do not edit` header; edit the TS source instead, then rebuild. CI fails if the committed file drifts from a fresh build. `hooks/useWorkletLoader.ts`'s cache-busting `?v=` comes from a content hash in `audio-worklet/js/worklet-version.generated.json` (also written by the build script) — no manual version bump. `audio-worklet/workletProtocolConstants.ts` is the single source of message-type strings, imported by both `audio-worklet/protocol.ts` (main thread) and the processor source (bundled in) — there is no separate classic-script mirror.

---

12. **One `AudioContext` per page session:** `utils/audioContextFactory.ts`
    (`createPlayerAudioContext` / `getSharedPlayerAudioContext`) is the only
    place a context is constructed. `sampleRate` is locked to **48000** (the
    `--grow` native heap build and the JS engine's libopenmpt both render there, and the playhead
    math `samplesWritten / sampleRate` needs a fixed rate); `latencyHint` is a
    *create-time* choice — `playback`, or `interactive` under stage mode /
    `?latency=interactive` — and is never re-applied by recreating the context.
    The native C++ engine attaches to the same context via
    `init_audio_with_context`; `init_audio()` is a headless-harness export only.
    `tests/audioContextFactory.test.ts` fails the build on a second call site.

13. **Native engine: one resident `OpenMPTModule`:** `cpp/worklet_processor.cpp`
    parses a **transient** `g_metaModule` in `load_module()` (pattern cells,
    channel/order counts, duration) and `commit_module()` unloads it *before*
    the audio thread builds `g_module`. Never leave both resident — the release
    build's `INITIAL_MEMORY=128mb` is a hard cap with `ALLOW_MEMORY_GROWTH=0`.
    `load_module()` **adopts** the `_malloc`'d pointer (the caller must not
    `_free` it) and returns 0 with a typed `ERR_*` string from
    `get_last_error()` rather than letting libopenmpt throw — a throw aborts the
    worklet under `DISABLE_EXCEPTION_CATCHING=1`. Mute / ctl / render params go
    to `g_module` via atomics only; poking the metadata parse changes nothing
    you can hear. `scripts/verify-native-exports.mjs` enforces all of this.

14. **WebGPU pipelines are async and built before they replace anything (#449):**
    every render/compute pipeline goes through `createRenderPipelineChecked` /
    `createComputePipelineChecked` and every shader module through
    `createCheckedShaderModule` (`utils/gpuShaderCompile.ts`). The synchronous
    `create*Pipeline` never throws on validation errors, so it is banned in
    `src/renderers/webgpu/` and the bloom/compute utils (tests enforce this).
    `WebGPURenderer.initShader` builds the new pipelines first and only then
    releases the old shader, so a broken WGSL file keeps the previous one on
    screen and reports `SHADER-INIT: …` in `DebugInfo.errors`. Bloom renders the
    scene into `BLOOM_SCENE_FORMAT` (`rgba16float`), so every pipeline drawn in
    the bloom scene pass needs an HDR variant (`hdrPipeline` /
    `bezelHdrPipeline`); blur uniforms are one buffer per direction × layer.
    Debug info goes through `useThrottledDebugInfo`, not `useState`: it only
    re-renders PatternDisplay while the debug panel is open.

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
  → Resolves the shader's ShaderMeta from the registry → determines layout/buffer strategy/canvas size
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

- WASM `.wasm` files are included as Vite assets (`assetsInclude: ['**/*.wasm']`)
- `openmpt-native` is excluded from Vite's pre-bundling optimization
- Emscripten native worklet: `npm run build:emcc` → `public/worklets/openmpt-native.*` only (emsdk **3.1.51**)

---

## What NOT To Do

- **Do not** push to `main` / `master` directly — use a feature branch and open a PR. (A repository ruleset that refuses direct pushes to `main` is the goal but, as of 2026-09-26, does not exist yet — see `CONTRIBUTING.md`. Treat this rule as binding regardless.)
- **Do not** commit without running `npm run preflight` first (see Development Commands)
- **Do not** hand-edit `package-lock.json` — regenerate it with `npm install`
- **Do not** reintroduce `shaderFile.includes('v0.XX')` chains — extend `ShaderMeta` instead
- **Do not** replace `channelStatesRef` with React state
- **Do not** use DOM APIs inside the AudioWorklet processor
- **Do not** add broad glob patterns to `tailwind.config.js`
- **Do not** remove the Vite CORS headers (breaks SharedArrayBuffer / WASM workers)
- **Do not** add a second `new AudioContext` call site — `utils/audioContextFactory.ts` is the only one (see pitfall 12)
- **Do not** assume WebGPU is available — always check for fallback paths
- **Do not** commit Emscripten `a.out` / `a.out.*` — native outputs are only `public/worklets/openmpt-native.*` (gitignored build artifacts from `npm run build:emcc`)
- **Do not** commit agent scratch files (`.swarm-state.md`, `weekly_plan.md`) — use `docs/planning/ROADMAP.md` and GitHub issues
