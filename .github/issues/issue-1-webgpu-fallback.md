## Summary

On production (`https://test.1ink.us/xm-player/`), browsers that expose `navigator.gpu` but cannot obtain a usable GPU adapter (or fail during WebGPU device/pipeline init) get a hard error overlay instead of automatically falling back to WebGL2 or the HTML renderer.

**Impact:** Users on Safari, GPU-disabled environments, and some Linux/VM setups see a non-functional visualization unless they manually add `?renderer=webgl2` or `?renderer=html`.

**Investigation date:** 2026-06-17

---

## Current Behavior

1. Renderer selection runs synchronously at mount and picks `webgpu` when `navigator.gpu` exists.
2. WebGPU initialization runs asynchronously in `useWebGPURender` and may fail later (null adapter, `requestDevice` failure, shader/pipeline error).
3. On failure, `setWebgpuAvailable(false)` is called, but `activeBackend` remains `'webgpu'`.
4. `PatternDisplay` renders a blocking error overlay:

> WebGPU not available — use `?renderer=webgl2` or `?renderer=html`

Manual `?renderer=webgl2` works around the problem.

---

## Root Cause

Renderer availability is checked in two disconnected places with different rigor:

### 1. Sync capability probe is too weak

`src/renderers/rendererSelection.ts`:

```ts
export function isWebGPUAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}
```

This returns `true` whenever the WebGPU API object exists, **without** calling `navigator.gpu.requestAdapter()`. Many environments expose the API but return `null` from `requestAdapter()` (no suitable GPU, blocked adapter, software-only path rejected, etc.).

`resolvePatternRenderer()` uses this probe for the default path:

```ts
if (isWebGPUAvailable()) return 'webgpu';
if (isWebGL2Available()) return 'webgl2';
return 'html';
```

### 2. Init-time failure does not re-resolve backend

`hooks/useWebGPURender.ts` correctly probes the adapter at init:

```ts
const adapter = await navigator.gpu.requestAdapter();
if (!adapter || cancelled) { setWebgpuAvailable(false); return; }
// ...
} catch (error) {
  console.error('Failed to initialize WebGPU pattern display', error);
  if (!cancelled) setWebgpuAvailable(false);
}
```

But this only flips a boolean — it never calls `setRendererOverride('webgl2')` or updates `activeBackend`.

`components/PatternDisplay.tsx` keeps `activeBackend === 'webgpu'` and shows the error overlay when `!webgpuAvailable`:

```tsx
{!useHTML && useWebGPU && !webgpuAvailable && (
  <div className="error ...">
    WebGPU not available — use <code>?renderer=webgl2</code> ...
  </div>
)}
```

There is a debug-panel `<select>` to switch renderers, but no automatic recovery.

### 3. Related: `utils/deviceCapabilities.ts` already async-probes adapters

`probeWebGPUAdapter()` in `deviceCapabilities.ts` performs a real `requestAdapter()` call for lite-mode heuristics, but renderer selection does not reuse this logic.

---

## Reproduction

1. Open `https://test.1ink.us/xm-player/index.html` in a browser without a usable WebGPU adapter (Safari, Chrome with `--disable-gpu`, some headless/CI environments).
2. Observe the red WebGPU error overlay; visualization is unusable.
3. Reload with `?renderer=webgl2` — canvas initializes (separate data-pipeline issues may still apply).

**Local repro (dev):** Temporarily stub `navigator.gpu.requestAdapter` to resolve `null` while leaving `'gpu' in navigator` true.

---

## Proposed Fix

### Option A (recommended): Async probe at startup + cache result

1. Add `probeWebGPUAdapter(): Promise<boolean>` to `rendererSelection.ts` (or reuse `deviceCapabilities.ts`).
2. Run the probe once during app/renderer bootstrap before committing to `webgpu`.
3. Cache the result in module scope or `sessionStorage` to avoid repeated adapter requests.
4. Update `resolvePatternRenderer()` to accept a pre-probed flag, or expose `resolvePatternRendererAsync()`.

### Option B: Runtime fallback on init failure

In `useWebGPURender` catch/`!adapter` paths (or a `PatternDisplay` effect watching `webgpuAvailable`):

```ts
if (!webgpuAvailable && activeBackend === 'webgpu') {
  const fallback = isWebGL2Available() ? 'webgl2' : 'html';
  console.warn(`[Renderer] WebGPU init failed; auto-falling back to ${fallback}`);
  setRendererOverride(fallback);
  setActiveBackend(fallback);
}
```

Guard against infinite loops (only fall back once per session).

### Option C: Combine both

- Sync fast path for obvious cases (`'gpu' not in navigator` → skip WebGPU immediately).
- Async probe for the ambiguous case.
- Runtime fallback as a safety net for shader/device errors after adapter success.

---

## Files to Touch

| File | Change |
|------|--------|
| `src/renderers/rendererSelection.ts` | Async WebGPU probe; optional cached result |
| `components/PatternDisplay.tsx` | Auto-fallback effect; soften/remove hard error overlay when fallback succeeds |
| `hooks/useWebGPURender.ts` | Optionally emit fallback event on init failure |
| `utils/deviceCapabilities.ts` | Consolidate adapter probing (avoid duplication) |

---

## Acceptance Criteria

- [ ] Page loads a working visualization on browsers without WebGPU (Safari, older Chrome, GPU-disabled).
- [ ] When `requestAdapter()` returns `null`, app auto-selects WebGL2 (if available) or HTML without URL params.
- [ ] When WebGPU init fails after adapter success (shader error, device lost), app falls back once and logs a clear message.
- [ ] Explicit `?renderer=webgpu` still attempts WebGPU first; fallback only when init fails (document behavior).
- [ ] No infinite fallback loop between backends.
- [ ] Debug panel renderer override still works.

---

## Testing Notes

- Manual: Safari macOS/iOS, Chrome `--disable-gpu`, Firefox (no WebGPU).
- CI: extend `scripts/smoke-test-webgpu.mjs` or add a `?renderer=webgl2` screenshot smoke path.
- Regression: confirm WebGPU still selected on Chrome 113+ with working GPU.

---

## Related

- Blocks full usability of #TBD (pattern data pipeline) on fallback backends.
- `components/PatternDisplay.responsive.tsx` has parallel WebGPU init logic — keep in sync or consolidate.
