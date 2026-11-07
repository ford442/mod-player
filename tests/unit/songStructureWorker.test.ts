/** #537: the song-structure worker client — one worker reused across loads, a busy one terminated when superseded. */
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_SONG_STRUCTURE } from '../../utils/songStructure';
import { createSongStructureClient, SupersededError, type SongStructureRequest } from '../../utils/songStructureWorker';

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: SongStructureRequest[] = [];
  terminated = false;
  postMessage(msg: SongStructureRequest) { this.posted.push(msg); }
  terminate() { this.terminated = true; }
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

function setup() {
  const workers: FakeWorker[] = [];
  const client = createSongStructureClient(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w as unknown as Worker;
  }, 1000);
  return { client, workers };
}

describe('createSongStructureClient', () => {
  it('reuses one worker for consecutive reads and resolves by request id', async () => {
    const { client, workers } = setup();
    const first = client.read(new Uint8Array([1, 2]));
    const w = workers[0]!;
    const id = w.posted[0]!.id;
    w.reply({ type: 'structure', id: id + 99, structure: { ...EMPTY_SONG_STRUCTURE, totalSeconds: 9 } }); // not ours
    w.reply({ type: 'structure', id, structure: { ...EMPTY_SONG_STRUCTURE, totalSeconds: 1 } });
    await expect(first).resolves.toMatchObject({ totalSeconds: 1 });
    const second = client.read(new Uint8Array([3]));
    expect(workers).toHaveLength(1);
    w.reply({ type: 'structure', id: w.posted[1]!.id, structure: EMPTY_SONG_STRUCTURE });
    await expect(second).resolves.toBe(EMPTY_SONG_STRUCTURE);
  });

  it('a newer read terminates a busy worker and rejects the old read as superseded', async () => {
    const { client, workers } = setup();
    const old = client.read(new Uint8Array([1]));
    const next = client.read(new Uint8Array([2]));
    await expect(old).rejects.toBeInstanceOf(SupersededError);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    workers[1]!.reply({ type: 'structure', id: workers[1]!.posted[0]!.id, error: 'bad module' });
    await expect(next).rejects.toThrow('bad module');
  });

  it('times out and drops the worker', async () => {
    vi.useFakeTimers();
    try {
      const { client, workers } = setup();
      const read = client.read(new Uint8Array([1]));
      const assertion = expect(read).rejects.toThrow(/timed out/);
      vi.advanceTimersByTime(1001);
      await assertion;
      expect(workers[0]!.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('posts a copy of the bytes, transferred', () => {
    const { client, workers } = setup();
    const bytes = new Uint8Array([7, 8, 9]);
    void client.read(bytes).catch(() => {});
    expect(workers[0]!.posted[0]!.fileData).toEqual(bytes);
    expect(workers[0]!.posted[0]!.fileData).not.toBe(bytes);
    client.dispose();
    expect(workers[0]!.terminated).toBe(true);
  });
});
