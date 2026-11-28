# Dependency advisories

`npm audit` (all dependencies) reports **0 vulnerabilities** as of 2026-11-28. Nothing is accepted.

## How it got there (#561)

| Advisory | Package | Where | Fix |
|---|---|---|---|
| GHSA-mrhx-c7xc-m3w5 (high) | `zod` < 4.6.6 | **production** (bundled) | `zod` 4.4.3 → 4.6.7 (in `package.json`) |
| 12 advisories | `@typescript-eslint/*`, `vitest` / `@vitest/mocker`, `minimatch`, `js-yaml`, `nanoid`, `source-map-js`, `brace-expansion` 5.x, … | dev tooling only | `npm audit fix` (non-breaking, lockfile only) |
| GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p (high) | `brace-expansion` 1.1.18 | dev: ESLint → `minimatch@3` | `overrides` below |
| GHSA-rj75-hqrm-r3gf (moderate) | `postcss-selector-parser` 6.0.10 | build time: `@tailwindcss/typography` pins it exactly | `overrides` below |

`npm audit fix` crashes in npm 10.9.9 (`Cannot read properties of null (reading 'edgesOut')`); npm 11 runs it
(`npx npm@11 audit fix`). `npm audit fix --force` would have *downgraded* `@tailwindcss/typography` to 0.5.4, which
is not a fix, so it was not used.

## `overrides` in package.json

```json
"overrides": {
  "minimatch@3": { "brace-expansion": "^1.1.22" },
  "@tailwindcss/typography": { "postcss-selector-parser": "^6.1.6" }
}
```

Both only raise a transitive dependency to a patched release of the **same major** that its parent already uses;
neither parent has a release that does it itself. Neither package is in the shipped bundle.

Remove an override when its parent releases a version that depends on a patched child (check with
`npm ls brace-expansion postcss-selector-parser`), then `npm install` and confirm `npm audit` stays at 0.

Regenerate the lockfile with `npm install`, never by hand (`npm run verify:lockfile` guards its shape).
