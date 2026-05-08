#!/usr/bin/env node
/**
 * Capture screenshots of every active shader for visual regression testing.
 *
 * Usage:
 *   npm run dev &
 *   node scripts/capture-shader-screenshots.mjs [--out ./screenshots] [--quick]
 *
 * Options:
 *   --out <dir>   Output directory (default: ./screenshots)
 *   --quick       Only capture 4 key shaders instead of all 18
 *   --url <url>   Dev server URL (default: http://localhost:5174/)
 *
 * Requirements:
 *   - Dev server must be running with a MOD file loaded
 *   - Playwright must be installed (npm install playwright)
 *   - Chrome must support WebGPU (--enable-unsafe-webgpu)
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : (process.env.TEST_URL || 'http://localhost:5174/');

const OUT_DIR = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : path.join(__dirname, '..', 'screenshots');

const QUICK = process.argv.includes('--quick');

// Match the SHADER_GROUPS from App.tsx
const SHADER_GROUPS = {
  SQUARE: [
    'patternv0.44.wgsl',
    'patternv0.43.wgsl',
    'patternv0.40.wgsl',
    'patternv0.39.wgsl',
    'patternv0.21.wgsl',
  ],
  CIRCULAR: [
    'patternv0.50.wgsl',
    'patternv0.49.wgsl',
    'patternv0.48.wgsl',
    'patternv0.47.wgsl',
    'patternv0.46.wgsl',
    'patternv0.45.wgsl',
    'patternv0.45b.wgsl',
    'patternv0.42.wgsl',
    'patternv0.38.wgsl',
    'pattern_bloom.wgsl',
    'patternv0.35_bloom.wgsl',
    'patternv0.30.wgsl',
  ],
  VIDEO: [
    'patternv0.23.wgsl',
    'patternv0.24.wgsl',
  ],
};

const QUICK_SHADERS = [
  'patternv0.51.wgsl',
  'pattern_bloom.wgsl',
  'patternv0.44.wgsl',
  'patternv0.50.wgsl',
];

const ALL_SHADERS = [
  ...SHADER_GROUPS.SQUARE,
  ...SHADER_GROUPS.CIRCULAR,
  ...SHADER_GROUPS.VIDEO,
];

async function captureShader(page, shaderFile, outDir) {
  console.log(`  📸 ${shaderFile}`);

  // Switch shader via the dropdown
  // We use page.evaluate to manipulate React state directly
  // This is faster than clicking through UI
  await page.evaluate((shader) => {
    // Find the select element that controls the shader
    const selects = Array.from(document.querySelectorAll('select'));
    const shaderSelect = selects.find(s =>
      Array.from(s.options).some(o => o.value.includes('pattern'))
    );
    if (shaderSelect) {
      shaderSelect.value = shader;
      shaderSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, shaderFile);

  // Wait for shader switch + render stabilization
  await page.waitForTimeout(3000);

  // Pause playback to freeze the playhead for consistent screenshots
  await page.evaluate(() => {
    const pauseBtn = document.querySelector('button');
    if (pauseBtn) pauseBtn.click();
  });
  await page.waitForTimeout(500);

  // Capture the WebGPU canvas
  const canvas = await page.$('canvas');
  if (!canvas) {
    console.log(`     ⚠️  No canvas found`);
    return false;
  }

  const safeName = shaderFile.replace(/[^a-zA-Z0-9._-]/g, '_');
  const screenshotPath = path.join(outDir, `${safeName}.png`);
  await canvas.screenshot({ path: screenshotPath, type: 'png' });
  return true;
}

async function run() {
  console.log('\n📸 Shader Screenshot Capture\n');
  console.log(`   URL:  ${TEST_URL}`);
  console.log(`   Out:  ${OUT_DIR}`);
  console.log(`   Mode: ${QUICK ? 'QUICK (4 shaders)' : 'FULL (18 shaders)'}`);
  console.log();

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--disable-gpu-sandbox',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  // Collect console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', err => errors.push(err.message));

  console.log('Navigating...');
  await page.goto(TEST_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Wait for app + libopenmpt + module load
  console.log('Waiting for initialization...');
  await page.waitForTimeout(8000);

  const shaders = QUICK ? QUICK_SHADERS : ALL_SHADERS;
  let captured = 0;
  let failed = 0;

  for (const shader of shaders) {
    try {
      const ok = await captureShader(page, shader, OUT_DIR);
      if (ok) captured++;
      else failed++;
    } catch (e) {
      console.log(`     ❌ Error: ${e.message}`);
      failed++;
    }
  }

  await browser.close();

  console.log();
  console.log(`✅ Captured: ${captured}`);
  if (failed > 0) console.log(`❌ Failed:   ${failed}`);
  if (errors.length > 0) {
    console.log(`\n⚠️  Console errors during capture:`);
    errors.slice(0, 10).forEach(e => console.log(`   ${e}`));
  }
  console.log(`\nScreenshots saved to: ${OUT_DIR}\n`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
