# Self-hosted libopenmpt (main thread + parser worker)

Pinned **libopenmpt 0.8.4** assets for browser playback and pattern parsing. These files are served from the app origin so COEP `credentialless` / `require-corp` deploys do not depend on `wasm.noahcohn.com`.

| File | Role |
|------|------|
| `libopenmptjs.js` | Emscripten glue (~5 MB) — loaded by `index.html` and the parser worker |
| `libopenmpt.wasm` | WebAssembly binary (~1.2 MB) — fetched by the glue via `locateFile` |

## Version pin

- **Release:** libopenmpt **0.8.4** (matches `vendor/libopenmpt-*` used by `npm run build:emcc`)
- **Source:** originally vendored from `https://wasm.noahcohn.com/libmpt/`
- **SRI hashes:** `utils/libopenmptAssets.ts` (`LIBOPENMPT_JS_INTEGRITY`, `LIBOPENMPT_WASM_INTEGRITY`)

## Refresh vendored copies

```bash
npm run vendor:libmpt
```

Then update SRI constants in `utils/libopenmptAssets.ts` if the script prints new hashes.

## CDN override (optional)

For local experiments against the external CDN:

```bash
VITE_LIBOPENMPT_CDN_URL=https://wasm.noahcohn.com/libmpt/ npm run dev
```

When set, SRI is omitted and `index.html` keeps the `wasm.noahcohn.com` preconnect hint.

## Deploy / subpath

Assets load from `${import.meta.env.BASE_URL}libmpt/` (e.g. `/xm-player/libmpt/`). No hardcoded CDN URLs in production builds.
