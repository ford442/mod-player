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

Artifacts land in `./artifacts/visual-smoke/` by default (`report.json`, `VISUAL_SMOKE_REPORT.md`, per-scenario PNGs, and `coverage-map.json` on failures).

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
| `SKIP_COVERAGE` | `0` | Set `1` to disable structural coverage assertions |

### Shader matrix (full profile)

| Shader | Backlog item |
|--------|----------------|
| `patternv0.30b.wgsl` | Note-On Disc cyan hold/fade |
| `patternv0.46–48.wgsl` | Octave-brightness back-port |
| `patternv0.50.wgsl` | Three-emitter LED baseline |
| `patternv0.55–57.wgsl` | Oscilloscope / palette / velocity LEDs |

CI profile runs: **v0.30b, v0.46, v0.50, v0.52–57, v0.23, v0.24** on **webgl2 + html**.

---

## Structural coverage assertions

### Motivation

The 2026-07-22 render cascade (#346–#351) had two failure clusters:

| Cluster | Shaders | Symptom | Original non-black check |
|---------|---------|---------|--------------------------|
| Black render | v0.52–v0.54 (#346–348) | Fully solid-black canvas | ❌ missed (opaque pixels, zero luminance) |
| Partial render | v0.24 (#349), v0.23 (#350), WebGL2 (#351) | Thin band / scanline offset / overlay misalignment | ❌ missed (non-black, opaque canvas) |

The non-black luminance check (`readCanvasPixels`) catches the first cluster.  
**Structural coverage assertions** catch the second cluster, which the non-black check cannot detect.

### Why not PNG pixel-diff baselines?

Three independent model reviews (Gemini Pro, Grok, Kimi K2) evaluated a pixel-diff approach and unanimously found it structurally unworkable for this codebase (see [issue #358](https://github.com/ford442/mod-player/issues/358) for full analysis):

1. **Local-GPU vs CI-rasterizer mismatch**: baselines generated on a real GPU will not match SwiftShader/llvmpipe AA rounding in CI. Any tolerance tight enough to catch a real misalignment flakes on healthy frames; loose enough to stop flaking misses real regressions. This is structural — not tunable.
2. **Headless WebGPU compositor flakiness**: captures can succeed internally while the compositor never presents the frame, producing phantom black/partial captures indistinguishable from real regressions.
3. **Baseline churn defeats the guard**: active WGSL iteration means every intentional visual change requires a regen. Regen becomes reflexive, and PNGs are not reviewable in a PR diff — so a real regression riding in a regen commit will be rubber-stamped.
4. **Bug class doesn't need pixel identity**: #349/#350/#351 are geometry/coverage deviations detectable without comparing individual pixel values.

**No binary baseline images are committed** as part of this change. If a downsampled-MSE layer is ever added (deferred — see issue #358), baselines must be generated in CI via `workflow_dispatch`, not locally.

### How coverage assertions work

`scripts/lib/coverage-assert.mjs` implements four checks:

**(a) Global coverage ≥ floor** — catches solid-black renders (#346–#348).  
Lit pixel = any pixel with luminance above threshold 12/255 (~0.047). Default floor 2%.

**(b) Per-region coverage ≥ floor** — catches thin bands (#349) and partial renders.  
Regions are layout-aware:
- **Circular shaders** (v0.30–v0.57): 3 annuli × 4 angular sectors covering the ring area (inner radius 0.15 → outer 0.45 × minDim). Each sector must have ≥ 3% coverage.
- **Horizontal shaders** (v0.21, v0.39, v0.40, v0.43, v0.44): 4 × 2 grid over the pattern grid area (y: 0.15–0.85). Each cell must have ≥ 2% coverage.
- **Video/simple shaders** (v0.23, v0.24): 2 × 2 quadrants. Floor 0.5% (lenient — CI headless may have limited codec support).

**(c) Bounding box spans ≥ minimum** — catches collapsed renders (#351).  
The bounding box of all lit pixels must span ≥ 20% of canvas width and height (circular default).

**(d) Lit-mass centroid within tolerance** — catches systematic offsets (#350/#351).  
The centroid of all lit pixels must be within ±25% of the canvas centre (circular default).

### Region floor tuning

Floors live in `scripts/lib/visual-smoke-config.mjs` under `COVERAGE_DEFAULTS` and `COVERAGE_SHADER_OVERRIDES`. Per-shader overrides are plain numeric config — reviewable as a PR diff, no binary files.

To tighten a floor after verifying stability:
1. Edit the relevant entry in `COVERAGE_SHADER_OVERRIDES`.
2. Run `SMOKE_PROFILE=ci npm run smoke:visual` locally against a production build.
3. Confirm PASS with the tightened floor.
4. Open a PR with the config change — the diff is human-readable.

### Failure artifacts

On a coverage failure, the harness saves a `coverage-map.json` in the scenario output directory alongside the screenshots. The JSON includes:
- `failures[]` — human-readable failure messages (e.g. `"ring2_sector1 coverage 0.3% < 3.0% floor"`)
- `stats.regions[]` — per-region lit/total pixel counts
- `stats.bbox` and `stats.centroid` — global geometry stats
- `config` — the floors that were applied

No golden-image baseline is required to interpret a failure: the coverage map and screenshot together fully describe the problem.

---

### What the harness checks

- Module loads via `window.__TEST_HOOKS__.loadModuleFromUrl`
- Canvas / HTML fallback renders (non-blank screenshot + `readPixels` when available)
- Console hard-fails on: bounds violations, buffer mismatches, `[DURA-PARITY]` errors (without ✓)
- Captures: `activeRenderer`, `audioEngine` (worklet / native / ScriptProcessor), `liteMode`
- Seeks rows `0, 8, 16` and captures frames
- **Structural coverage assertions** per layout-aware region (see above)

### Deterministic capture

The harness applies determinism guards before pixel capture:
- `deviceScaleFactor: 1` in Playwright context (pinned, not display-DPR-dependent)
- CSS `animation-duration/delay/transition` collapsed to 0.001ms before capture
- `document.fonts.ready` awaited before screenshot

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

## CI behaviour

The `visual-smoke` job in `.github/workflows/ci.yml`:

1. `npm run build`
2. Starts `vite preview` on port 4173
3. `SMOKE_PROFILE=ci npm run smoke:visual` — **required** (WebGL2 + HTML, coverage assertions included)
4. WebGPU coverage step (`continue-on-error: true`) — experimental, see below
5. Uploads `artifacts/visual-smoke/` on failure (5-day retention)
6. Always uploads `artifacts/visual-smoke-webgpu/` (5-day retention)

### WebGPU promotion path

The WebGPU coverage step currently runs with `continue-on-error: true` because headless WebGPU compositor flakiness on Linux/SwiftShader is documented (the compositor can fail to present while rendering succeeds internally). 

**To promote to required:**
1. Confirm the WebGPU step passes cleanly across ≥ 5 consecutive CI runs on main.
2. Remove `continue-on-error: true` from the `webgpu-coverage` step in `.github/workflows/ci.yml`.
3. Change the upload step from `if: always()` to `if: failure()`.

WebGPU is **not** required in CI — headless WebGPU is recorded as `EXPECTED_SKIP`. Use the manual checklist above for WGSL verification.
