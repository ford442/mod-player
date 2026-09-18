import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const SKIP_DIRS = new Set(['node_modules', '.git', 'tests', 'archive', 'dist', 'public']);

// lstatSync (not statSync) + explicit isSymbolicLink skip — the repo has a
// self-referential CodeQL artifact symlink (see CLAUDE.md pitfall #6); Vite's
// watcher works around it with followSymlinks: false, so this walker must too.
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      collectSourceFiles(full, out);
    } else if (extname(entry) === '.ts' || extname(entry) === '.tsx') {
      out.push(relative(ROOT, full));
    }
  }
  return out;
}

/** Matches a real `requestAdapter(...)`/`requestDevice(...)` call, not a comment or an unrelated API like `adapter.requestAdapterInfo()`. */
const REAL_CALL = /\b(?:navigator\.gpu\.requestAdapter|\w+\.requestDevice)\s*\(/;

describe('WebGPU device ownership (Problem B — single requestAdapter/requestDevice owner)', () => {
  const files = collectSourceFiles(ROOT);

  it('utils/webgpuDevice.ts is the only production module that calls requestAdapter/requestDevice', () => {
    const callers = files.filter((f) => {
      if (f === 'utils/webgpuDevice.ts') return false;
      const src = readFileSync(join(ROOT, f), 'utf8');
      return REAL_CALL.test(src);
    });
    expect(callers).toEqual([]);
  });

  it('webgpuDevice.ts itself still owns the real call sites', () => {
    const src = readFileSync(join(ROOT, 'utils/webgpuDevice.ts'), 'utf8');
    expect(REAL_CALL.test(src)).toBe(true);
  });

  it('rendererSelection.ts probe no longer requests its own adapter', () => {
    const src = readFileSync(join(ROOT, 'src/renderers/rendererSelection.ts'), 'utf8');
    expect(src).not.toMatch(REAL_CALL);
    expect(src).toContain('peekInFlightWebGPUDeviceRequest');
  });

  it('deviceCapabilities.ts no longer requests its own adapter', () => {
    const src = readFileSync(join(ROOT, 'utils/deviceCapabilities.ts'), 'utf8');
    expect(src).not.toMatch(REAL_CALL);
    expect(src).toContain('peekAdapterInfoForCapabilityHint');
  });
});

describe('WebGPU canvas configuration (Problem C — probe/runtime share one config)', () => {
  const src = readFileSync(join(ROOT, 'utils/webgpuDevice.ts'), 'utf8');

  it('probeWebGPUCanvasPresentation configures through configureCanvasContext, not a hand-rolled config', () => {
    const probeStart = src.indexOf('export async function probeWebGPUCanvasPresentation');
    const probeEnd = src.indexOf('\nexport function configureCanvasContext');
    expect(probeStart).toBeGreaterThan(-1);
    expect(probeEnd).toBeGreaterThan(probeStart);
    const probeBody = src.slice(probeStart, probeEnd);
    expect(probeBody).toContain('configureCanvasContext(');
    expect(probeBody).not.toContain("alphaMode: 'opaque'");
  });
});
