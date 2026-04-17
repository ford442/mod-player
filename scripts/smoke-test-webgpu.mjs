import { chromium } from 'playwright';

const TEST_URL = process.env.TEST_URL || 'http://localhost:5174/';
const TIMEOUT = 30000;

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--disable-gpu-sandbox',
    ],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push({ type: msg.type(), text });
    // Print in real-time so we can see progress
    console.log(`[${msg.type()}] ${text}`);
  });

  page.on('pageerror', err => {
    logs.push({ type: 'pageerror', text: err.message });
    console.error(`[pageerror] ${err.message}`);
  });

  console.log(`Navigating to ${TEST_URL}...`);
  await page.goto(TEST_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });

  // Wait for libopenmpt to initialize and module to load
  console.log('Waiting for app initialization...');
  await page.waitForTimeout(8000);

  // Look for any buffer/bounds warnings
  const warnings = logs.filter(l =>
    /BOUNDS VIOLATION|CELL COUNT MISMATCH|buffer size mismatch|INVARIANT/i.test(l.text)
  );

  // Look for gpuPacking log to confirm packing succeeded
  const packingLogs = logs.filter(l =>
    /packPatternMatrix|Packed .* notes/i.test(l.text)
  );

  // Check WebGPU availability
  const webgpuAvailable = await page.evaluate(() => 'gpu' in navigator);
  console.log(`WebGPU available: ${webgpuAvailable}`);

  // Try to find module info (channel count)
  const moduleInfo = await page.evaluate(() => {
    const el = document.querySelector('[class*="text-cyan-400"]');
    return el ? el.textContent : null;
  });
  console.log(`Module info element: ${moduleInfo}`);

  console.log('\n=== SUMMARY ===');
  console.log(`Total console messages: ${logs.length}`);
  console.log(`Packing logs: ${packingLogs.length}`);
  console.log(`Warnings/errors about buffer size: ${warnings.length}`);

  if (warnings.length > 0) {
    console.log('\n⚠️ BUFFER WARNINGS FOUND:');
    warnings.forEach(w => console.log(`  [${w.type}] ${w.text}`));
    process.exitCode = 1;
  } else {
    console.log('\n✅ No buffer-size warnings detected.');
  }

  await browser.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
