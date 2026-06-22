## Summary

Non-blocking production hygiene issues observed during the 2026-06-17 investigation of `https://test.1ink.us/xm-player/`. These do not individually break the app but increase operational risk.

---

## 1. COEP header mismatch (dev vs production)

| Environment | `Cross-Origin-Embedder-Policy` |
|-------------|-------------------------------|
| Vite dev (`vite.config.ts`) | `credentialless` |
| Production Apache | `require-corp` |

**Risk:** `credentialless` allows cross-origin scripts without `Cross-Origin-Resource-Policy`. `require-corp` blocks any resource lacking CORP/CORS/CORS-exempt credentials.

Currently works because:

- `libopenmptjs.js` CDN returns `Cross-Origin-Resource-Policy: cross-origin` ✅
- esm.sh React importmap loads (verify CORP on each resource)

**If CDN policy changes**, main-thread libopenmpt or parser worker WASM load could fail silently.

**Recommendation:**

- Document required CORP headers for all external dependencies.
- Prefer self-hosting libopenmpt + WASM under `/xm-player/` with explicit CORP.
- Align production COEP with dev (`credentialless`) **or** audit every cross-origin asset.

---

## 2. Stale asset accumulation in `/assets/`

Production `/assets/` contains **80+** historical `index-*.js` bundles (dating to Nov 2025) plus orphaned CSS (`modplayer.1iss`).

**Risk:**

- Disk bloat on VPS
- Users/agents/cache may reference old hashes
- Debugging confusion (which bundle is live?)

**Recommendation:**

- `deploy.py` / server extract: **replace** `assets/` atomically per deploy, or
- Retain only `index.html`-referenced hashes + `rm` older files
- Add `deploy.py --prune` or server-side `find … -mtime +30 -delete`

---

## 3. External CDN dependency chain

Load order on production:

1. `index-ofcsgdds.js` (app bundle)
2. `esm.sh` React importmap
3. `wasm.noahcohn.com/libmpt/libopenmptjs.js` (main thread)
4. Same CDN fetched again inside parser worker
5. Audio worklet scripts under `/xm-player/worklets/`

**Recommendation:**

- Add `<link rel="preconnect" href="https://wasm.noahcohn.com">`
- Add SRI (`integrity=`) for libopenmpt script if hash is stable
- Consider vendoring libopenmpt into `public/` for offline/reproducible deploys

---

## 4. CSS possibly orphaned from active bundle

`modplayer.1iss` is linked in `index.html` but may not correspond to the current JS entry's CSS graph. Verify whether styles are:

- Loaded via `<link>` (expected Vite extract), or
- Injected via JS `import './index.css'` in bundle

Run `grep -r modplayer dist/` after local build.

---

## Acceptance Criteria

- [ ] Production COEP policy documented in `DEVELOPER_CONTEXT.md` or deploy README.
- [ ] Deploy removes stale `assets/` not referenced by current `index.html`.
- [ ] External dependency CORP requirements listed.
- [ ] Optional: libopenmpt vendored for production.

---

## Related

- CSS `.1iss` / charset issue
- Parser worker CDN fetch failures under strict COEP
