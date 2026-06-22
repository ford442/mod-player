## Summary

The status bar on production can remain stuck indefinitely at:

> Parsing "4-mat_madness.mod"…

with no success message, no error message, and no recovery path. This is a **UX/reliability gap** in the parser worker integration — distinct from but tightly coupled to the pattern-data pipeline failure.

**Investigation date:** 2026-06-17

---

## Current Behavior

1. `useLibOpenMPT` init completes → `isReady = true`.
2. Default module effect fetches `4-mat_madness.mod` → calls `processModuleData()`.
3. `setStatus('Parsing "${fileName}"…')` runs immediately.
4. If the parser worker never responds, status **never updates** — no timeout, no spinner differentiation, no retry.

Users cannot distinguish:

- Slow WASM init (may take 10–25 s in worker)
- Worker 404 / script error
- COEP-blocked WASM fetch
- Hung `onRuntimeInitialized` in worker

---

## Root Cause

### 1. Promise without timeout or rejection path

`hooks/useLibOpenMPT.ts` — `processModuleData()`:

```ts
setStatus(`Parsing "${fileName}"…`);

const result = await new Promise<WorkerParseResult>((resolve) => {
  const worker = workerRef.current!;
  const handler = (e: MessageEvent<WorkerParseResult>) => {
    worker.removeEventListener('message', handler);
    resolve(e.data);
  };
  worker.addEventListener('message', handler);
  worker.postMessage(
    { type: 'parse', fileData, fileName },
    [fileData.buffer]
  );
});
```

Problems:

| Gap | Consequence |
|-----|-------------|
| Only `resolve`, never `reject` | Exceptions in setup don't propagate |
| No `worker.addEventListener('error', …)` | Script load/syntax errors swallowed |
| No `messageerror` handler | Structured-clone failures swallowed |
| No timeout | Infinite **Parsing…** state |
| Listener removed only on first message | Late duplicate messages ignored (minor) |

### 2. Worker-side timeout exists only for WASM init

`workers/openmpt-parser.worker.ts` has a 25 s `onRuntimeInitialized` timeout, but:

- Network failure fetching CDN script throws → caught → posts `{type:'error'}` ✅
- If `postMessage` from worker fails, main thread still hangs ❌
- If worker script fails to load (404), main thread has no `error` listener ❌

### 3. Status string contract is informal

Status values are free-form strings (`setStatus(...)`). No enum for `{idle, fetching, parsing, loaded, error}`. UI cannot render differentiated states (spinner vs error vs success).

### 4. Init path vs user load path share the same fragile promise

Both default module load (`useEffect` at line ~945) and `loadModule()` call `processModuleData()` — same hang behavior for playlist uploads.

---

## Reproduction

1. Open `https://test.1ink.us/xm-player/index.html` (any renderer).
2. Wait >30 s — status remains **Parsing…**.
3. **Simulate locally:** block `openmpt-parser.worker-*.js` in DevTools → permanent hang.
4. **Simulate:** throttle network + block CDN WASM → hang or very long wait with no feedback.

---

## Proposed Fix

### 1. Robust promise wrapper

```ts
function parseInWorker(
  worker: Worker,
  message: WorkerParseMessage,
  transfer: Transferable[],
  timeoutMs = 15_000,
): Promise<WorkerParseResult> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Parser timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onMessage = (e: MessageEvent<WorkerParseResult>) => {
      cleanup();
      resolve(e.data);
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(e.message || 'Parser worker error'));
    };
    const onMessageError = () => {
      cleanup();
      reject(new Error('Parser worker message deserialization failed'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    worker.postMessage(message, transfer);
  });
}
```

### 2. Catch in `processModuleData`

```ts
try {
  const result = await parseInWorker(worker, { type: 'parse', fileData, fileName }, [fileData.buffer]);
  // existing success path
} catch (err) {
  const msg = err instanceof Error ? err.message : 'Parser failed';
  console.error('[processModuleData]', err);
  setStatus(`Error: ${msg}`);
  return;
}
```

### 3. Worker load verification at init

When creating the worker, attach a permanent `error` listener that logs and sets `parserWorkerHealthy = false`.

Optionally verify worker URL with `fetch(workerUrl, { method: 'HEAD' })` during app init (similar to `useWorkletLoader.verifyWorkletFile`).

### 4. Progressive status feedback

```ts
setStatus(`Parsing "${fileName}"…`);
// after 5s if still pending:
setStatus(`Parsing "${fileName}"… (loading WASM)`);
```

Or expose `parsePhase: 'wasm' | 'patterns' | 'done'` for the Header component.

### 5. Retry / fallback to main-thread parse

If worker fails or times out, fall back to parsing on the main thread (libopenmpt already initialized for audio):

```ts
console.warn('[Parser] Worker failed; falling back to main-thread parse');
await parseOnMainThread(fileDataCopy, fileName);
```

This provides resilience and unblocks users even if worker COEP issues persist.

---

## Files to Touch

| File | Change |
|------|--------|
| `hooks/useLibOpenMPT.ts` | `parseInWorker` helper, try/catch, status updates |
| `workers/openmpt-parser.worker.ts` | Progress messages (`{type:'progress', stage:'wasm'}`) |
| `components/Header.tsx` | Optional parse-phase UI |
| `hooks/useWorkletLoader.ts` | Reuse HEAD-check pattern for worker URL |

---

## Acceptance Criteria

- [ ] Parsing resolves to **Loaded** or **Error: …** within 15 s (configurable).
- [ ] Worker script 404 produces `Error: Parser worker failed` (not infinite hang).
- [ ] Worker runtime exception surfaces message to status bar.
- [ ] Default module load on production no longer stuck at **Parsing…** indefinitely.
- [ ] User-initiated file load (`loadModule`) has same timeout behavior.
- [ ] Console logs include correlation id / fileName for support debugging.

---

## Testing

| Scenario | Expected status |
|----------|-----------------|
| Happy path | `Loaded "4-mat_madness"` (or module title) |
| Block worker JS | `Error: Parser worker error` ≤15 s |
| Invalid .mod bytes | `Error: Failed to load module (invalid format?)` |
| CDN blocked | `Error: Failed to fetch libopenmpt JS: …` |
| Timeout | `Error: Parser timed out after 15000ms` |

---

## Related

- Parent/data issue: pattern matrices never reach `sequencerMatrix` (same root hang).
- `useWorkletLoader` already implements worklet HEAD checks and diagnostics — mirror for parser worker.
- Production COEP `require-corp` may trigger worker failures that this issue must surface clearly.
