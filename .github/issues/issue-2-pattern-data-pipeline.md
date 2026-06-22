## Summary

On production (`https://test.1ink.us/xm-player/`), the default module (`4-mat_madness.mod`) loads over HTTP, but **pattern data never reaches any renderer**:

- `?renderer=webgl2` — gray/blank canvas; status stuck at `Parsing "4-mat_madness.mod"…`
- `?renderer=html` — `PatternSequencer` shows **"No pattern data available."** (`matrix` is `null`)

This indicates a broken **parser worker → React state** pipeline, not a renderer-specific GPU bug.

**Investigation date:** 2026-06-17

---

## Current Behavior

| Stage | Expected | Observed |
|-------|----------|----------|
| Fetch `4-mat_madness.mod` | HTTP 200, ~115 KB | ✅ Success |
| Main thread libopenmpt init | `window.libopenmptReady` resolves | ✅ (audio path may work) |
| Parser worker spawned | `openmpt-parser.worker-*.js` loads | Worker posts `{type:"parse",...}` |
| Worker response | `{type:"parsed", patternMatrices, metadata}` | ❌ Never arrives or empty |
| `sequencerMatrix` state | First order matrix set | ❌ Stays `null` |
| Status text | `Loaded "…"` | ❌ Stuck at `Parsing "…"…` |

---

## Architecture (expected flow)

```
useLibOpenMPT.processModuleData()
  ├─ fileData.slice() → fileDataRef (main-thread copy retained)
  ├─ new Worker(openmpt-parser.worker.ts, { type: 'module' })
  ├─ postMessage({ type:'parse', fileData, fileName }, [fileData.buffer])  // transfers buffer
  └─ await Promise on worker 'message'
       ├─ type:'parsed' → setSequencerMatrix(patternMatrices[0])
       └─ type:'error'   → setStatus(`Error: ${message}`)

PatternDisplay / WebGL2 / HTML
  └─ receive matrix prop from App.tsx ← sequencerMatrix
```

Key files:

- `hooks/useLibOpenMPT.ts` — `processModuleData()` (lines ~213–341)
- `workers/openmpt-parser.worker.ts` — off-thread parse via CDN libopenmpt
- `components/PatternDisplay.tsx` — `matrix` prop drives all GPU backends
- `components/PatternSequencer.tsx` — shows "No pattern data available." when `!matrix`

---

## Root Cause Hypotheses (ranked)

### H1: Parser worker hangs or crashes silently (most likely)

`processModuleData` creates a Promise that **only resolves on `message`** — no timeout, no `worker.onerror`, no `messageerror` handler:

```ts
const result = await new Promise<WorkerParseResult>((resolve) => {
  const worker = workerRef.current!;
  const handler = (e: MessageEvent<WorkerParseResult>) => {
    worker.removeEventListener('message', handler);
    resolve(e.data);
  };
  worker.addEventListener('message', handler);
  worker.postMessage({ type: 'parse', fileData, fileName }, [fileData.buffer]);
});
```

If the worker throws before `postMessage`, or WASM init hangs, the Promise never settles → status stuck at **Parsing…** forever.

The worker loads libopenmpt independently via:

```ts
const response = await fetch('https://wasm.noahcohn.com/libmpt/libopenmptjs.js');
const fn = new Function(cleanedScript);
fn.call(globalThis);
```

This is fragile under strict cross-origin isolation (see H2).

### H2: Production COEP `require-corp` vs dev `credentialless`

| Environment | COEP header |
|-------------|-------------|
| Vite dev (`vite.config.ts`) | `credentialless` |
| Production (`test.1ink.us`) | `require-corp` |

Production is stricter. The parser worker must fetch:

1. Its own script (`openmpt-parser.worker-*.js`)
2. libopenmpt JS + WASM from CDN

CDN currently serves `Cross-Origin-Resource-Policy: cross-origin` (verified 2026-06-17), which should pass `require-corp`. However:

- WASM instantiation inside a **module worker** evaluated via `new Function()` may still fail depending on CORP/COEP/CORS of `.wasm` assets.
- Any CORP regression on the CDN would break the worker while the main-thread `<script src=…>` path still works → explains "libopenmpt ready but no patterns".

### H3: Worker module bundling / base-path mismatch

Worker is created with:

```ts
new Worker(new URL('../workers/openmpt-parser.worker.ts', import.meta.url), { type: 'module' })
```

Under subdirectory deploy (`VITE_APP_BASE_PATH=/xm-player/`), a mis-resolved worker URL → 404 → silent hang if `onerror` is not wired.

**Verify:** Network tab for `openmpt-parser.worker-*.js` status on production.

### H4: Structured-clone / transfer issue (less likely)

Main thread transfers `fileData.buffer` to the worker (intentional; a `fileDataCopy` is retained separately). Worker response is a plain object (no transferables). Unlikely to zero out `patternMatrices` unless worker sends `{type:'parsed', patternMatrices:[]}`.

### H5: Race with renderer init (unlikely for HTML)

HTML fallback reads the same `sequencerMatrix` React state. Stuck **Parsing…** means `processModuleData` never completed, not a renderer timing issue.

---

## Reproduction

1. `https://test.1ink.us/xm-player/index.html?renderer=webgl2`
2. Open DevTools → Network: confirm `4-mat_madness.mod` 200, worker JS 200.
3. Console: look for `[processModuleData]` logs or worker errors.
4. `?renderer=html` → "No pattern data available." confirms `sequencerMatrix === null`.
5. Local: `VITE_APP_BASE_PATH=/xm-player/ npm run build && npm run preview` with COEP `require-corp` header emulation.

---

## Proposed Fix

### 1. Instrument the pipeline

Add staged logging (dev + opt-in prod via `?debug=parser`):

```ts
console.log('[Parser] posting to worker', fileName, fileData.byteLength);
// worker: console.log('[Parser worker] WASM ready, orders:', numOrders);
console.log('[Parser] received', result.type, result.patternMatrices?.length);
```

### 2. Harden `processModuleData` error handling

```ts
const PARSE_TIMEOUT_MS = 15_000;

const result = await new Promise<WorkerParseResult>((resolve, reject) => {
  const worker = workerRef.current!;
  const timer = setTimeout(() => reject(new Error('Parser timed out')), PARSE_TIMEOUT_MS);

  const onMessage = (e: MessageEvent<WorkerParseResult>) => { /* clearTimeout; resolve */ };
  const onError = (e: ErrorEvent) => { /* clearTimeout; reject */ };

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);
  worker.postMessage(...);
});
```

Wrap in try/catch; always transition status out of **Parsing…**.

### 3. Validate worker response

```ts
if (result.type !== 'parsed' || !result.patternMatrices?.length) {
  setStatus('Error: No pattern data in module');
  console.error('[Parser] empty patternMatrices', result);
  return;
}
```

### 4. Consider unifying libopenmpt load path

Options:

- **A:** Parse on main thread after `libopenmptReady` (worker was optimization; main thread already loads libopenmpt for audio).
- **B:** Pass initialized WASM exports to worker via `postMessage` instead of re-fetching CDN script in worker.
- **C:** Host libopenmpt assets locally under `/xm-player/` with correct CORP headers.

### 5. Align production COEP with dev

If worker WASM fails only under `require-corp`, either:

- Serve app with `credentialless` (matches `vite.config.ts`), or
- Self-host all WASM/JS worker dependencies with `Cross-Origin-Resource-Policy: cross-origin`.

---

## Files to Touch

| File | Change |
|------|--------|
| `hooks/useLibOpenMPT.ts` | Timeout, `onerror`, response validation, logging |
| `workers/openmpt-parser.worker.ts` | Error reporting, optional main-thread WASM sharing |
| `vite.config.ts` / server config | Document or align COEP for production |
| `deploy.py` / hosting | COEP header, asset cleanup |
| `types.ts` | `WorkerParseResult` discriminated union guards |

---

## Acceptance Criteria

- [ ] Pattern data visible in WebGL2 within 3 s of page load on production URL.
- [ ] HTML renderer shows pattern rows, not "No pattern data available."
- [ ] Status transitions: `Fetching…` → `Parsing…` → `Loaded "…"` (or explicit error).
- [ ] Worker 404/WASM/timeout failures surface a user-visible error within 15 s.
- [ ] `sequencerMatrix` non-null for default `4-mat_madness.mod` after load.
- [ ] Works with `VITE_APP_BASE_PATH=/xm-player/` on preview server.

---

## Debugging Checklist

- [ ] Network: `openmpt-parser.worker-*.js` → 200
- [ ] Network: CDN `libopenmptjs.js` + `.wasm` → 200 with CORP
- [ ] Console: `crossOriginIsolated === true` on production
- [ ] Console: `[processModuleData] Processing module:` appears
- [ ] Console: worker `postMessage` response received
- [ ] React DevTools: `sequencerMatrix` state after load

---

## Related

- #TBD — Parser stuck at "Parsing…" (timeout/UX subset of this issue)
- #TBD — WebGPU auto-fallback (renderer works but has no data)
- Production COEP mismatch noted in deployment observations
