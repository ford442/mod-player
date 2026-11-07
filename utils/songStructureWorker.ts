/**
 * Main-thread side of the song map's structure read (#537): ask a parser worker
 * (workers/openmpt-parser.worker.ts, `type: 'structure'`) for a module's SongStructure.
 *
 * The read is quadratic in song length (utils/readSongStructure.ts), so it gets a worker of its own
 * that outlives one load (libopenmpt is fetched once), and a newer load *supersedes* a read still in
 * flight: the busy worker is terminated rather than left to finish a song nobody is looking at.
 */
import type { SongStructure } from './songStructure';
import { getParserWorkerUrl } from './parserWorker';

export interface SongStructureRequest {
  type: 'structure';
  id: number;
  fileData: Uint8Array;
  /** Budget for the exact pass, ms (readSongStructure's default when absent). */
  budgetMs?: number;
}

export type SongStructureResponse =
  | { type: 'structure'; id: number; structure: SongStructure }
  | { type: 'structure'; id: number; error: string };

/** Reads a module's structure; rejects when superseded, on a worker error or after the timeout. */
export type SongStructureSource = (fileData: Uint8Array) => Promise<SongStructure>;

export const SONG_STRUCTURE_TIMEOUT_MS = 30_000;

export class SupersededError extends Error {
  constructor() {
    super('song structure read superseded by a newer load');
    this.name = 'SupersededError';
  }
}

interface Pending {
  id: number;
  resolve: (structure: SongStructure) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SongStructureClient {
  read: SongStructureSource;
  dispose(): void;
}

export function createSongStructureClient(
  createWorker: () => Worker = () => new Worker(getParserWorkerUrl(), { type: 'module' }),
  timeoutMs: number = SONG_STRUCTURE_TIMEOUT_MS,
): SongStructureClient {
  let worker: Worker | null = null;
  let pending: Pending | null = null;
  let nextId = 1;

  const drop = () => {
    if (worker) {
      try { worker.terminate(); } catch { /* ignore */ }
      worker = null;
    }
  };

  const settle = (): Pending | null => {
    const p = pending;
    pending = null;
    if (p) clearTimeout(p.timer);
    return p;
  };

  const fail = (err: Error) => {
    settle()?.reject(err);
    drop();
  };

  const ensureWorker = (): Worker => {
    if (worker) return worker;
    const w = createWorker();
    w.onmessage = (e: MessageEvent<SongStructureResponse | { type?: string }>) => {
      const data = e.data;
      if (!data || data.type !== 'structure' || !pending || (data as SongStructureResponse).id !== pending.id) return;
      const response = data as SongStructureResponse;
      if ('error' in response) settle()?.reject(new Error(response.error));
      else settle()?.resolve(response.structure);
    };
    w.onerror = (e: ErrorEvent) => fail(new Error(e.message || 'song structure worker error'));
    w.onmessageerror = () => fail(new Error('song structure message deserialization failed'));
    worker = w;
    return w;
  };

  return {
    read(fileData) {
      if (pending) {
        // The worker is mid-walk on an older song: stop it instead of queueing behind it.
        settle()?.reject(new SupersededError());
        drop();
      }
      return new Promise<SongStructure>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => fail(new Error(`song structure timed out after ${timeoutMs}ms`)), timeoutMs);
        pending = { id, resolve, reject, timer };
        try {
          const copy = fileData.slice();
          ensureWorker().postMessage({ type: 'structure', id, fileData: copy } satisfies SongStructureRequest, [copy.buffer]);
        } catch (err) {
          fail(err instanceof Error ? err : new Error('failed to post to the song structure worker'));
        }
      });
    },
    dispose() {
      settle()?.reject(new SupersededError());
      drop();
    },
  };
}
