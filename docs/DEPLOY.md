# Deployment — xm-player (test.1ink.us)

## Quick start

```bash
npm run deploy                   # build (xm-player profile), validate, upload zip
# or step by step:
npm run build:xm-player:verify   # build + validate dist/
python deploy.py --no-build      # upload an already-validated dist/
python deploy.py --dry-run --no-build   # local classify/validate; never upload
```

Deploy target: `https://test.1ink.us/xm-player/` via `storage.noahcohn.com` bundle API.

## Native audio engine (optional)

The JS AudioWorklet (`public/worklets/openmpt-worklet.js`) is always shipped. The native C++/Emscripten engine is **optional** and **gitignored**. Vite copies `public/` into `dist/` verbatim, so if the trio exists under `public/worklets/` it lands in `dist/worklets/`.

**Build order when you want `?engine=native` to work on the live site:**

```bash
# emsdk 3.1.51
source /path/to/emsdk/emsdk_env.sh
npm run build:emcc
# → public/worklets/openmpt-native.js
# → public/worklets/openmpt-native.wasm
# → public/worklets/openmpt-native.aw.js
python3 deploy.py                 # or: npm run build:xm-player:verify && python3 deploy.py --no-build
```

Do **not** commit those three files. A checkout that never ran `build:emcc` still deploys the JS engine.

`scripts/verify-build.mjs` and `deploy.py` classify the trio in `dist/worklets/`:

| State | Meaning | verify-build | deploy.py |
|-------|---------|--------------|-----------|
| **complete** | all three present, `.wasm` has `\0asm` magic, JS is not an HTML error page | PASS + sizes | prints that native is shipping |
| **absent** | none of the three exist | PASS + loud warning naming `npm run build:emcc` | same banner; continues (JS-only deploy) |
| **partial** | 1 or 2 of 3 exist | **FAIL** | **abort**, no upload |
| **invalid** | all three exist but content is HTML / not wasm | **FAIL** | **abort**, no upload |

Strict production (refuse a JS-only ship):

```bash
python3 deploy.py --require-native
# or: DEPLOY_REQUIRE_NATIVE=1 python3 deploy.py
```

`--dry-run` runs the same local checks (and zips in memory) but never calls the Contabo upload or live-index APIs.

**What users see when native is missing:** playback still works on the JS worklet. `?engine=native` (or a sticky prefer-native localStorage) **soft-fails** to JS with a console warning — the app does not hard-fail. Public builds (`VITE_PUBLIC_MODE=1`) still force JS unless the URL opts into native; see `public/worklets/README.md`.

## Build validation

Before upload, `deploy.py` and `scripts/verify-build.mjs` check:

- `index.html` uses `/xm-player/` base path
- `<link rel="stylesheet">` points to a `.css` file (not `.1iss`)
- Referenced CSS is ≥ 10 KB, UTF-8, no NUL bytes
- Module script and stylesheet files exist on disk
- No `.1iss` files in `dist/assets/`
- Native engine trio is complete, absent (warned), or refused if partial/invalid

## Asset pruning (stale bundles)

Each Vite build produces new hashed files under `assets/`. Without pruning, the VPS accumulates dozens of old `index-*.js` bundles and orphaned CSS (e.g. `modplayer.1iss`).

**Default:** `DEPLOY_CLEAN=1` (or unset) sends `clean=1` and `prune_assets=1` with the upload. The zip includes `.deploy-inventory.json` listing every file that **should** exist after extract. The deploy service should delete remote `assets/*` entries not in that manifest.

```bash
python deploy.py              # prune on (default)
python deploy.py --no-prune   # upload only, keep old assets
python deploy.py --prune      # explicit prune (same as default)
```

### Manual server cleanup

If remote prune is not yet active on the VPS:

```bash
# On server — keep only files listed in the latest .deploy-inventory.json
cd /path/to/xm-player
python3 -c "
import json
inv = json.load(open('.deploy-inventory.json'))
keep = {f for f in inv['files'] if f.startswith('assets/')}
from pathlib import Path
for p in Path('assets').glob('*'):
    rel = f'assets/{p.name}'
    if rel not in keep:
        print('rm', p)
        p.unlink()
"
```

Or retain only files referenced by live `index.html`:

```bash
grep -oE '/xm-player/assets/[^\"]+' index.html
```

## Directory index mismatch (critical)

Apache may serve **two different HTML files**:

| URL | Expected |
|-----|----------|
| `https://test.1ink.us/xm-player/index.html` | Current Vite `dist/index.html` (UTF-8, correct `index-*.js`) |
| `https://test.1ink.us/xm-player/` | **Must be the same file** |

If `/xm-player/` returns UTF-16 HTML or references an old `index-D7iykI5o.js` while `index.html` has `index-DrVowyq4.js`, users get **broken audio** (worklet 404 at site root, no #329/#330 fixes). `deploy.py` prints a post-upload warning when this mismatch is detected.

**Fix:** redeploy with prune (`python deploy.py`), ensure `dist/.htaccess` includes `DirectoryIndex index.html`, and delete any stale UTF-16 `index.html` on the VPS if it persists.

`deploy.py` always packs HTML (never size-skips it) and appends `<!-- xasm-deploy:<sha> -->` so the VPS size-skip cannot leave a same-length stale `index.html` in place.

## COOP / COEP headers

Production must match dev (`public/.htaccess` copied into `dist/`):

| Header | Value |
|--------|-------|
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Embedder-Policy` | `credentialless` |

**Do not use `require-corp`** unless every cross-origin dependency (CDN libopenmpt, esm.sh) is audited or self-hosted with CORP. See `docs/DEVELOPER_CONTEXT.md` §6.

After changing `.htaccess`, redeploy and verify:

```bash
curl -sI https://test.1ink.us/xm-player/index.html | grep -i cross-origin
```

## External dependencies at runtime

| # | Resource | Notes |
|---|----------|-------|
| 1 | `index-*.js` / `index-*.css` | Vite bundle |
| 2 | esm.sh React importmap | `preconnect` in `index.html` |
| 3 | `wasm.noahcohn.com/libmpt/libopenmptjs.js` | Main-thread audio WASM |
| 4 | Same CDN in parser worker | Pattern matrix extraction |
| 5 | `/xm-player/worklets/*` | AudioWorklet processors |

CDN must return `Cross-Origin-Resource-Policy: cross-origin` (or equivalent) if COEP is ever tightened.

## Post-deploy smoke check

```bash
curl -s https://test.1ink.us/xm-player/index.html | grep -E 'stylesheet|module'
# Expect: /xm-player/assets/index-<hash>.css and .js — not modplayer.1iss

curl -sI https://test.1ink.us/xm-player/assets/index-*.css | grep -i content-type
# Expect: text/css; charset=utf-8
```

Load the app: status should progress `Fetching` → `Parsing` → `Loaded` within ~15 s, not hang indefinitely.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEPLOY_TOKEN` | (see `deploy.py`) | Auth for storage.noahcohn.com |
| `DEPLOY_CLEAN` | `1` | Set `0` to skip remote prune request |
| `VITE_APP_BASE_PATH` | `/xm-player/` for production build | Asset URLs in `index.html` |
| `VITE_STORAGE_API_URL` | `https://storage.noahcohn.com` (set in `build:xm-player`) | Library/shader API (`/api/songs`, `/api/shaders`) |
