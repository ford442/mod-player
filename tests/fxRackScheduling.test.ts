/**
 * FxRack / FxSlot scheduling on fake nodes (#453): the scheduler-driven paths
 * an offline render can't exercise deterministically — deferred unwire after a
 * module's tail, its cancellation on re-enable, attach / collapse / detach
 * against the master graph, and the dip-rewire-return of a live reorder.
 */
import { describe, expect, it, vi } from 'vitest';
import { FxRack, type FxAttachPoint } from '../audio/fx/FxRack';
import type { FxModuleFactory, FxModuleInstance } from '../audio/fx/modules/types';
import type { FxScheduler } from '../audio/fx/scheduler';
import { defaultFxRackState, parseFxRackState } from '../audio/fx/spec/schema';
import type { FxModuleId, FxRackState } from '../audio/fx/types';

interface ParamEvent {
  type: 'set' | 'ramp' | 'cancel' | 'target';
  value?: number;
  time: number;
}

class FakeParam {
  value: number;
  events: ParamEvent[] = [];
  constructor(initial: number) {
    this.value = initial;
  }
  setValueAtTime(value: number, time: number) {
    this.events.push({ type: 'set', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ type: 'ramp', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number) {
    this.events.push({ type: 'target', value, time });
    return this;
  }
  cancelScheduledValues(time: number) {
    this.events.push({ type: 'cancel', time });
    return this;
  }
  /** Value once every scheduled event has played out. */
  get final(): number {
    const last = [...this.events].reverse().find((e) => e.type === 'set' || e.type === 'ramp');
    return last?.value ?? this.value;
  }
}

class FakeNode {
  readonly edges = new Set<FakeNode>();
  readonly gain = new FakeParam(1);
  constructor(readonly name: string) {}
  connect(dest: FakeNode) {
    this.edges.add(dest);
    return dest;
  }
  disconnect(dest?: FakeNode) {
    if (dest) {
      if (!this.edges.delete(dest)) throw new Error('InvalidAccessError');
    } else {
      this.edges.clear();
    }
  }
}

function fakeContext() {
  let n = 0;
  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    createGain: () => new FakeNode(`gain${n++}`),
  };
  return ctx as typeof ctx & BaseAudioContext;
}

/** A pass-through module: input → output, with a 100 ms tail. */
const fakeFactory: FxModuleFactory = async (id, ctx) => {
  const node = (ctx as unknown as { createGain(): FakeNode }).createGain();
  const module = {
    id,
    input: node,
    output: node,
    latencySeconds: 0,
    warmupSeconds: 0.01,
    tailSeconds: () => 0.1,
    setParams: vi.fn(),
    dispose: vi.fn(),
  };
  return module as unknown as FxModuleInstance<typeof id>;
};

class ManualScheduler implements FxScheduler {
  queue: { time: number; fn: () => void }[] = [];
  at(time: number, fn: () => void) {
    this.queue.push({ time, fn });
  }
  /** Advance the fake clock to `now`, running everything due. */
  run(ctx: { currentTime: number }, now: number) {
    ctx.currentTime = now;
    const due = this.queue.filter((e) => e.time <= now);
    this.queue = this.queue.filter((e) => e.time > now);
    for (const e of due) e.fn();
  }
}

function withEnabled(ids: FxModuleId[], order?: FxModuleId[]): FxRackState {
  const state = defaultFxRackState();
  for (const id of ids) state.modules[id].enabled = true;
  if (order) state.order = order;
  return parseFxRackState(state);
}

async function liveRack(initial = defaultFxRackState()) {
  const ctx = fakeContext();
  const scheduler = new ManualScheduler();
  const rack = await FxRack.create(ctx, initial, { mode: 'live', scheduler, createModule: fakeFactory });
  return { ctx, scheduler, rack };
}

/** The chain of slot-input nodes reachable from the rack input, in order. */
function slotOf(rack: FxRack, id: FxModuleId): { input: FakeNode; output: FakeNode; module: { input: FakeNode } | null } {
  return (rack as unknown as { slots: Record<FxModuleId, never> }).slots[id];
}

describe('FxSlot deferred unwire (#453)', () => {
  it('unwires a disabled module after fade + tail, and a re-enable cancels a stale unwire', async () => {
    const { ctx, scheduler, rack } = await liveRack();
    await rack.apply(withEnabled(['eq']), { at: 1 });
    const slot = slotOf(rack, 'eq');
    const moduleNode = slot.module!.input;
    expect(slot.input.edges.has(moduleNode)).toBe(true);

    await rack.apply(defaultFxRackState(), { at: 2 });
    expect(scheduler.queue).toHaveLength(1);
    const unwireAt = scheduler.queue[0]!.time;
    expect(unwireAt).toBeCloseTo(2 + 0.01 + 0.1 + 0.05, 9); // fade + tail + margin

    // Re-enabled before the unwire comes due: the stale callback must not cut it.
    await rack.apply(withEnabled(['eq']), { at: 2.05 });
    scheduler.run(ctx, unwireAt);
    expect(slot.input.edges.has(moduleNode)).toBe(true);

    await rack.apply(defaultFxRackState(), { at: 3 });
    scheduler.run(ctx, 4);
    expect(slot.input.edges.has(moduleNode)).toBe(false);
    expect(rack.isQuiet(4)).toBe(true);
  });
});

describe('FxRack attach / collapse (#453)', () => {
  function host(): FxAttachPoint & { masterInput: FakeNode; masterDirect: FakeNode; analyser: FakeNode } {
    return {
      masterInput: new FakeNode('masterInput'),
      masterDirect: new FakeNode('masterDirect'),
      analyser: new FakeNode('analyser'),
    } as never;
  }

  it('attach fades masterDirect out / the return in; collapse reverses, then detaches by target', async () => {
    const { ctx, scheduler, rack } = await liveRack();
    const h = host();
    rack.attach(h, 1);
    const rackInput = rack.input as unknown as FakeNode;
    const rackOutput = rack.output as unknown as FakeNode;
    expect(h.masterInput.edges.has(rackInput)).toBe(true);
    expect(rackOutput.edges.has(h.analyser)).toBe(true);
    expect(h.masterDirect.gain.final).toBe(0);
    expect(rackOutput.gain.final).toBe(1);
    expect(rackOutput.gain.events).toContainEqual({ type: 'ramp', value: 1, time: expect.closeTo(1.01, 9) });

    rack.collapse(2);
    expect(h.masterDirect.gain.final).toBe(1);
    expect(rackOutput.gain.final).toBe(0);
    scheduler.run(ctx, 3);
    expect(h.masterInput.edges.has(rackInput)).toBe(false);
    expect(rackOutput.edges.has(h.analyser)).toBe(false);
    expect(rack.isAttached).toBe(false);
  });

  it('re-attaching before the detach comes due keeps the edges and fades back in', async () => {
    const { ctx, scheduler, rack } = await liveRack();
    const h = host();
    rack.attach(h, 1);
    rack.collapse(2);
    rack.attach(h, 2.004);
    scheduler.run(ctx, 3);
    expect(rack.isAttached).toBe(true);
    expect(h.masterInput.edges.has(rack.input as unknown as FakeNode)).toBe(true);
    expect(h.masterDirect.gain.final).toBe(0);
    expect((rack.output as unknown as FakeNode).gain.final).toBe(1);
    // Append-only: the reversal queues behind the collapse fade (ends 2.01) instead of cancelling it.
    const events = (rack.output as unknown as FakeNode).gain.events;
    const afterCollapse = events.slice(events.findIndex((e) => e.type === 'ramp' && e.value === 0));
    expect(afterCollapse.some((e) => e.type === 'cancel')).toBe(false);
    expect(afterCollapse).toContainEqual({ type: 'set', value: 0, time: expect.closeTo(2.01, 9) });
    expect(afterCollapse).toContainEqual({ type: 'ramp', value: 1, time: expect.closeTo(2.02, 9) });
  });

  it('a live reorder dips to dry, rewires while silent, then returns', async () => {
    const { ctx, scheduler, rack } = await liveRack(withEnabled(['eq', 'comp']));
    const h = host();
    rack.attach(h, 0.5);
    const order: FxModuleId[] = ['room', 'comp', 'eq', 'character'];
    await rack.apply(withEnabled(['eq', 'comp'], order), { at: 1 });
    // Dipped: return heading to 0, direct to 1, chain not yet rewired.
    expect((rack.output as unknown as FakeNode).gain.final).toBe(0);
    expect(h.masterDirect.gain.final).toBe(1);
    expect(rackInputTarget(rack)).toBe(slotOf(rack, 'character').input);

    scheduler.run(ctx, 1.02);
    expect(rackInputTarget(rack)).toBe(slotOf(rack, 'room').input);
    expect(slotOf(rack, 'room').output.edges.has(slotOf(rack, 'comp').input)).toBe(true);
    expect(slotOf(rack, 'eq').output.edges.has(slotOf(rack, 'character').input)).toBe(true);
    expect(slotOf(rack, 'character').output.edges.has(rack.output as unknown as FakeNode)).toBe(true);
    expect((rack.output as unknown as FakeNode).gain.final).toBe(1);
    expect(h.masterDirect.gain.final).toBe(0);
  });
});

function rackInputTarget(rack: FxRack): FakeNode {
  const edges = [...(rack.input as unknown as FakeNode).edges];
  expect(edges).toHaveLength(1);
  return edges[0]!;
}
