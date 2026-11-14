/**
 * Native looping (#548 phase 1): the worklet hands libopenmpt the loop toggle as a repeat count
 * (MT.setRepeat), so a looping song goes back to ITS OWN restart point — here the XM restart
 * position, order 2 — sample-accurately and without an `ended` round trip to the main thread. With
 * the loop off the song plays once and posts `ended`. Runs the COMPILED worklet with the REAL
 * committed libopenmpt wasm in a fake AudioWorkletGlobalScope (tests/helpers/workletScope.ts).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { MAIN_TO_WORKLET as MT, WORKLET_TO_MAIN as WT } from '../../audio-worklet/workletProtocolConstants';
import { synthRestartXm } from '../../scripts/lib/synth-xm.mjs';
import { FakeScope, QUANTUM, SAMPLE_RATE, initLib } from '../helpers/workletScope';

type Node = ReturnType<FakeScope['newNode']>;

/** 4 orders × 8 rows at speed 6 / 125 BPM: 32 rows × 0.12 s. */
const SONG_SECONDS = 32 * 0.12;
const quantaFor = (seconds: number) => Math.ceil((seconds * SAMPLE_RATE) / QUANTUM);

/** Render `quanta` blocks; returns the order of every position report and the per-block peak. */
function render(scope: FakeScope, node: Node['node'], quanta: number) {
  const l = new Float32Array(QUANTUM);
  const r = new Float32Array(QUANTUM);
  const firstReport = scope.posted.length;
  const peaks: number[] = [];
  for (let q = 0; q < quanta; q++) {
    scope.advance(QUANTUM / SAMPLE_RATE);
    node.process([[]], [[l, r]], {});
    let peak = 0;
    for (let i = 0; i < QUANTUM; i++) peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
    peaks.push(peak);
  }
  const orders = scope.posted.slice(firstReport)
    .filter((m) => m.type === WT.position)
    .map((m) => m.order as number);
  return { orders, peaks };
}

/** The order sequence with repeats collapsed: [0, 0, 1, 1, 2] → [0, 1, 2]. */
const runs = (orders: number[]) => orders.filter((o, i) => i === 0 || orders[i - 1] !== o);

describe('native looping: libopenmpt repeat count in the compiled worklet (real wasm)', () => {
  let scope: FakeScope;
  let node: Node;

  beforeAll(async () => {
    scope = new FakeScope();
    node = scope.newNode();
    await initLib(scope, node.send);
  }, 60_000);

  async function load(restart: number, repeat: number) {
    await node.send({ type: MT.setRepeat, count: repeat });
    const before = scope.count(WT.loaded);
    await node.send({ type: MT.load, moduleData: scope.toRealm(synthRestartXm(restart)) });
    expect(scope.count(WT.loaded)).toBe(before + 1);
  }

  it('repeat -1 loops at the XM restart position (order 2), not order 0, and never posts ended', async () => {
    await load(2, -1);
    const endedBefore = scope.count(WT.ended);
    const { orders, peaks } = render(scope, node.node, quantaFor(SONG_SECONDS * 2.2));
    expect(scope.count(WT.ended)).toBe(endedBefore);
    // 0 1 2 3, then the restart position: 2 3 2 3 …
    const seq = runs(orders);
    expect(seq.slice(0, 6)).toEqual([0, 1, 2, 3, 2, 3]);
    expect(seq.slice(4)).not.toContain(0);
    expect(seq.slice(4)).not.toContain(1);
    // Gapless: no all-zero quantum anywhere — not even at the wrap, where the old path (`ended` →
    // main thread → seek) rendered silence until the seek landed. (Note retriggers dip low, never to 0.)
    expect(peaks[0]).toBeGreaterThan(0);
    expect(peaks.filter((p) => p === 0)).toEqual([]);
  });

  it('the restart position is the module\'s own: restart 0 loops back to order 0', async () => {
    await load(0, -1);
    const seq = runs(render(scope, node.node, quantaFor(SONG_SECONDS * 1.5)).orders);
    expect(seq.slice(0, 6)).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('repeat 0 plays once: ended is posted once, and the output goes silent', async () => {
    await load(2, 0);
    const endedBefore = scope.count(WT.ended);
    const { orders, peaks } = render(scope, node.node, quantaFor(SONG_SECONDS + 1.5));
    // Played through once (reports taken after the end may read the restart order; nothing renders).
    const seq = runs(orders);
    expect(seq.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(seq.filter((o) => o === 3)).toHaveLength(1);
    expect(scope.count(WT.ended)).toBe(endedBefore + 1);
    expect(peaks[peaks.length - 1]).toBe(0);
  });

  it('a live setRepeat reaches the playing module: turning the loop on mid-song keeps it going', async () => {
    await load(2, 0);
    const endedBefore = scope.count(WT.ended);
    render(scope, node.node, quantaFor(SONG_SECONDS / 2));
    await node.send({ type: MT.setRepeat, count: -1 });
    const { orders } = render(scope, node.node, quantaFor(SONG_SECONDS * 1.2));
    expect(scope.count(WT.ended)).toBe(endedBefore);
    expect(runs(orders)).toContain(3);
    expect(runs(orders).slice(-3)).not.toContain(0);

    // …and off again: the song now ends at its next end.
    await node.send({ type: MT.setRepeat, count: 0 });
    render(scope, node.node, quantaFor(SONG_SECONDS + 1));
    expect(scope.count(WT.ended)).toBe(endedBefore + 1);
  });

  it('the count survives a reload (create resets it; the worklet re-applies it)', async () => {
    await load(2, -1);
    await node.send({ type: MT.load, moduleData: scope.toRealm(synthRestartXm(2)) });
    const endedBefore = scope.count(WT.ended);
    const seq = runs(render(scope, node.node, quantaFor(SONG_SECONDS * 1.5)).orders);
    expect(scope.count(WT.ended)).toBe(endedBefore);
    expect(seq.slice(0, 6)).toEqual([0, 1, 2, 3, 2, 3]);
  });
});
