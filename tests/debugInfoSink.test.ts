import { describe, expect, it } from 'vitest';
import { DebugInfoSink, type DebugInfoSinkClock } from '../src/renderers/debugInfoSink';
import type { DebugInfo } from '../src/renderers/params';

const INITIAL: DebugInfo = { layoutMode: 'NONE', errors: [], uniforms: {} };

function fakeClock() {
  let now = 0;
  let timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  const clock: DebugInfoSinkClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: (handle) => {
      timers = timers.filter((t) => t.id !== handle);
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      now = due.at;
      due.fn();
    }
    now = end;
  };
  return { clock, advance };
}

/** Simulates the WebGPU frame loop reporting debug info every frame, as frameDraw.ts does. */
function frameUpdate(frame: number) {
  return (prev: DebugInfo): DebugInfo => ({
    ...prev,
    layoutMode: 'STANDARD (WebGPU)',
    uniforms: { ...prev.uniforms, playheadRow: frame.toFixed(2) },
  });
}

describe('DebugInfoSink (#439 bug 2 — PatternDisplay render count)', () => {
  it('never publishes (re-renders) while the debug panel is closed', () => {
    const { clock, advance } = fakeClock();
    let renders = 0;
    const sink = new DebugInfoSink(INITIAL, () => { renders += 1; }, 250, clock);

    // 10 s of playback at 60 fps.
    for (let frame = 0; frame < 600; frame++) {
      sink.dispatch(frameUpdate(frame));
      advance(1000 / 60);
    }
    expect(renders).toBe(0);
    // The data is still accumulated for when the panel opens.
    expect(sink.snapshot.uniforms.playheadRow).toBe('599.00');
  });

  it('publishes immediately on open, then at most 4 Hz while open', () => {
    const { clock, advance } = fakeClock();
    const published: DebugInfo[] = [];
    const sink = new DebugInfoSink(INITIAL, (info) => published.push(info), 250, clock);

    sink.dispatch(frameUpdate(0));
    sink.setOpen(true);
    expect(published).toHaveLength(1);

    for (let frame = 1; frame <= 600; frame++) {
      sink.dispatch(frameUpdate(frame));
      advance(1000 / 60);
    }
    // 10 s open → ~40 publishes, never one per frame.
    expect(published.length).toBeGreaterThan(30);
    expect(published.length).toBeLessThanOrEqual(1 + 10 * 4);
    advance(250);
    expect(published.at(-1)?.uniforms.playheadRow).toBe('600.00');

    sink.setOpen(false);
    const count = published.length;
    for (let frame = 0; frame < 120; frame++) {
      sink.dispatch(frameUpdate(frame));
      advance(1000 / 60);
    }
    expect(published).toHaveLength(count);
  });

  it('accepts plain values like a useState setter and has a stable dispatch', () => {
    const { clock } = fakeClock();
    const published: DebugInfo[] = [];
    const sink = new DebugInfoSink(INITIAL, (info) => published.push(info), 250, clock);
    const dispatch = sink.dispatch;
    dispatch({ ...INITIAL, errors: ['SHADER-INIT: boom'] });
    expect(sink.dispatch).toBe(dispatch);
    sink.setOpen(true);
    expect(published[0]?.errors).toEqual(['SHADER-INIT: boom']);
  });
});
