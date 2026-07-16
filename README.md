# React libopenmpt Viewer

A small React + TypeScript web app for loading and previewing tracker module files (MOD/IT/S3M/XM, etc.) using libopenmpt compiled to WebAssembly. The app also includes a visual pattern viewer (HTML and optional WebGPU/WGSL shaders) and a simple media overlay for images / GIFs / video.

Key features

Recent changes
- v0.35: added "Donut & Night Mode" shader `shaders/patternv0.35_bloom.wgsl` (channel invert toggle, white center island, studio dim + UV ring); also includes previous bloom helpers in `utils/bloomPostProcessor.ts`.

- Play tracker modules in the browser using libopenmpt (WASM).
- Pattern view with three renderer backends: **WebGPU** (WGSL shaders), **WebGL2** (GLSL reference renderer), and **HTML** fallback.
- Simple media panel & overlay for images, GIFs, and videos synchronized with playback.
- Built with Vite, React, and TypeScript. Tailwind CSS is used for styling.

Quick start

Prerequisites

- Node.js (16+ recommended) and npm or a compatible package manager.
- A modern browser. WebGPU is the default renderer (Chrome 113+, Edge 113+, Arc). WebGL2 and HTML fallbacks work in any modern browser.

Install dependencies

```bash
npm ci
```

Prefer `npm ci` for a clean install that matches the committed `package-lock.json`. Use `npm install` only when adding/updating dependencies (and commit the updated lockfile).

### Regenerating `package-lock.json`

```bash
# After editing package.json dependencies:
npm install
git add package.json package-lock.json

# Full regenerate (rare — e.g. lockfile corruption):
rm -rf node_modules package-lock.json
npm install
git add package-lock.json
```

Run the development server

```bash
npm run dev
```

Open your browser to the address printed by Vite (typically http://localhost:5173) and load a tracker module using the UI.

Build for production

```bash
npm run build
npm run preview
```

Assets load from site root (`/`). For the live subpath deploy at `test.1ink.us/xm-player/`, use `npm run build:xm-player` (sets `VITE_APP_BASE_PATH=/xm-player/`).

Lint (ESLint, hard CI gate; max 100 warnings budget)

```bash
npm run lint
```

### Native C++ audio engine (optional)

Production audio uses the tracked **JS** AudioWorklet at `public/worklets/openmpt-worklet.js`. Do not overwrite it.

The optional native engine is built with a **single** supported path:

```bash
# Prerequisites: emsdk 3.1.50 (matches CI)
git clone https://github.com/emscripten-core/emsdk.git && cd emsdk
./emsdk install 3.1.50 && ./emsdk activate 3.1.50
source ./emsdk_env.sh

cd /path/to/mod-player
npm run build:emcc              # release (-O3)
# npm run build:emcc -- --debug # -O0 -g -sASSERTIONS=2
```

Outputs (gitignored until built): `public/worklets/openmpt-native.{js,wasm,aw.js}`.

| Command | Notes |
|---------|--------|
| `npm run build:emcc` | **Canonical** — runs `scripts/build-wasm.sh` |
| `npm run build:worklet` | Deprecated alias → same script |
| `./build-wasm.sh` | Deprecated root wrapper → same script |

Verify exported symbols stay in sync with TypeScript/C++:

```bash
npm run verify:native-exports
```

See also: `docs/WASM_BUILD_SOLUTIONS.md`, `public/worklets/README.md`, `AGENTS.md`.

### Visual smoke (browser verification)

```bash
npm run build && npm run preview -- --port 4173 &
npm run smoke:visual          # full matrix (webgl2/html/webgpu + lite modes)
npm run smoke:visual:ci       # CI subset: webgl2 + html, v0.30b/46/50/57
```

See `docs/VISUAL_SMOKE.md` for the manual WebGPU + mobile checklist.

Usage

- Click "Load" or drag-and-drop a tracker module file (.mod, .it, .s3m, .xm, etc.) to load it.
- Use the playback controls to play/stop and toggle looping.
- Switch pattern renderers via URL param, debug panel, or devtools:
  - `?renderer=webgpu` (default when available)
  - `?renderer=webgl2` — GLSL 3.00 ES reference renderer for debugging and CI screenshots
  - `?renderer=html` — lightweight DOM grid (`PatternSequencer`)
  - `window.DEBUG_RENDERER = 'webgl2'` or `localStorage.setItem('xasm1_pattern_renderer', 'webgl2')`
- Add media files via the media panel to display them in the overlay while a module plays.

Project structure (important files)

- `index.html` — application entry. Loads libopenmpt WASM/JS and sets up a readiness promise used by the React app.
- `index.tsx`, `App.tsx` — React entry and main application UI.
- `hooks/useLibOpenMPT.ts` — primary integration with the libopenmpt runtime and playback state.
- `components/` — UI components (Controls, Header, PatternDisplay, PatternSequencer, MediaPanel, etc.).
- `src/renderers/` — Pattern renderer abstraction (`webgl2/`, `html/`, selection + global API).
- `shaders/` — WGSL shader files used by the WebGPU pattern renderer.
- `public/` — static assets.
- `package.json` — scripts and dependency list. Uses Vite for dev and build.

Notes and configuration

- libopenmpt: Self-hosted under `public/libmpt/` (libopenmpt **0.8.4**). Loaded via `index.html` with BASE_URL-aware paths; optional CDN override with `VITE_LIBOPENMPT_CDN_URL`. See `public/libmpt/README.md`.
- Tailwind: A CDN helper script is present in `index.html` to bring in utility styles quickly in development. For production builds you may want to use the PostCSS/Tailwind config in the repo.
- **Pattern renderers:** WebGPU → WebGL2 → HTML automatic fallback chain. Use WebGL2 (`?renderer=webgl2`) to iterate on shader/effect logic with GLSL and `window.currentPatternRenderer.readPixels()` for Playwright pixel tests. Alt+D (dev) cycles WebGL2 debug modes (wireframe, UV, playhead heatmap).
- **WebGPU → WebGL2 porting:** Shared packing lives in `utils/gpuPacking.ts`; WebGL2 GLSL mirrors `hooks/webGLShaders.ts` (three-emitter lens caps). Chassis/night mode/bloom approximations are in `src/renderers/webgl2/shaders/`.

Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/REPO_LAYOUT.md](docs/REPO_LAYOUT.md) for first-party vs experimental paths.

Contributions and fixes are welcome. Open an issue or pull request; keep changes small and focused. If you add dependencies, update `package.json` and include a brief rationale in the PR.

Credits

- libopenmpt (WASM build) — playback engine for tracker modules.
- Project originally linked to: https://github.com/ford442/react-dom (see app footer for repository link).

License

This repository does not include an explicit license file. Add a LICENSE file if you want to permit reuse.
