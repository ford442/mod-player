## Summary

The production build at `https://test.1ink.us/xm-player/` references a stylesheet with a **non-standard `.1iss` extension** and Apache serves it with an incorrect **`charset=utf-16`** header, despite the file content being UTF-8 CSS.

**Impact:** Low severity (page appears styled in Chrome during investigation), but non-standard artifacts can break CSS parsing in strict browsers, confuse caching/CDN tooling, and indicate a corrupted or stale build pipeline output.

**Investigation date:** 2026-06-17

---

## Evidence

### Production `index.html`

```html
<link rel="stylesheet" crossorigin href="./assets/modplayer.1iss">
```

Note: source `index.html` in the repo references `./index.css` (dev entry). Vite build normally emits hashed `assets/index-*.css`.

### HTTP headers (2026-06-17)

```bash
curl -sI https://test.1ink.us/xm-player/assets/modplayer.1iss
# content-type: text/css; charset=utf-16
# content-length: 39175
```

### File content

`file` / `xxd` inspection shows standard UTF-8 Tailwind-style CSS (`:root { --background: … }`), not UTF-16 LE/BE BOM content.

### Orphaned asset suspicion

The current JS bundle (`index-ofcsgdds.js`) may not import this CSS file — styles might be inlined in JS or the `.1iss` file is a **stale artifact** from an older build while the active bundle uses a different CSS strategy.

---

## Root Cause Analysis

### 1. Non-standard `.1iss` extension

Likely causes:

| Cause | Likelihood | Notes |
|-------|------------|-------|
| Corrupted content-hash in filename | Medium | Hash segment `.1iss` resembles garbled `.css` (character substitution) |
| Custom `rollupOptions.output.assetFileNames` typo | Low | Current `vite.config.ts` has **no** `assetFileNames` override |
| Manual/stale deploy artifact | High | `/assets/` contains 80+ historical `index-*.js` bundles (Nov 2025–Jun 2026) suggesting incomplete cleanup between deploys |
| Third-party build tool rename | Low | No `.1iss` references in current repo source |

The repo's current Vite config (`vite.config.ts`) uses defaults — a fresh `npm run build` should produce `dist/assets/index-<hash>.css`.

### 2. `charset=utf-16` header

Apache is mis-detecting encoding (possibly due to unusual filename/extension). Browsers may ignore the charset if no BOM is present, but this is spec-ambiguous and risky.

### 3. Dev vs production CSS path

| Context | CSS loading |
|---------|-------------|
| Dev | `<link href="./index.css">` processed by Vite + PostCSS/Tailwind |
| Production | Extracted CSS chunk linked from built `index.html` |

Verify post-build `dist/index.html` locally with `VITE_APP_BASE_PATH=/xm-player/ npm run build`.

---

## Reproduction

1. `curl -s https://test.1ink.us/xm-player/index.html | grep stylesheet`
2. `curl -sI https://test.1ink.us/xm-player/assets/modplayer.1iss`
3. Compare with local build: `VITE_APP_BASE_PATH=/xm-player/ npm run build && cat dist/index.html | grep stylesheet`

---

## Proposed Fix

### 1. Verify local build output

```bash
VITE_APP_BASE_PATH=/xm-player/ npm run build
grep -E 'stylesheet|\.css' dist/index.html
ls -la dist/assets/*.css
```

Confirm emitted extension is `.css` and `index.html` references match.

### 2. Fix deploy pipeline

- `deploy.py` zips entire `dist/` — ensure deploy **replaces** old assets or prunes stale `/assets/*` on server.
- Add deploy step: delete remote `assets/` before upload, or use versioned directory per release.

### 3. Fix Apache charset (server config)

For `.css` files under `/xm-player/assets/`:

```apache
<FilesMatch "\.css$">
  Header set Content-Type "text/css; charset=utf-8"
</FilesMatch>
```

Or remove erroneous `AddCharset utf-16` if present for this vhost.

### 4. Optional: explicit Vite asset naming

If deterministic names are needed for debugging:

```ts
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      assetFileNames: 'assets/[name]-[hash][extname]',
    },
  },
},
```

(`[extname]` must remain literal — a typo here could cause the `.1iss` symptom.)

### 5. Audit CSS inclusion

Confirm Tailwind/CSS is extracted (not silently dropped). Check `dist/assets/*.css` size ≈ production 39 KB.

---

## Files to Touch

| File | Change |
|------|--------|
| `vite.config.ts` | Optional explicit `assetFileNames`; verify `cssCodeSplit` |
| `deploy.py` | Prune stale assets on remote |
| Server/Apache vhost | Correct `Content-Type` charset for CSS |
| `index.css` / `postcss.config.js` | Only if CSS fails to emit |

---

## Acceptance Criteria

- [ ] Production stylesheet URL ends in `.css` (e.g. `assets/index-<hash>.css`).
- [ ] `Content-Type: text/css; charset=utf-8` (or omit charset; no `utf-16`).
- [ ] `index.html` `<link rel="stylesheet">` matches the CSS file present in the deployed bundle.
- [ ] No orphaned `modplayer.1iss` (or equivalent stale CSS) after deploy.
- [ ] Visual styling matches dev build (Tailwind theme variables, panel chrome, etc.).

---

## Additional Cleanup (same deploy pass)

Production `/assets/` contains 80+ stale `index-*.js` bundles. Add retention policy (keep last N hashes) to reduce disk use and cache confusion. See deployment hygiene issue.

---

## Related

- Deploy bundle uploads via `deploy.py` → `storage.noahcohn.com` → `test.1ink.us/xm-player/`
- Tailwind content paths are intentionally narrow in `tailwind.config.js` — unrelated but affects CSS size
