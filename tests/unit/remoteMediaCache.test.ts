/**
 * The remote module cache is an LRU bounded by bytes (not 64 full buffers in
 * arrival order), and a failed media-availability probe is retried after a TTL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RemoteMedia = typeof import('../../utils/remoteMedia');

async function freshModule(): Promise<RemoteMedia> {
  vi.resetModules();
  return import('../../utils/remoteMedia');
}

const MiB = 1024 * 1024;

describe('fetchRemoteModule cache', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      const mb = Number(/size=(\d+)/.exec(url)?.[1] ?? '1');
      return new Response(new Uint8Array(mb * MiB));
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const url = (name: string, mb: number) => `http://localhost/${name}.it?size=${mb}`;

  it('serves a repeat request from the cache', async () => {
    const m = await freshModule();
    await m.fetchRemoteModule(url('a', 1));
    await m.fetchRemoteModule(url('a', 1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('evicts least-recently-used modules once over the byte budget', async () => {
    const m = await freshModule();
    const each = 20; // MiB — three fit in the 64 MiB budget, four do not
    expect(m.MAX_MODULE_CACHE_BYTES).toBe(64 * MiB);
    await m.fetchRemoteModule(url('a', each));
    await m.fetchRemoteModule(url('b', each));
    await m.fetchRemoteModule(url('c', each));
    await m.fetchRemoteModule(url('a', each)); // hit: 'a' becomes most recent
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await m.fetchRemoteModule(url('d', each)); // over budget: 'b' (LRU) goes
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await m.fetchRemoteModule(url('a', each));
    await m.fetchRemoteModule(url('c', each));
    await m.fetchRemoteModule(url('d', each));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await m.fetchRemoteModule(url('b', each)); // was evicted
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('hands back a module larger than the budget without caching it', async () => {
    const m = await freshModule();
    const data = await m.fetchRemoteModule(url('huge', 80));
    expect(data.byteLength).toBe(80 * MiB);
    await m.fetchRemoteModule(url('huge', 80));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed download', async () => {
    const m = await freshModule();
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    await expect(m.fetchRemoteModule(url('x', 1))).rejects.toThrow(/404/);
    await m.fetchRemoteModule(url('x', 1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('checkMediaAvailability negative TTL', () => {
  let ok = false;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    ok = false;
    fetchMock = vi.fn(async () => new Response(null, { status: ok ? 200 : 404 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('re-probes a missing file after the TTL, but not before', async () => {
    const m = await freshModule();
    const u = 'http://localhost/media/song.png';
    expect(await m.checkMediaAvailability(u)).toBe(false);
    expect(await m.checkMediaAvailability(u)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    ok = true; // the file was uploaded meanwhile
    vi.setSystemTime(Date.now() + m.MEDIA_NEGATIVE_TTL_MS + 1);
    expect(await m.checkMediaAvailability(u)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a positive result past the TTL', async () => {
    const m = await freshModule();
    ok = true;
    const u = 'http://localhost/media/song.mp4';
    expect(await m.checkMediaAvailability(u)).toBe(true);
    vi.setSystemTime(Date.now() + m.MEDIA_NEGATIVE_TTL_MS * 10);
    expect(await m.checkMediaAvailability(u)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
