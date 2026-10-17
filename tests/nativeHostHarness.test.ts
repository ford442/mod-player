/**
 * #491: the native engine's thread safety is proven at runtime by a host build
 * of cpp/native_engine.cpp under ThreadSanitizer / ASan+UBSan plus an
 * allocation count (scripts/native-host-test.sh, cpp/host/). Those binaries
 * need a C++ toolchain, so vitest does not run them — this keeps the wiring
 * from silently rotting: CI must run the harness, the harness must keep its
 * acceptance-sized defaults and its negative control, and its libopenmpt
 * download must stay hash-pinned.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { corruptIt215Sample } from '../scripts/lib/corrupt-it.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('native host sanitizer harness (#491)', () => {
  const script = read('scripts/native-host-test.sh');
  const ci = read('.github/workflows/ci.yml');
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

  it('CI runs it on every cpp/ change', () => {
    expect(pkg.scripts['test:native-host']).toBe('bash scripts/native-host-test.sh');
    const job = ci.slice(ci.indexOf('  native-host-sanitizers:'));
    expect(job.length).toBeGreaterThan(100);
    expect(job).toContain("- 'cpp/**'");
    expect(job).toContain('run: npm run test:native-host');
  });

  it('runs all three flavours by default, at acceptance size', () => {
    expect(script).toContain('FLAVOURS=(tsan asan alloc)');
    expect(script).toMatch(/ITERATIONS="\$\{ITERATIONS:-1000\}"/);
    // libopenmpt is instrumented too, or races inside it would be invisible.
    expect(script).toMatch(/CXXFLAGS="\$flags" CFLAGS="\$flags"/);
  });

  it('fails unless TSan reports the deliberate race (the harness can see one)', () => {
    expect(script).toContain('negative-control');
    expect(script).toMatch(/rc -eq 66 \]\] && grep -q 'ThreadSanitizer: data race'/);
    const tests = read('cpp/host/engine_tests.cpp');
    expect(tests).toContain('int negativeControl(');
  });

  it('gets libopenmpt from the shared, sha256-pinned source (scripts/lib/libopenmpt-source.sh)', () => {
    expect(script).toContain('source "$SCRIPT_DIR/lib/libopenmpt-source.sh"');
    expect(script).toContain('libopenmpt_ensure_pristine "$VENDOR_ROOT"');
    // The host trees record which version they were built from.
    expect(script).toContain('.libopenmpt-version');
  });

  it('the corrupt-sample fixture is an IT 2.15 compressed sample with a short block', () => {
    const it = corruptIt215Sample();
    const dv = new DataView(it.buffer, it.byteOffset, it.byteLength);
    expect(new TextDecoder().decode(it.subarray(0, 4))).toBe('IMPM');
    const sampleHeader = dv.getUint32(0xc0 + 2 + 0, true); // first sample pointer after 2 orders
    expect(new TextDecoder().decode(it.subarray(sampleHeader, sampleHeader + 4))).toBe('IMPS');
    expect(it[sampleHeader + 0x12]! & 0x08).toBe(0x08); // compressed
    expect(it[sampleHeader + 0x2e]! & 0x04).toBe(0x04); // IT 2.15 delta
    const length = dv.getUint32(sampleHeader + 0x30, true);
    const data = dv.getUint32(sampleHeader + 0x48, true);
    const block = dv.getUint16(data, true);
    expect(block * 8).toBeLessThan(length); // fewer bits than samples: the decoder must run out
    expect(data + 2 + block).toBe(it.byteLength);
  });
});
