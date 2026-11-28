#!/usr/bin/env node
// check-served-assets.mjs <page-url> — every asset the page references must answer 200 with no redirect.
//
// Fetches the page, collects href/src/modulepreload targets (same-origin only), and requests each with
// redirect: 'manual'. A 404 or a 3xx (e.g. Apache's `/xm-player` -> `/xm-player/`, or a base-path slip that
// bounces to the host root) fails. Used by CI against `vite preview --base /xm-player/` for both profiles.
const pageUrl = process.argv[2];
if (!pageUrl) {
  console.error('usage: node scripts/check-served-assets.mjs <page-url>');
  process.exit(2);
}
const page = new URL(pageUrl);
const html = await (await fetch(page)).text();
const found = new Set();
for (const m of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
  const ref = m[1];
  if (/^(?:data:|mailto:|#|javascript:)/i.test(ref)) continue;
  const url = new URL(ref, page);
  if (url.origin !== page.origin) continue;
  found.add(url.href);
}
const extra = ['version.json', 'sw.js', 'manifest.json'].map((p) => new URL(p, page).href);
for (const u of extra) found.add(u);

let bad = 0;
for (const href of [...found].sort()) {
  const res = await fetch(href, { redirect: 'manual' });
  const ok = res.status === 200;
  if (!ok) {
    bad++;
    console.error(`✗ ${res.status} ${href}${res.headers.get('location') ? ` -> ${res.headers.get('location')}` : ''}`);
  }
}
if (bad) {
  console.error(`${bad} of ${found.size} referenced assets failed`);
  process.exit(1);
}
console.log(`✓ ${found.size} referenced assets all answered 200 without a redirect (${pageUrl})`);
