import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('#427 stageMode layout invariant', () => {
  const mainLayout = readFileSync(join(ROOT, 'components/MainLayout.tsx'), 'utf8');
  const chromeLayout = readFileSync(join(ROOT, 'components/ChromeLayout.tsx'), 'utf8');

  it('does not swap PerformanceStage vs ChromeLayout on stageMode', () => {
    expect(mainLayout).not.toMatch(/stageMode\s*\?\s*</);
    expect(mainLayout).not.toContain('<PerformanceStage');
    expect(mainLayout).toContain('<ChromeLayout');
  });

  it('keeps PerformanceStage at a fixed sibling index inside ChromeLayout', () => {
    expect(chromeLayout).toContain('<PerformanceStage');
    expect(chromeLayout).toContain('stage-chrome');
    expect(chromeLayout).not.toMatch(/stageMode\s*\?\s*</);
  });
});
