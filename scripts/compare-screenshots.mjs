#!/usr/bin/env node
/**
 * Compare two sets of shader screenshots and generate an HTML diff report.
 *
 * Usage:
 *   # After capturing "before" and "after" screenshots:
 *   node scripts/compare-screenshots.mjs \
 *     --before ./screenshots/before \
 *     --after  ./screenshots/after \
 *     --out    ./screenshots/diff-report.html
 *
 * If --before is omitted, the script looks for reference images in
 * ./screenshots/reference/ (or creates placeholder instructions).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BEFORE_DIR = process.argv.includes('--before')
  ? process.argv[process.argv.indexOf('--before') + 1]
  : path.join(__dirname, '..', 'screenshots', 'reference');

const AFTER_DIR = process.argv.includes('--after')
  ? process.argv[process.argv.indexOf('--after') + 1]
  : path.join(__dirname, '..', 'screenshots');

const OUT_FILE = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : path.join(__dirname, '..', 'screenshots', 'diff-report.html');

function fileSizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function computeDiff(beforePath, afterPath) {
  if (!fs.existsSync(beforePath)) return { status: 'missing_before', beforeSize: 0, afterSize: 0 };
  if (!fs.existsSync(afterPath)) return { status: 'missing_after', beforeSize: 0, afterSize: 0 };

  const beforeBuf = fs.readFileSync(beforePath);
  const afterBuf = fs.readFileSync(afterPath);

  if (beforeBuf.length !== afterBuf.length) {
    return {
      status: 'size_diff',
      beforeSize: beforeBuf.length,
      afterSize: afterBuf.length,
    };
  }

  let diffBytes = 0;
  for (let i = 0; i < beforeBuf.length; i++) {
    if (beforeBuf[i] !== afterBuf[i]) diffBytes++;
  }

  const diffPercent = (diffBytes / beforeBuf.length) * 100;

  if (diffBytes === 0) {
    return { status: 'identical', beforeSize: beforeBuf.length, afterSize: afterBuf.length, diffBytes, diffPercent };
  }

  // PNGs have headers and compression; small differences are usually OK
  const threshold = 2.0; // 2% pixel difference threshold
  if (diffPercent < threshold) {
    return { status: 'minor', beforeSize: beforeBuf.length, afterSize: afterBuf.length, diffBytes, diffPercent };
  }

  return { status: 'major', beforeSize: beforeBuf.length, afterSize: afterBuf.length, diffBytes, diffPercent };
}

function generateReport(results) {
  const rows = results.map(r => {
    const statusColor =
      r.status === 'identical' ? '#22c55e' :
      r.status === 'minor' ? '#eab308' :
      r.status === 'major' ? '#ef4444' : '#9ca3af';

    const statusLabel =
      r.status === 'identical' ? 'IDENTICAL' :
      r.status === 'minor' ? 'MINOR' :
      r.status === 'major' ? 'MAJOR' :
      r.status === 'missing_before' ? 'NO REFERENCE' :
      'MISSING';

    const beforeRel = r.beforePath ? path.relative(path.dirname(OUT_FILE), r.beforePath) : '';
    const afterRel = r.afterPath ? path.relative(path.dirname(OUT_FILE), r.afterPath) : '';

    return `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #333;font-family:monospace">${r.name}</td>
        <td style="padding:8px;border-bottom:1px solid #333;color:${statusColor};font-weight:bold">${statusLabel}</td>
        <td style="padding:8px;border-bottom:1px solid #333">${r.beforeSize ? fileSizeLabel(r.beforeSize) : '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #333">${r.afterSize ? fileSizeLabel(r.afterSize) : '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #333">${r.diffPercent !== undefined ? r.diffPercent.toFixed(3) + '%' : '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #333">
          ${beforeRel ? `<a href="${beforeRel}" target="_blank">before</a>` : '-'}
          ${afterRel ? ` / <a href="${afterRel}" target="_blank">after</a>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Shader Visual Diff Report</title>
  <style>
    body { background: #0f0f0f; color: #e5e5e5; font-family: system-ui, sans-serif; padding: 24px; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    p { color: #a3a3a3; margin-top: 0; }
    table { border-collapse: collapse; width: 100%; margin-top: 16px; }
    th { text-align: left; padding: 8px; border-bottom: 2px solid #444; font-size: 0.85rem; text-transform: uppercase; color: #a3a3a3; }
    a { color: #60a5fa; }
    .summary { display: flex; gap: 16px; margin: 16px 0; }
    .badge { padding: 6px 12px; border-radius: 6px; font-size: 0.85rem; font-weight: 600; }
    .badge.ok { background: #14532d; color: #86efac; }
    .badge.warn { background: #422006; color: #fde047; }
    .badge.fail { background: #450a0a; color: #fca5a5; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-top: 32px; }
    .card { background: #1a1a1a; border-radius: 8px; padding: 12px; }
    .card h3 { margin: 0 0 8px; font-size: 0.9rem; }
    .card img { width: 100%; border-radius: 4px; display: block; }
    .card .label { font-size: 0.75rem; color: #888; margin-top: 4px; }
  </style>
</head>
<body>
  <h1>🔍 Shader Visual Diff Report</h1>
  <p>Before: ${BEFORE_DIR} &nbsp;|&nbsp; After: ${AFTER_DIR}</p>

  <div class="summary">
    ${results.filter(r => r.status === 'identical').length > 0 ? `<span class="badge ok">${results.filter(r => r.status === 'identical').length} Identical</span>` : ''}
    ${results.filter(r => r.status === 'minor').length > 0 ? `<span class="badge warn">${results.filter(r => r.status === 'minor').length} Minor</span>` : ''}
    ${results.filter(r => r.status === 'major').length > 0 ? `<span class="badge fail">${results.filter(r => r.status === 'major').length} Major</span>` : ''}
    ${results.filter(r => r.status === 'missing_before' || r.status === 'missing_after').length > 0 ? `<span class="badge fail">${results.filter(r => r.status === 'missing_before' || r.status === 'missing_after').length} Missing</span>` : ''}
  </div>

  <table>
    <tr>
      <th>Shader</th>
      <th>Status</th>
      <th>Before</th>
      <th>After</th>
      <th>Diff</th>
      <th>Links</th>
    </tr>
    ${rows}
  </table>

  <div class="gallery">
    ${results.filter(r => r.afterPath).map(r => {
      const afterRel = path.relative(path.dirname(OUT_FILE), r.afterPath);
      const beforeRel = r.beforePath ? path.relative(path.dirname(OUT_FILE), r.beforePath) : null;
      return `
        <div class="card">
          <h3>${r.name}</h3>
          <img src="${afterRel}" alt="${r.name}">
          ${beforeRel ? `<div class="label">Hover to compare with reference (open both links above)</div>` : `<div class="label">No reference image</div>`}
        </div>
      `;
    }).join('')}
  </div>
</body>
</html>`;
}

function main() {
  console.log('\n🔍 Screenshot Comparison\n');
  console.log(`   Before: ${BEFORE_DIR}`);
  console.log(`   After:  ${AFTER_DIR}`);
  console.log(`   Report: ${OUT_FILE}`);
  console.log();

  if (!fs.existsSync(AFTER_DIR)) {
    console.error(`❌ After directory does not exist: ${AFTER_DIR}`);
    console.error('   Run: node scripts/capture-shader-screenshots.mjs');
    process.exit(1);
  }

  const afterFiles = fs.readdirSync(AFTER_DIR).filter(f => f.endsWith('.png'));
  const results = [];

  for (const file of afterFiles.sort()) {
    const name = file.replace('.png', '');
    const beforePath = path.join(BEFORE_DIR, file);
    const afterPath = path.join(AFTER_DIR, file);
    const diff = computeDiff(beforePath, afterPath);
    results.push({ name, beforePath: fs.existsSync(beforePath) ? beforePath : null, afterPath, ...diff });
  }

  // Also check for before files that have no after counterpart
  if (fs.existsSync(BEFORE_DIR)) {
    const beforeFiles = fs.readdirSync(BEFORE_DIR).filter(f => f.endsWith('.png'));
    for (const file of beforeFiles.sort()) {
      const name = file.replace('.png', '');
      if (!afterFiles.includes(file)) {
        results.push({
          name,
          beforePath: path.join(BEFORE_DIR, file),
          afterPath: null,
          status: 'missing_after',
          beforeSize: fs.statSync(path.join(BEFORE_DIR, file)).size,
          afterSize: 0,
        });
      }
    }
  }

  const html = generateReport(results);
  fs.writeFileSync(OUT_FILE, html, 'utf-8');

  const identical = results.filter(r => r.status === 'identical').length;
  const minor = results.filter(r => r.status === 'minor').length;
  const major = results.filter(r => r.status === 'major').length;
  const missing = results.filter(r => r.status === 'missing_before' || r.status === 'missing_after').length;

  console.log(`Results:`);
  console.log(`  ✅ Identical: ${identical}`);
  console.log(`  ⚠️  Minor:     ${minor}`);
  console.log(`  ❌ Major:     ${major}`);
  console.log(`  ❓ Missing:   ${missing}`);
  console.log();
  console.log(`Report written to: ${OUT_FILE}`);
  console.log(`Open it in a browser to inspect.\n`);

  if (major > 0 || missing > 0) {
    process.exit(1);
  }
}

main();
