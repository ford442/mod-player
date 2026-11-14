import type { PlaylistItem } from '../components/Playlist';
import type { PlaylistStore } from '../store/playlistStore';

/** The playlist item the playlist itself last loaded. */
export interface PlaylistOwnedLoad {
  readonly id: string;
  readonly fileName: string;
}

export interface AutoAdvanceInput {
  /** What the playlist last loaded; `null` once something else (the library) loaded a song. */
  readonly owned: PlaylistOwnedLoad | null;
  /** The engine's loaded file name (`moduleFileName`), i.e. the song that just ended. */
  readonly endedFileName: string;
  /** Unsaved pattern edits: loading the next song would ask to discard them, so do not advance. */
  readonly patternEditDirty: boolean;
  readonly store: Pick<PlaylistStore, 'current' | 'onTrackEnded'>;
}

/**
 * Phase 1 auto-advance (plain stop-and-load): what to load when a song plays out with the loop off.
 * Only a song the playlist is playing advances it — it loaded it, it is still the current item, and
 * nothing else (a dropped file, the library, a share link) was loaded since. Returns the item to
 * load, after moving the playlist to it (`onTrackEnded`: repeat one / all / none and shuffle), or
 * `null` to stay stopped.
 */
export function playlistItemAfterSongEnded(input: AutoAdvanceInput): PlaylistItem | null {
  const { owned, endedFileName, patternEditDirty, store } = input;
  if (!owned || patternEditDirty) return null;
  const current = store.current();
  if (!current || current.id !== owned.id || owned.fileName !== endedFileName) return null;
  return store.onTrackEnded();
}
