# Deployment — xm-player (test.1ink.us)

## Quick start

```bash
npm run build:xm-player:verify   # build + validate dist/
python deploy.py --build         # build, validate, upload zip
```

Deploy target: `https://test.1ink.us/xm-player/` via `storage.noahcohn.com` bundle API.

## Build validation

Before upload, `deploy.py` and `scripts/verify-build.mjs` check:

- `index.html` uses `/xm-player/` base path
- `<link rel="stylesheet">` points to a `.css` file (not `.1iss`)
- Referenced CSS is ≥ 10 KB, UTF-8, no NUL bytes
- Module script and stylesheet files exist on disk
- No `.1iss` files in `dist/assets/`

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
