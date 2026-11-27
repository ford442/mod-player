# Deployment — xm-player (test.1ink.us + go.1ink.us)

## Quick start

```bash
npm run deploy                   # test.1ink.us/xm-player → full shader catalog + picker
npm run deploy:go                # go.1ink.us/xm-player → public lock (v0.30b only, no picker)
# or step by step:
npm run build:xm-player:verify   # test host build: full catalog + picker
npm run build:go:verify          # go host build: VITE_PUBLIC_MODE=1 public lock
python deploy.py                 # same as npm run deploy
python deploy.py --site go       # same as npm run deploy:go
python deploy.py --no-build      # upload an already-validated test-profile dist/
python deploy.py --site go --no-build   # upload an already-validated go-profile dist/
python deploy.py --dry-run --no-build   # local classify/validate; never upload
```

Deploy targets via `storage.noahcohn.com` bundle API:

- `https://test.1ink.us/xm-player/` ← `npm run build:xm-player` ← full shader catalog + picker
- `https://go.1ink.us/xm-player/` ← `npm run build:go` (`VITE_PUBLIC_MODE=1`) ← only `patternv0.30b.wgsl` (“Note-On Disc”), no picker

Both hosts keep the same `/xm-player/` base path.

> [!WARNING]
> `dist/` is a single folder. Do **not** use `--no-build` to upload a test-profile `dist/` to `go`, or a go-profile `dist/` to `test`; rebuild for the matching `--site` first.

## Which commit is live (`version.json`)

Every build writes `dist/version.json` (vite-plugins/buildVersion.ts) and a matching
`<meta name="xasm-build">` tag in `index.html`:

```json
{ "sha": "<full 40-char commit>", "builtAt": "2026-11-27T13:40:00.000Z", "profile": "test", "base": "/xm-player/", "dirty": false }
```

```bash
curl -s https://test.1ink.us/xm-player/version.json     # compare with: git rev-parse HEAD
```

`deploy.py` **refuses** a build whose `dirty` is true (uncommitted changes — `--allow-dirty` for a throwaway
deploy), whose `profile` does not match `--site` (`test` for test, `public` for go), or that has no
`version.json`. `build:xm-player` / `build:go` / `deploy` run from a committed tree: note that the
prebuild steps rewrite `public/shaders/` and `public/worklets/`, so commit those syncs first.

After the upload `deploy.py` verifies the live site: `version.json`'s SHA and profile must equal the build,
and every non-hashed file (everything except `assets/<name>-<hash>.<ext>`, HTML and dot-files) must be
byte-identical to `dist/`. A live site it cannot read counts as a failure (exit 1).

## What is uploaded

Only Vite's content-hashed `assets/` files are skipped when the remote copy has the same size (a changed file
has a new name). Everything else — `sw.js`, `worklets/*`, `*.wasm`, `shaders/*`, images, `.htaccess` — is
considered every time, because size is not content (#561).

The upload service **also skips equal-sized files on its side** (proven live: `sw.js` `mod-player-v8` → `v9` was
uploaded and left at v8). So for an unhashed file whose size equals the remote copy's, `deploy.py` fetches the live
bytes first: identical → skipped; a changed text file (js, json, wgsl, css, `.htaccess`, `_headers`) is sent with one
trailing newline so its size differs; a changed binary (`.wasm`, images) is sent as is and the post-upload byte
comparison above fails the deploy if the server dropped it. test.1ink.us answers bursts with HTTP 429, so these
live fetches are paced and retried.

## Build output notes

- Vite's 500 kB chunk warning is silenced with a documented `chunkSizeWarningLimit` of 900 kB in
  `vite.config.ts` (not a silent bump): `three-r3f` (~0.8 MB) is third-party and lazy, `index` (~0.7 MB) is the
  entry and is gated in gzip bytes by `verify:bundle-budget`. Raise the limit only with a written reason there.
- No source maps are emitted (Vite default; `build.sourcemap` is not set); wasm frames in fault reports are named by
  `scripts/symbolicate.mjs` (docs/FAULT_REPORTS.md).
- `dist/` also carries sample modules (`4-mat_madness.mod`, `libopenmpt-test.mod`, `test.xm`, used by the
  default load / smokes), `clouds.mp4`, `worklets/README.md` and the Netlify-style `_headers` (ignored by
  Apache). The two 9.6 MB PWA icons are the bulk of `dist/` (27 MB); shrinking them is Release 4.

## Audio engine

The JS AudioWorklet (`public/worklets/openmpt-worklet.js`) and its libopenmpt pair (`public/worklets/libopenmpt-worklet.{js,wasm}`) are tracked in git, so every build ships them and a deploy needs no emsdk. The optional native C++ engine (`openmpt-native.*`, `?engine=native`, `--require-native`) was retired — see `docs/ADR-native-engine.md`.

`--dry-run` runs the same local checks (and zips in memory) but never calls the Contabo upload or live-index APIs.

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

Production must match dev. One value everywhere — `vite-plugins/crossOriginIsolationHeaders.ts`
(dev + preview), `public/.htaccess` (copied into `dist/`) and `public/_headers`;
`tests/build/crossOriginIsolationHeaders.test.ts` pins all three:

| Header | Value |
|--------|-------|
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Embedder-Policy` | `require-corp` |

`require-corp`, not `credentialless` (#516): WebKit does not implement `credentialless`, so under it
Safari is never `crossOriginIsolated` and silently takes every fallback (module create on the audio
thread, `postMessage` instead of `SharedArrayBuffer`). Every cross-origin surface was audited for
`require-corp` — see the runtime-dependencies table below.

`.htaccess` uses `Header always set` for both headers and unsets **both** in both mod_headers tables
(`Header unset` + `Header always unset`), so a parent vhost's value cannot leave a second one
behind. A duplicated COEP is ignored by browsers; a duplicated COOP turns `crossOriginIsolated` off
(staging sent COOP twice, #561). Do not add `Cross-Origin-Resource-Policy`: our
subresources are same-origin, and the parent vhost already sends `CORP: cross-origin`.

`sw.js` replays the cached `index.html` (with whatever COEP it was stored with) offline; bump its
`CACHE_NAME` whenever these headers change.

### Checking the live headers

`python3 deploy.py --dry-run` probes `https://<host>/xm-player/` and
`https://<host>/xm-player/worklets/openmpt-worklet.js` for the `--site` being deployed (follows
redirects, `Cache-Control: no-cache`) and prints the result of each (`scripts/lib/coi_headers.py`):

| Result | Meaning |
|--------|---------|
| `OK` | COOP `same-origin` + COEP `require-corp` |
| `WARN` | COEP `credentialless` — isolated on Chromium/Firefox only, not Safari |
| `FAIL` | COOP not `same-origin`, COEP missing / unknown / sent twice, or a non-200 response |

The dry run exits non-zero on `FAIL` (a `WARN` is allowed, since the live site serves
`credentialless` until this ships). After a real upload the same probe runs next to the
directory-index check, and the deploy exits 1 unless every probe is `OK` ("uploaded, but the live
site is not cross-origin isolated") — the files are already live, so fix the server headers.

By hand:

```bash
curl -sI https://test.1ink.us/xm-player/index.html | grep -i cross-origin
```

## External dependencies at runtime

| # | Resource | Origin | Under `require-corp` |
|---|----------|--------|----------------------|
| 1 | `index-*.js` / `index-*.css` (React is bundled into `react-vendor`) | Same-origin | Fine |
| 2 | `/xm-player/worklets/libopenmpt-worklet.{js,wasm}` | Same-origin | Fine. Self-hosted real-WASM libopenmpt — main-thread `<script>`, parser worker and AudioWorklet all use it (ship both files; `.wasm` as `application/wasm`) |
| 3 | `/xm-player/worklets/*.js` | Same-origin | Fine. AudioWorklet processors (+ the playback pair on an isolated page) |
| 4 | Bezel / button / lens-cap textures, shader thumbnails | Same-origin or `data:` | Fine |
| 5 | Catalog API `storage.noahcohn.com/api/mods`, `/api/shaders` | Cross-origin, CORS `fetch()` | Fine: the server echoes the origin with `allow-credentials: true` |
| 6 | Module files `storage.noahcohn.com/files/mods/*` | Cross-origin | Fine: `ACAO: *` and `CORP: cross-origin` |
| 7 | Remote media via `?media=<url>` | Any https host | Loads only if the host sends CORS (we request it with `crossorigin="anonymous"`, `mediaCrossOrigin` in `utils/remoteMedia.ts`) or `CORP: cross-origin`. Otherwise the app shows "This host doesn't allow embedding (needs CORS or CORP)". Local files are `blob:` URLs and unaffected |

There is no esm.sh or other CDN dependency any more (the dead importmap and preconnect were removed
from `index.html`). Any new cross-origin `<img>` / `<video>` / `<iframe>` needs `crossorigin` plus
CORS, or CORP, from its host.

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
