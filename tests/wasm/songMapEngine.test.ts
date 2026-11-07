/**
 * #537 phase 1, engine side: a load through the PlayerEngine (real libopenmpt, fake audio start path)
 * puts the module's SongStructure in the snapshot once, after the parse; a structure that lands after
 * a newer load is dropped.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibOpenMPT } from '../../types';
import { PlayerEngine, type StartAudioPlayback } from '../../audio/engine/PlayerEngine';
import { synthJumpXm, synthSongMapXm } from '../../scripts/lib/synth-xm.mjs';
import type { SongStructure } from '../../utils/songStructure';
import { EMPTY_SONG_STRUCTURE } from '../../utils/songStructure';
import { loadLibOpenMPTNode } from '../helpers/libopenmptNode';

let lib: LibOpenMPT;
let restore = () => {};

beforeAll(async () => {
  ({ lib, restore } = await loadLibOpenMPTNode());
}, 30_000);

afterAll(() => restore());

/** Start path that never renders: these tests are about the load, not playback. */
const noStart: StartAudioPlayback = async () => 'pending';

function engineWith(options: ConstructorParameters<typeof PlayerEngine>[0] = {}): PlayerEngine {
  const engine = new PlayerEngine({ strictTransport: true, startAudioPlayback: noStart, ...options });
  // What runLibOpenMPTInit leaves behind: the page's libopenmpt (main-thread parse path).
  (engine as unknown as { refs: { libopenmptRef: { current: LibOpenMPT | null } } }).refs.libopenmptRef.current = lib;
  engine.transport.send('load');
  engine.transport.send('loadFailed'); // idle, as after init with no module
  return engine;
}

describe('PlayerEngine songStructure', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    // processModuleData's parse-progress timer is a window timer.
    vi.stubGlobal('window', globalThis);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lands in the snapshot after the parse (main-thread read where there are no workers)', async () => {
    expect(typeof Worker).toBe('undefined');
    const engine = engineWith();
    expect(engine.getSnapshot().songStructure).toBeNull();
    await engine.loadFile(synthSongMapXm(), 'song-map.xm');
    await vi.waitFor(() => expect(engine.getSnapshot().songStructure).not.toBeNull());
    const s = engine.getSnapshot().songStructure!;
    expect(s.orders).toHaveLength(30);
    expect(s.totalSeconds).toBeCloseTo(engine.getSnapshot().moduleDurationSeconds, 6);
  });

  it('a read that lands after a newer load is dropped; the newer one wins', async () => {
    const resolvers: Array<(s: SongStructure) => void> = [];
    const source = vi.fn(() => new Promise<SongStructure>((resolve) => { resolvers.push(resolve); }));
    const engine = engineWith({ songStructureSource: source });
    await engine.loadFile(synthSongMapXm(), 'a.xm');
    await engine.loadFile(synthJumpXm(), 'b.xm');
    expect(source).toHaveBeenCalledTimes(2);
    const b = { ...EMPTY_SONG_STRUCTURE, totalSeconds: 2 };
    resolvers[1]!(b);
    await Promise.resolve();
    resolvers[0]!({ ...EMPTY_SONG_STRUCTURE, totalSeconds: 1 });
    await vi.waitFor(() => expect(engine.getSnapshot().songStructure).toBe(b));
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.getSnapshot().songStructure).toBe(b);
  });

  it('songStructureSource: null turns the read off', async () => {
    const engine = engineWith({ songStructureSource: null });
    await engine.loadFile(synthSongMapXm(), 'a.xm');
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.getSnapshot().songStructure).toBeNull();
  });
});
