/**
 * Lazy room-IR loading (#453).
 *
 * Bytes are fetched once per page and only when the room is first enabled;
 * each BaseAudioContext decodes its own copy (decodeAudioData resamples to the
 * context's rate, and a ConvolverNode needs a buffer at that rate — the live
 * 48 kHz context and a 44.1 kHz export context differ). A failure is never
 * cached, so Retry works. Decoding can fail where Ogg Opus isn't supported
 * (some Safari versions): that surfaces as IrUnavailableError and the room
 * reports itself unavailable instead of breaking the rack.
 */
import type { RoomIrId } from '../types';
import { IR_MANIFEST, irUrl } from './irCatalog';

export interface IrLoader {
  load(ctx: BaseAudioContext, id: RoomIrId): Promise<AudioBuffer>;
}

export class IrUnavailableError extends Error {
  constructor(
    readonly irId: RoomIrId,
    readonly reason: string,
  ) {
    super(`Room IR "${irId}" unavailable: ${reason}`);
    this.name = 'IrUnavailableError';
  }
}

export interface FetchIrLoaderOptions {
  urlFor?: (id: RoomIrId) => string;
  fetchImpl?: typeof fetch;
}

/** Duration tolerance vs the manifest (Opus pre-skip / padding shifts it slightly). */
const DURATION_TOLERANCE = 0.1;

export function validateIr(id: RoomIrId, buffer: AudioBuffer): AudioBuffer {
  const expected = IR_MANIFEST[id]?.durationSeconds;
  if (buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2) {
    throw new IrUnavailableError(id, `${buffer.numberOfChannels} channels`);
  }
  if (expected !== undefined && Math.abs(buffer.duration - expected) > expected * DURATION_TOLERANCE) {
    throw new IrUnavailableError(id, `decoded ${buffer.duration.toFixed(3)} s, expected ${expected} s`);
  }
  return buffer;
}

export function createFetchIrLoader(opts: FetchIrLoaderOptions = {}): IrLoader {
  const urlFor = opts.urlFor ?? irUrl;
  const doFetch = opts.fetchImpl ?? ((input: RequestInfo | URL) => fetch(input));
  const bytes = new Map<RoomIrId, Promise<ArrayBuffer>>();
  const decoded = new WeakMap<BaseAudioContext, Map<RoomIrId, Promise<AudioBuffer>>>();

  const fetchBytes = (id: RoomIrId): Promise<ArrayBuffer> => {
    let pending = bytes.get(id);
    if (!pending) {
      pending = doFetch(urlFor(id)).then(async (res) => {
        if (!res.ok) throw new IrUnavailableError(id, `HTTP ${res.status}`);
        return res.arrayBuffer();
      });
      pending.catch(() => bytes.delete(id));
      bytes.set(id, pending);
    }
    return pending;
  };

  return {
    load(ctx, id) {
      let perContext = decoded.get(ctx);
      if (!perContext) {
        perContext = new Map();
        decoded.set(ctx, perContext);
      }
      let pending = perContext.get(id);
      if (!pending) {
        const cache = perContext;
        pending = fetchBytes(id)
          // decodeAudioData detaches its argument: keep the page-level bytes intact.
          .then((data) => ctx.decodeAudioData(data.slice(0)))
          .then((buffer) => validateIr(id, buffer))
          .catch((err: unknown) => {
            cache.delete(id);
            if (err instanceof IrUnavailableError) throw err;
            throw new IrUnavailableError(id, err instanceof Error ? err.message : String(err));
          });
        perContext.set(id, pending);
      }
      return pending;
    },
  };
}

let shared: IrLoader | null = null;

/** The page-wide loader (live rack and export share the fetched bytes). */
export function sharedIrLoader(): IrLoader {
  shared ??= createFetchIrLoader();
  return shared;
}
