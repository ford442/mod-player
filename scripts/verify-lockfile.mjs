#!/usr/bin/env node
/**
 * Lockfile metadata guard — asserts only what npm's own validation skips.
 *
 * The dependency-graph check is `npm ci --dry-run --ignore-scripts`: it already
 * catches a deleted `packages[]` subtree (the 65c0885 incident) in ~2s, offline, and
 * names the exact missing specifier. Do not reimplement it here.
 *
 * What npm does NOT catch (all three pass `npm ci --dry-run` and `npm ls` silently):
 *   - a wrong `lockfileVersion`
 *   - an entry missing `resolved`
 *   - an entry missing `integrity`
 *
 * Usage:
 *   node scripts/verify-lockfile.mjs [path/to/package-lock.json]
 */
import { existsSync, readFileSync } from 'node:fs';

const EXPECTED_LOCKFILE_VERSION = 3;

const lockPath = process.argv[2] || 'package-lock.json';

if (!existsSync(lockPath)) {
  console.error(`verify-lockfile: missing ${lockPath}`);
  process.exit(1);
}

let lock;
try {
  lock = JSON.parse(readFileSync(lockPath, 'utf8'));
} catch (err) {
  console.error(`verify-lockfile: ${lockPath} is not valid JSON: ${err.message}`);
  process.exit(1);
}

const errors = [];

if (lock.lockfileVersion !== EXPECTED_LOCKFILE_VERSION) {
  errors.push(
    `lockfileVersion is ${JSON.stringify(lock.lockfileVersion)}, expected ` +
      `${EXPECTED_LOCKFILE_VERSION} (change it deliberately, not by accident)`,
  );
}

const packages = lock.packages;
if (packages === undefined || packages === null || typeof packages !== 'object' || Array.isArray(packages)) {
  errors.push('packages{} is missing or not an object');
} else {
  for (const [path, entry] of Object.entries(packages)) {
    // The root project entry has no registry tarball; `link: true` entries point at a local dir.
    if (path === '' || !entry || typeof entry !== 'object') continue;
    if (entry.link === true) continue;
    for (const field of ['resolved', 'integrity']) {
      if (typeof entry[field] !== 'string' || entry[field] === '') {
        errors.push(`packages["${path}"] is missing ${field}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`verify-lockfile FAILED for ${lockPath}:`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    `\nHint: regenerate with \`npm install\` rather than hand-editing ${lockPath}.`,
  );
  process.exit(1);
}

const count = packages ? Object.keys(packages).length : 0;
console.log(
  `verify-lockfile OK: ${lockPath} is lockfileVersion ${EXPECTED_LOCKFILE_VERSION}; ` +
    `${count} packages[] entries have resolved + integrity`,
);
