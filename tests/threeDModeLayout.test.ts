import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('3D mode layout invariant (WebGPU teardown fix — Problem A)', () => {
  const appTsx = readFileSync(join(ROOT, 'App.tsx'), 'utf8');
  const mainLayout = readFileSync(join(ROOT, 'components/MainLayout.tsx'), 'utf8');
  const chromeLayout = readFileSync(join(ROOT, 'components/ChromeLayout.tsx'), 'utf8');
  const performanceStage = readFileSync(join(ROOT, 'components/PerformanceStage.tsx'), 'utf8');
  const app3DView = readFileSync(join(ROOT, 'components/App3DView.tsx'), 'utf8');

  it('does not early-return App3DModeShell in place of MainLayout on is3DMode', () => {
    expect(appTsx).not.toMatch(/is3DMode\s*&&\s*!IS_PUBLIC_MODE\s*\)\s*\{\s*return/);
    expect(appTsx).not.toMatch(/if\s*\(\s*is3DMode[^)]*\)\s*\{\s*return\s*\(/);
  });

  it('always renders MainLayout regardless of is3DMode', () => {
    expect(appTsx).toContain('<MainLayout');
    // App3DModeShell must appear as a sibling condition, not a returned branch.
    expect(appTsx).toMatch(/is3DMode\s*&&\s*!IS_PUBLIC_MODE\s*&&\s*\(/);
  });

  it('keeps PerformanceStage at a fixed sibling index regardless of 3D mode', () => {
    expect(mainLayout).not.toContain('<PerformanceStage');
    expect(mainLayout).toContain('<ChromeLayout');
    expect(chromeLayout).toContain('<PerformanceStage');
  });

  it('does not construct a second PatternDisplay in the 3D view', () => {
    expect(app3DView).not.toMatch(/<PatternDisplay/);
    expect(app3DView).not.toMatch(/import\s*\{[^}]*\bPatternDisplay\b[^}]*\}\s*from/);
  });

  it('PerformanceStage portals its single PatternDisplay instance instead of remounting it', () => {
    expect(performanceStage).toContain('createPortal');
    expect(performanceStage).toContain('<PatternDisplay');
    // The portal container must be a stable value (not re-created inline on
    // every render), or createPortal would remount PatternDisplay on toggle.
    expect(performanceStage).toMatch(/useState<HTMLDivElement>\(\(\) => \{/);
  });
});
