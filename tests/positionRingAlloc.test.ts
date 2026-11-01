/**
 * #492 acceptance: the position path makes zero allocations per report in shared-ring mode.
 *
 * Drives the real writer (what openmpt-processor.ts does) and the real consumer (what the UI loop
 * drains) through utils/positionRingBenchmark.ts, and measures V8 new-space growth over many reports
 * after warm-up — the same method as tests/fxCharacterAlloc.test.ts. The pre-#492 message path
 * (structured clone → zod → dispatch) is measured too, so the test shows what the ring removes.
 * Kept in its own file: allocation counts need an isolate nothing else has warmed up differently.
 */
import v8 from 'node:v8';
import vm from 'node:vm';
import { expect, it } from 'vitest';
import { createMessageBench, createRingBench, type PositionPathBench } from '../utils/positionRingBenchmark';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;
const newSpaceUsed = () =>
  v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;

function grownBytes(bench: PositionPathBench, reports: number): number {
  gc();
  const before = newSpaceUsed();
  bench.run(reports);
  return newSpaceUsed() - before;
}

it('the shared-ring position path settles to zero allocations per report', () => {
  const ring = createRingBench();
  const REPORTS = 10_000;
  // V8 tiers the loop up (Sparkplug → Maglev → TurboFan) on its own schedule — on a loaded machine
  // the boxing lower tiers can last tens of thousands of reports. The steady state is what runs at
  // 60 Hz for a whole song, so: run windows until two in a row allocate nothing.
  const windows: number[] = [];
  let quiet = 0;
  while (windows.length < 60 && quiet < 2) {
    const perReport = grownBytes(ring, REPORTS) / REPORTS;
    windows.push(Math.round(perReport * 100) / 100);
    quiet = perReport < 1 ? quiet + 1 : 0;
  }
  expect(ring.applied()).toBeGreaterThan(REPORTS);
  // One boxed double per report would already be 16 B; < 1 B/report is measurement noise (ICs).
  expect(quiet, `bytes/report per window: ${windows.join(', ')}`).toBe(2);
}, 120_000);

it('for contrast: the position-message path allocates on every report', () => {
  const messages = createMessageBench();
  for (let r = 0; r < 20; r++) messages.run(100);
  // Small windows: a scavenge inside one would hide what it allocated.
  const perReport = Math.min(...[0, 1, 2].map(() => grownBytes(messages, 200) / 200));
  expect(messages.applied()).toBeGreaterThan(2_000);
  expect(perReport).toBeGreaterThan(200);
}, 60_000);
