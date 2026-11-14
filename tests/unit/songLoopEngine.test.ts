/**
 * #537 phase 2 on the headless PlayerEngine: the loop region seeks back through the ordinary
 * pending-seek path (a `seek` to the worklet — no new message type), only for a natural exit, and is
 * remembered per song. The harness is the one of tests/unit/playerEngine.test.ts (fake start path).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIN_TO_WORKLET } from '../../audio-worklet/workletProtocolConstants';
import { PlayerEngine, type StartAudioPlayback } from '../../audio/engine/PlayerEngine';
import type { PatternMatrix } from '../../types';
import { setSongFingerprint } from '../../utils/songIdentity';
import type { SongOrder, SongStructure } from '../../utils/songStructure';
import type { LoopRegion } from '../../utils/songStructureLoop';
import type { LoopRegionStore } from '../../utils/songStructureSession';

const ORDERS = 5;
const ROWS = 16;
const matrix = (order: number) => ({ order, numRows: ROWS, numChannels: 4, rows: [] }) as unknown as PatternMatrix;

function structure(): SongStructure {
  const orders: SongOrder[] = Array.from({ length: ORDERS }, (_, i) => ({
    index: i, pattern: i, rows: ROWS, startSeconds: i * 2, durationSeconds: 2,
    entryRow: 0, exitRow: ROWS - 1, isSkip: false, isEnd: false, reachable: true,
  }));
  return { orders, jumps: [], tempoEvents: [], totalSeconds: ORDERS * 2, playOrder: orders.map((o) => o.index), approximate: false };
}

function fakeStore(initial: unknown = null) {
  const saved: Array<[string, LoopRegion | null]> = [];
  const store: LoopRegionStore = {
    load: vi.fn(() => Promise.resolve(initial)),
    save: vi.fn((fingerprint: string, region: LoopRegion | null) => {
      saved.push([fingerprint, region]);
      return Promise.resolve();
    }),
  };
  return { store, saved };
}

interface Internals {
  store: { patch: (p: object) => void };
  refs: {
    workletOrderRef: { current: number };
    updateUIRef: { current: (() => void) | null };
  };
  onModuleParsed: (bytes: Uint8Array) => void;
  restoreLoopRegion: () => void;
}

function setup(options: { store?: LoopRegionStore | null; source?: (() => Promise<SongStructure>) | null } = {}) {
  const post = vi.fn();
  const node = { port: { postMessage: post, onmessage: null, addEventListener: vi.fn(), removeEventListener: vi.fn() }, onprocessorerror: null, disconnect: vi.fn() };
  let callbacks!: { setIsPlaying: (v: boolean) => void };
  const start = vi.fn<StartAudioPlayback>(async (refs, cb) => {
    callbacks = cb;
    refs.audioWorkletNodeRef.current = node as unknown as AudioWorkletNode;
    refs.playbackEngineRef.current = 'worklet';
    refs.gainNodeRef.current = { gain: { value: 1 } } as unknown as GainNode;
    refs.stereoPannerRef.current = { pan: { value: 0 } } as unknown as StereoPannerNode;
    refs.patternMatricesRef.current = Array.from({ length: ORDERS }, (_, i) => matrix(i));
    return 'pending';
  });
  const engine = new PlayerEngine({
    strictTransport: true,
    startAudioPlayback: start,
    songStructureSource: options.source === undefined ? null : options.source,
    loopRegionStore: options.store === undefined ? null : options.store,
  });
  engine.transport.send('load');
  engine.transport.send('parsed', 'ready');
  const internals = engine as unknown as Internals;
  return {
    engine,
    internals,
    seeks: () =>
      post.mock.calls
        .map((c) => c[0] as { type: string; order?: number; row?: number })
        .filter((m) => m.type === MAIN_TO_WORKLET.seek)
        .map((m) => [m.order, m.row]),
    async play() {
      await engine.play();
      callbacks.setIsPlaying(true);
      expect(engine.transport.phase).toBe('playing');
    },
    withStructure() {
      internals.store.patch({ songStructure: structure() });
    },
    /** One UI frame with the worklet's latest report at `order`. */
    report(order: number) {
      internals.refs.workletOrderRef.current = order;
      internals.refs.updateUIRef.current!();
    },
  };
}

describe('loop region on the PlayerEngine (#537 phase 2)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 7));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    setSongFingerprint(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('ignores a region until the structure is there, then validates it against it', () => {
    const f = setup();
    f.engine.dispatch({ type: 'setLoopRegion', start: 1, end: 2 });
    expect(f.engine.getSnapshot().loopRegion).toBeNull();
    f.withStructure();
    f.engine.dispatch({ type: 'setLoopRegion', start: 9, end: 2 }); // either way round, clamped
    expect(f.engine.getSnapshot().loopRegion).toEqual({ start: 2, end: 4 });
    f.engine.dispatch({ type: 'clearLoopRegion' });
    expect(f.engine.getSnapshot().loopRegion).toBeNull();
  });

  it('keeps the same region object when nothing changed (the map must not re-render)', () => {
    const f = setup();
    f.withStructure();
    f.engine.dispatch({ type: 'setLoopRegion', start: 1, end: 2 });
    const first = f.engine.getSnapshot().loopRegion;
    f.engine.dispatch({ type: 'setLoopRegion', start: 2, end: 1 });
    expect(f.engine.getSnapshot().loopRegion).toBe(first);
  });

  it('seeks back to the first row of A when playback runs out of B — one seek message, nothing new', async () => {
    const f = setup();
    await f.play();
    f.withStructure();
    f.engine.dispatch({ type: 'setLoopRegion', start: 1, end: 2 });
    for (const order of [0, 0, 1, 1, 2, 2]) f.report(order);
    expect(f.seeks()).toEqual([]);
    f.report(3); // out of B's end
    expect(f.seeks()).toEqual([[1, 0]]);
    // The reports still in flight (the order after B) do not seek again…
    f.report(3);
    f.report(3);
    expect(f.seeks()).toEqual([[1, 0]]);
    // …and the next pass loops again.
    for (const order of [1, 2, 3]) f.report(order);
    expect(f.seeks()).toEqual([[1, 0], [1, 0]]);
  });

  it('leaves a user seek out of the region alone, and one that has not reached it yet', async () => {
    const f = setup();
    await f.play();
    f.withStructure();
    f.engine.dispatch({ type: 'setLoopRegion', start: 2, end: 3 });
    for (const order of [0, 1]) f.report(order);
    f.engine.dispatch({ type: 'seekOrder', order: 2 });
    const before = f.seeks().length;
    f.report(2);
    f.report(2);
    f.engine.dispatch({ type: 'seekOrder', order: 0 }); // click a chip before A
    f.report(0);
    f.report(0);
    expect(f.seeks().slice(before)).toEqual([[0, 0]]); // only the user's own seek
  });

  it('does nothing while paused or stopped, and with no region', async () => {
    const f = setup();
    await f.play();
    f.withStructure();
    f.report(1);
    f.report(2);
    f.report(3);
    expect(f.seeks()).toEqual([]); // no region
    f.engine.dispatch({ type: 'setLoopRegion', start: 1, end: 1 });
    f.report(1);
    f.engine.pause();
    f.report(2);
    expect(f.seeks()).toEqual([]);
  });

  it('a region change re-arms the detector: the old position is not carried over', async () => {
    const f = setup();
    await f.play();
    f.withStructure();
    f.engine.dispatch({ type: 'setLoopRegion', start: 1, end: 1 });
    f.report(1);
    f.engine.dispatch({ type: 'setLoopRegion', start: 2, end: 2 });
    f.report(2); // 1 → 2 would have been an exit of the old region; it is the entry of the new one
    expect(f.seeks()).toEqual([]);
  });

  it('marks A / B at the order on screen (Shift+[ / Shift+])', () => {
    const f = setup();
    f.withStructure();
    f.internals.store.patch({ moduleInfo: { ...f.engine.getSnapshot().moduleInfo, order: 1 } });
    f.engine.dispatch({ type: 'markLoopEdge', edge: 'start' });
    expect(f.engine.getSnapshot().loopRegion).toEqual({ start: 1, end: 1 });
    f.internals.store.patch({ moduleInfo: { ...f.engine.getSnapshot().moduleInfo, order: 3 } });
    f.engine.dispatch({ type: 'markLoopEdge', edge: 'end' });
    expect(f.engine.getSnapshot().loopRegion).toEqual({ start: 1, end: 3 });
  });

  describe('per-song memory (SongSession.loopRegion)', () => {
    it('saves a change under the song fingerprint', () => {
      const { store, saved } = fakeStore();
      const f = setup({ store });
      f.withStructure();
      setSongFingerprint('fp-a');
      f.engine.dispatch({ type: 'setLoopRegion', start: 1, end: 3 });
      f.engine.dispatch({ type: 'clearLoopRegion' });
      expect(saved).toEqual([['fp-a', { start: 1, end: 3 }], ['fp-a', null]]);
    });

    it('restores the stored region once the structure and the fingerprint are both there', async () => {
      const { store } = fakeStore({ start: 2, end: 3 });
      const f = setup({ store, source: () => Promise.resolve(structure()) });
      // Structure first, fingerprint later (the hash lands after the read).
      f.internals.onModuleParsed(new Uint8Array(4));
      await vi.waitFor(() => expect(f.engine.getSnapshot().songStructure).not.toBeNull());
      expect(store.load).not.toHaveBeenCalled();
      setSongFingerprint('fp-b');
      f.internals.restoreLoopRegion(); // what the engine's fingerprint subscription (init) does
      await vi.waitFor(() => expect(f.engine.getSnapshot().loopRegion).toEqual({ start: 2, end: 3 }));
      expect(store.load).toHaveBeenCalledWith('fp-b');
    });

    it('restores when the fingerprint was there first', async () => {
      const { store } = fakeStore({ start: 0, end: 1 });
      setSongFingerprint('fp-c');
      const f = setup({ store, source: () => Promise.resolve(structure()) });
      f.internals.onModuleParsed(new Uint8Array(4));
      await vi.waitFor(() => expect(f.engine.getSnapshot().loopRegion).toEqual({ start: 0, end: 1 }));
    });

    it('drops a stored region that does not fit the song, and one that is not a region at all', async () => {
      for (const stored of [{ start: 40, end: 50 }, 'junk', null, { start: 'a', end: 1 }]) {
        const { store } = fakeStore(stored);
        setSongFingerprint('fp-d');
        const f = setup({ store, source: () => Promise.resolve(structure()) });
        f.internals.onModuleParsed(new Uint8Array(4));
        await vi.waitFor(() => expect(store.load).toHaveBeenCalled());
        await Promise.resolve();
        expect(f.engine.getSnapshot().loopRegion).toBeNull();
        setSongFingerprint(null);
      }
    });

    it('what the user chose before the lookup finished wins, and is what gets saved', async () => {
      let resolveLoad!: (v: unknown) => void;
      const { store, saved } = fakeStore();
      (store.load as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise((r) => { resolveLoad = r; }));
      setSongFingerprint('fp-e');
      const f = setup({ store, source: () => Promise.resolve(structure()) });
      f.internals.onModuleParsed(new Uint8Array(4));
      await vi.waitFor(() => expect(store.load).toHaveBeenCalled());
      f.engine.dispatch({ type: 'setLoopRegion', start: 4, end: 4 });
      resolveLoad({ start: 0, end: 1 });
      await Promise.resolve();
      await Promise.resolve();
      expect(f.engine.getSnapshot().loopRegion).toEqual({ start: 4, end: 4 });
      expect(saved).toEqual([['fp-e', { start: 4, end: 4 }]]);
    });

    it('a new load clears the region (and the next song gets its own)', async () => {
      const { store } = fakeStore();
      const f = setup({ store, source: () => Promise.resolve(structure()) });
      f.withStructure();
      f.engine.dispatch({ type: 'setLoopRegion', start: 1, end: 2 });
      f.internals.onModuleParsed(new Uint8Array(4));
      expect(f.engine.getSnapshot().loopRegion).toBeNull();
      expect(f.engine.getSnapshot().songStructure).toBeNull();
    });
  });
});
