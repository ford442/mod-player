# Pipeline hygiene check — 2026-10-30

Scope: dev → preflight → subpath build → `deploy.py --dry-run` → live `https://test.1ink.us/xm-player/`.
Checked at `origin/main` = `b10e1e7` (#533). Nothing uploaded; `deploy.py` only run with `--dry-run`.

## Result

Everything before the upload is healthy. **The live site is a stale deploy**: it is the 12 Sep 2026 build, 64 commits behind `main`.

| Stage | Result | Evidence |
|---|---|---|
| `npm ci` | OK | 50 s |
| preflight (every stage, run singly) | OK | lockfile 0 s, wasm 0, js-libopenmpt 1, worklet-fresh 0, lint 14, typecheck 10, worklet 1, tests-tsc 5, vitest 16, shader-includes 1, build 16, verify:build:root 0, bundle-budget 1 s |
| `VITE_APP_BASE_PATH=/xm-player/` build + `verify:build` + `verify:bundle-budget` | OK | build 16 s; entry 629 KiB, initial JS 240 kB gzip, worklets/ 2854.7 KiB |
| `dist/worklets/` contents | OK | both `libopenmpt-{worklet,playback}.{js,wasm}`, `openmpt-worklet.js`, `fx-character-worklet.js`; no `openmpt-native.*` |
| `deploy.py --dry-run` | OK (rc 0, 19 s) | zip 23216 KB, 88 files, keeps 15 assets; prints WARN for the live COEP header (below) |
| Live == main | **NO** | live stamp `xasm-deploy:c9cd0a2fd9506f5a:1789185732` = 2026-09-12 04:02 UTC; `Last-Modified` 12 Sep |
| Live probe | **stale** | see discrepancies |
| Playwright on live | loads and plays | `crossOriginIsolated=true`, `[PLAY]` lines through "Worklet loaded module", no failed assets after load |

## Discrepancies

1. **Stale deploy (main cause).** Live index references `assets/index-BpzUpgLY.js`, an esm.sh importmap and `libmpt/libopenmptjs.js` (wasm2js). Current `main` builds `index-BOIpLE4p.js` and the real-WASM libopenmpt. The live worklet URL is `openmpt-worklet.js?v=16`; main's is `?v=e05d1d5181`. Console shows `libopenmpt-audioworklet.js is wasm2js — JS only`.
2. **`worklets/libopenmpt-playback.wasm` and `libopenmpt-worklet.wasm` are not on live.** They return `302 → https://www.noahcohn.com/404.1ink` (Apache ErrorDocument). Anything on live that fetches them gets an HTML page.
3. **Live COEP is `credentialless`, not `require-corp`.** Live is still serving pre-#533 headers (not Safari-isolating). `deploy.py` already WARNs about it. COOP `same-origin` is correct.
4. **Stale files on live.** `worklets/openmpt-native.js` and `libmpt/libopenmptjs.js` still answer 200 (the removed native engine and the wasm2js glue).
5. **`Content-Type: text/html` on the index has no `charset`** (`application/x-javascript; charset=utf-8` on JS). The page has `<meta charset>`, so it renders, but the header is incomplete.
6. **Cache:** index `max-age=600`, worklet `max-age=172800` with a `?v=` buster. Fine, just recording.
7. **WebGPU on live in the headless sandbox:** `navigator.gpu` present and `requestAdapter()` returned an adapter, then `WebGPU canvas presentation failed (swapchain does not composite)` (hard-fail card; `No available adapters` under `?renderer=html`). This is the software-GPU CI-style host, not a deploy defect; not compared against a fixed build.
8. **Minor:** `net::ERR_ABORTED` on `openmpt-worklet.js` and the parser worker is a navigation-time cancel of the `HEAD` verification, not an outage.

## Fix needed (not done here)

A real deploy of current `main` (`python3 deploy.py`, owned by another session) resolves 1–4 at once. Item 3 needs `public/_headers` / `public/.htaccess` to actually reach the server (live Apache still emits `credentialless`, so confirm after deploy that `.htaccess` is honored). Item 5 would be `AddDefaultCharset UTF-8` / `AddType 'text/html; charset=utf-8' .html` in `public/.htaccess`. No files outside `docs/` were changed.
