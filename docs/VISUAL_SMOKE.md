# Visual Smoke Testing

Formal browser verification for merged features that typecheck green but need runtime confirmation.

## One-command smoke

```bash
# Terminal 1 — serve the app (production build recommended for CI parity)
npm run build && npm run preview -- --port 4173

# Terminal 2 — run the matrix
npm run smoke:visual
```

CI profile (WebGL2 + HTML only, smaller shader set):

```bash
SMOKE_PROFILE=ci npm run smoke:visual
```

Artifacts land in `./artifacts/visual-smoke/` by default (`report.json`, `VISUAL_SMOKE_REPORT.md`, per-scenario PNGs).

### Environment

| Variable | Default | Notes |
|----------|---------|--------|
| `BASE_URL` | `http://localhost:4173` | Preview or dev server |
| `OUTPUT_DIR` | `./artifacts/visual-smoke` | Screenshots + reports |
| `SMOKE_PROFILE` | `full` | `ci` \| `quick` \| `full` |
| `RENDERERS` | profile-based | `webgl2,html` (ci) or +`webgpu` (full) |
| `SHADER_FILES` | profile-based | See matrix below |
| `LITE_MODES` | `0` (ci) or `0,1` (full) | `?lite=1` forces lite path |
| `MODULE_URLS` | `/4-mat_madness.mod` (+ `/test.xm` in full) | MOD + XM for DURA parity |
| `TIMEOUT` | `60000` | Page timeout ms |
| `FAIL_ON_WARN` | `0` | Set `1` to fail on buffer warnings |

### Shader matrix (full profile)

| Shader | Backlog item |
|--------|----------------|
| `patternv0.30b.wgsl` | Note-On Disc cyan hold/fade |
| `patternv0.46–48.wgsl` | Octave-brightness back-port |
| `patternv0.50.wgsl` | Three-emitter LED baseline |
| `patternv0.55–57.wgsl` | Oscilloscope / palette / velocity LEDs |

CI profile runs: **v0.30b, v0.46, v0.50, v0.57** on **webgl2 + html**.

### What the harness checks

- Module loads via `window.__TEST_HOOKS__.loadModuleFromUrl`
- Canvas / HTML fallback renders (non-blank screenshot + `readPixels` when available)
- Console hard-fails on: bounds violations, buffer mismatches, `[DURA-PARITY]` errors (without ✓)
- Captures: `activeRenderer`, `audioEngine` (worklet / native / ScriptProcessor), `liteMode`
- Seeks rows `0, 8, 16` and captures frames

### Related commands

```bash
npm run screenshot:shaders   # legacy alias → quick profile
npm run test:duration-parity # CPU/GPU packing unit test (no browser)
npm run capture:v046-paging  # v0.46 overlay paging deep-dive
npm run capture:trigger-tail # v0.30b / sustain tail capture
```

---

## Manual WebGPU desktop checklist

Run against **`npm run dev`** (DURA parity only logs in dev builds).

1. Open `http://localhost:5173/?renderer=webgpu`
2. Load `/4-mat_madness.mod` and `/test.xm` (or any `.it` if available)
3. DevTools console:
   - [ ] `[DURA-PARITY] ✓` for both MOD and IT (high-precision shaders)
   - [ ] No `[WebGPU]` init / pipeline errors
   - [ ] Audio badge shows **⚡ Worklet** (not 🐌 Script) when worklet loads
4. Shader spot checks:
   - [ ] **v0.57** — loud steps bloom brighter; bottom emitter = velocity; sustain sin-pulse
   - [ ] **v0.30b** — instant note-on; cyan holds through sustain; fades at note-off
   - [ ] **v0.46/47/48** — octave gradient on wide-range module; sustain to B-9 on v0.47
   - [ ] **v0.55** — oscilloscope trace visible when playing
5. **Play button** — click ▶️; canvas must not scroll off-screen (see `utils/scrollContainer.ts`)
6. Optional: `?lite=0` on desktop — full shaders unchanged

## Manual mobile / lite checklist

Emulate mobile in DevTools **or** use a real phone:

1. `?lite=1` — forces lite: v0.21, 512×512, no bloom, no WebGL overlay
2. `?lite=0` on mobile UA — full desktop path
3. [ ] No WebGPU console errors (fallback to WebGL2/HTML acceptable)
4. [ ] Lite toggle in header matches `?lite=` behavior

---

## CI behavior

The `visual-smoke` job in `.github/workflows/ci.yml`:

1. `npm run build`
2. Starts `vite preview` on port 4173
3. `SMOKE_PROFILE=ci npm run smoke:visual`
4. Uploads `artifacts/visual-smoke/` on failure

WebGPU is **not** required in CI — headless WebGPU is recorded as `EXPECTED_SKIP`. Use the manual checklist above for WGSL verification.
