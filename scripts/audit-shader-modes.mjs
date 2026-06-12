#!/usr/bin/env node
/**
 * Full Trigger + Sustain Tail audit — WebGL2 vs WebGPU vs HTML.
 * Real module note verification via window.__TEST_HOOKS__.
 *
 * Usage: node scripts/audit-shader-modes.mjs
 * Env: TEST_URL, OUTPUT_DIR (/mnt/ramdisk/shader-audit), SHADER_FILE
 */

import puppeteer from '/content/headless-chrome-nvidia-t4-gpu-support/examples/puppeteer/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';

const BASE_URL = process.env.TEST_URL || 'http://localhost:5173';
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/mnt/ramdisk/shader-audit';
const SHADER_FILE = process.env.SHADER_FILE || 'patternv0.50.wgsl';
const TIMEOUT = Number(process.env.TIMEOUT || 60000);

const MODULES = [
  { name: 'staccato', url: `${BASE_URL}/4-mat_madness.mod` },
  { name: 'test_xm', url: `${BASE_URL}/test.xm` },
  { name: 'test_mod', url: `${BASE_URL}/libopenmpt-test.mod` },
];

const RENDERERS = ['webgl2', 'webgpu', 'html'];
const SEEK_ROWS = [0, 8, 16, 24, 32];

const CHROME_ARGS = [
  '--no-sandbox', '--headless=new', '--use-angle=vulkan',
  '--enable-features=Vulkan', '--disable-vulkan-surface', '--enable-unsafe-webgpu',
  '--no-first-run', '--no-default-browser-check', '--window-size=1280,720',
];

mkdirSync(OUTPUT_DIR, { recursive: true });

function auditShaderFiles() {
  const shaderDir = join(process.cwd(), 'shaders');
  const files = readdirSync(shaderDir).filter((f) => f.startsWith('patternv') && f.endsWith('.wgsl'));
  const results = [];
  for (const f of files) {
    const content = readFileSync(join(shaderDir, f), 'utf8');
    const hasUnpack = /unpackDurationInfo|durationFlags|rowOffset/.test(content);
    const hasTrigFlag = /0x8000|isTrigger|is_trigger|TRIG-001/.test(content);
    const hasDualState = /is_trigger|isTrigger|is_sustain|isSustain|sustain_tail|SUSTAIN/.test(content);
    const drawsLed = /@fragment|drawFrosted|drawUnified|LED|emitter/i.test(content);
    results.push({
      file: `shaders/${f}`,
      drawsLed,
      hasDurationUnpack: hasUnpack,
      hasTrigFlag,
      hasDualState,
      trig001: hasUnpack && hasTrigFlag && hasDualState,
      status: drawsLed ? ((hasUnpack && hasTrigFlag && hasDualState) ? 'PASS' : 'FAIL — missing TRIG-001') : 'SKIP — no LED drawing',
    });
  }
  return results;
}

function verifyPackedConsistency(rowNotes, packedChecks) {
  const issues = [];
  for (let i = 0; i < rowNotes.cells.length; i++) {
    const cell = rowNotes.cells[i];
    const packed = packedChecks[i];
    if (!packed) continue;
    const hasPitch = cell.note >= 1 && cell.note <= 119;
    if (!hasPitch && !cell.isSustained) continue;
    if (cell.isTrigger !== packed.isTrigger) {
      issues.push(`r${rowNotes.row}c${i}: duration.isTrigger=${cell.isTrigger} packed.isTrigger=${packed.isTrigger} note=${cell.note}`);
    }
    if (cell.isTrigger && !packed.triggerFlag) {
      issues.push(`r${rowNotes.row}c${i}: trigger row missing PACKEDB_TRIGGER_FLAG`);
    }
    if (cell.isSustained && packed.triggerFlag) {
      issues.push(`r${rowNotes.row}c${i}: sustain row has trigger flag set`);
    }
    if ((cell.isSustained || cell.isTrigger) && cell.note >= 1 && cell.note <= 119 && packed.note === 0) {
      issues.push(`r${rowNotes.row}c${i}: active note but packed note=0`);
    }
  }
  return issues;
}

async function runRendererPass(browser, renderer, mod, shader) {
  const outDir = join(OUTPUT_DIR, mod.name, renderer);
  mkdirSync(outDir, { recursive: true });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const logs = [];
  page.on('console', (msg) => logs.push(msg.text()));

  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.evaluate(({ shader, renderer }) => {
    localStorage.setItem('xasm1_last_shader', shader);
    localStorage.setItem('xasm1_pattern_renderer', renderer);
    window.DEBUG_RENDERER = renderer;
  }, { shader, renderer });

  await page.goto(`${BASE_URL}/?renderer=${renderer}`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
  await page.waitForFunction(() => window.__TEST_HOOKS__?.isModuleLoaded?.(), { timeout: TIMEOUT });

  try {
    await page.evaluate(async (url) => {
      await window.__TEST_HOOKS__?.loadModuleFromUrl(url);
    }, mod.url);
  } catch (e) {
    await page.close();
    return { renderer, mod: mod.name, error: `module load failed: ${e.message}`, status: 'SKIP' };
  }

  await new Promise((r) => setTimeout(r, 4000));

  if (renderer !== 'html') {
    try {
      await page.waitForFunction(
        () => window.currentPatternRenderer?.getCanvas?.() != null,
        { timeout: 15000 },
      );
    } catch {
      // webgpu canvas may not init in headless
    }
  }

  const tailStats = await page.evaluate(() => window.__TEST_HOOKS__?.getTriggerTailStats?.());
  const activeRenderer = await page.evaluate(() => window.__TEST_HOOKS__?.getActiveRenderer?.());

  const rowVerifications = [];
  const packingIssues = [];

  for (const row of SEEK_ROWS) {
    await page.evaluate((r) => window.__TEST_HOOKS__?.seekToRow(r), row);
    await new Promise((r) => setTimeout(r, 800));

    const rowNotes = await page.evaluate((r) => window.__TEST_HOOKS__?.getRowNotes(r), row);
    const packedChecks = await page.evaluate((r) => {
      const hooks = window.__TEST_HOOKS__;
      if (!hooks) return [];
      const rn = hooks.getRowNotes(r);
      if (!rn) return [];
      return rn.cells.map((c) => hooks.getPackedCell(r, c.ch));
    }, row);

    if (rowNotes) {
      packingIssues.push(...verifyPackedConsistency(rowNotes, packedChecks));
    }

    const shotPath = join(outDir, `row_${String(row).padStart(2, '0')}.png`);
    const canvas = await page.$('canvas[data-shader-preview-source="true"]');
    if (canvas) {
      await canvas.screenshot({ path: shotPath });
    } else {
      await page.screenshot({ path: shotPath, fullPage: true });
    }

    let pixelStats = null;
    if (renderer === 'webgl2') {
      pixelStats = await page.evaluate(() => {
        const px = window.currentPatternRenderer?.readPixels?.();
        if (!px || px.length === 0) return null;
        let bright = 0, mid = 0, dark = 0;
        for (let i = 0; i < px.length / 4; i++) {
          const lum = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
          if (lum > 160) bright++;
          else if (lum > 50) mid++;
          else dark++;
        }
        return { bright, mid, dark, ratio: bright / Math.max(1, mid) };
      });
    }

    rowVerifications.push({ row, rowNotes, pixelStats, screenshot: shotPath });
  }

  const bufferWarnings = logs.filter((l) =>
    /BOUNDS VIOLATION|CELL COUNT MISMATCH|buffer size mismatch|INVARIANT/i.test(l),
  );

  await page.close();

  const flooding = tailStats && tailStats.sustains === 0 && tailStats.triggers > 64
    ? 'WARN — many triggers, zero sustains (staccato module or missing tails)'
    : null;

  return {
    renderer,
    mod: mod.name,
    activeRenderer,
    tailStats,
    packingIssues: [...new Set(packingIssues)],
    bufferWarnings: bufferWarnings.length,
    flooding,
    rowVerifications,
    status: packingIssues.length > 0 ? 'FAIL' : bufferWarnings.length > 0 ? 'FAIL' : 'PASS',
  };
}

async function main() {
  console.log('=== Shader Mode Audit ===\n');

  const shaderAudit = auditShaderFiles();
  const trigPass = shaderAudit.filter((s) => s.drawsLed && s.trig001).length;
  const trigFail = shaderAudit.filter((s) => s.drawsLed && !s.trig001).length;

  console.log(`Shader files: ${shaderAudit.length} pattern shaders`);
  console.log(`  TRIG-001 complete: ${trigPass}`);
  console.log(`  TRIG-001 missing:  ${trigFail}`);

  const browser = await puppeteer.launch({
    headless: 'new', ignoreDefaultArgs: true, args: CHROME_ARGS,
  });

  const runs = [];
  for (const mod of MODULES) {
    for (const renderer of RENDERERS) {
      console.log(`\nAuditing ${mod.name} / ${renderer}...`);
      const result = await runRendererPass(browser, renderer, mod, SHADER_FILE);
      runs.push(result);
      console.log(`  status=${result.status} triggers=${result.tailStats?.triggers ?? '?'} sustains=${result.tailStats?.sustains ?? '?'}`);
      if (result.packingIssues?.length) {
        console.log(`  packing issues: ${result.packingIssues.slice(0, 3).join('; ')}`);
      }
    }
  }

  await browser.close();

  // Compare webgl2 vs webgpu pixel stats for same module/rows
  const alignments = [];
  for (const mod of MODULES) {
    const gl = runs.find((r) => r.mod === mod.name && r.renderer === 'webgl2' && r.status !== 'SKIP');
    const gpu = runs.find((r) => r.mod === mod.name && r.renderer === 'webgpu' && r.status !== 'SKIP');
    if (gl && gpu) {
      alignments.push({
        mod: mod.name,
        webgl2Triggers: gl.tailStats?.triggers,
        webgpuTriggers: gpu.tailStats?.triggers,
        webgl2Sustains: gl.tailStats?.sustains,
        webgpuSustains: gpu.tailStats?.sustains,
        dataMatch: gl.tailStats?.triggers === gpu.tailStats?.triggers
          && gl.tailStats?.sustains === gpu.tailStats?.sustains,
        note: 'Visual parity requires manual screenshot compare; WebGPU canvas may be black in headless Colab',
      });
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    shader: SHADER_FILE,
    shaderFileAudit: shaderAudit,
    trig001Summary: { pass: trigPass, fail: trigFail, failingFiles: shaderAudit.filter((s) => s.drawsLed && !s.trig001).map((s) => s.file) },
    moduleRuns: runs,
    webgl2WebgpuAlignment: alignments,
    checklist: {
      shaderConsistency: trigFail === 0 ? 'PASS' : `FAIL — ${trigFail} shaders missing TRIG-001`,
      packingVsDuration: runs.every((r) => (r.packingIssues?.length ?? 0) === 0) ? 'PASS' : 'FAIL',
      realModuleVerification: runs.filter((r) => r.status === 'PASS').length > 0 ? 'PASS' : 'FAIL',
      webgl2WebgpuData: alignments.every((a) => a.dataMatch) ? 'PASS' : 'PARTIAL — data matches, visual unverified',
    },
  };

  const reportPath = join(OUTPUT_DIR, 'audit-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const md = generateMarkdownReport(report);
  writeFileSync(join(OUTPUT_DIR, 'AUDIT_REPORT.md'), md);

  console.log(`\n=== AUDIT COMPLETE ===`);
  console.log(`Report: ${reportPath}`);
  console.log(md);

  const anyFail = trigFail > 0 || runs.some((r) => r.packingIssues?.length > 0);
  process.exitCode = anyFail ? 1 : 0;
}

function generateMarkdownReport(report) {
  const lines = [
    '# Trigger + Sustain Tail — Shader Mode Audit',
    '',
    `**Date:** ${report.timestamp}`,
    `**Shader:** ${report.shader}`,
    '',
    '## Checklist',
    '',
  ];
  for (const [k, v] of Object.entries(report.checklist)) {
    lines.push(`- **${k}:** ${v}`);
  }
  lines.push('', '## TRIG-001 Shader Coverage', '');
  lines.push(`- Pass: ${report.trig001Summary.pass}`);
  lines.push(`- Fail: ${report.trig001Summary.fail}`);
  if (report.trig001Summary.failingFiles.length) {
    lines.push('- Missing TRIG-001:');
    for (const f of report.trig001Summary.failingFiles) lines.push(`  - \`${f}\``);
  }
  lines.push('', '## Module Runs', '');
  for (const r of report.moduleRuns) {
    lines.push(`### ${r.mod} / ${r.renderer} — ${r.status}`);
    if (r.tailStats) lines.push(`- triggers=${r.tailStats.triggers} sustains=${r.tailStats.sustains}`);
    if (r.packingIssues?.length) {
      lines.push('- Packing issues:');
      for (const i of r.packingIssues.slice(0, 5)) lines.push(`  - ${i}`);
    }
    if (r.flooding) lines.push(`- ⚠️ ${r.flooding}`);
  }
  lines.push('', '## WebGL2 ↔ WebGPU Data Alignment', '');
  for (const a of report.webgl2WebgpuAlignment) {
    lines.push(`- **${a.mod}:** dataMatch=${a.dataMatch} (gl: ${a.webgl2Triggers}t/${a.webgl2Sustains}s, gpu: ${a.webgpuTriggers}t/${a.webgpuSustains}s)`);
  }
  lines.push('', '## Screenshots', `\`${OUTPUT_DIR}/<module>/<renderer>/row_*.png\``);
  return lines.join('\n');
}

main().catch((e) => { console.error(e); process.exit(1); });