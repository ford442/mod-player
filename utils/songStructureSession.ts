/**
 * The loop region's slot in the per-song memory (#537 phase 2, #511): `SongSession.loopRegion`, keyed
 * on the song fingerprint. A small adapter so the engine takes a plain `{ load, save }` (tests pass a
 * fake) and only this file knows about the session store.
 *
 * Main thread only, from load / user-action handlers — never from the render frame or the worklet
 * (tests/build/songSessionGuards.test.ts).
 */
import type { LoopRegion } from './songStructureLoop';
import { readSongSession, updateSongSession } from './songSession';

export interface LoopRegionStore {
  /** The stored region for `fingerprint` — untrusted: validate with `parseLoopRegion`. */
  load(fingerprint: string): Promise<unknown>;
  /** Remember `region` for `fingerprint`; null forgets it. */
  save(fingerprint: string, region: LoopRegion | null): Promise<void>;
}

export const sessionLoopRegionStore: LoopRegionStore = {
  load: async (fingerprint) => (await readSongSession(fingerprint))?.loopRegion ?? null,
  save: async (fingerprint, region) => {
    await updateSongSession(fingerprint, { loopRegion: region ? { start: region.start, end: region.end } : null });
  },
};
