/**
 * The OS media controls (media keys, lock screen, the browser's media card) follow the engine (#492):
 * the playback state comes from a snapshot subscription, not from a React effect, and the media keys go
 * through the command bus like every other input surface (source 'mediaSession').
 */
import type { CommandSource, PlayerCommandId } from '../../utils/playerCommands';
import { mediaSessionPlaybackState } from '../../utils/transportClock';
import type { PlayerEngine } from './PlayerEngine';

export interface CommandDispatcher {
  dispatch(id: PlayerCommandId, source: CommandSource): unknown;
}

const ACTIONS: ReadonlyArray<readonly [MediaSessionAction, PlayerCommandId]> = [
  ['play', 'transport.play'],
  ['pause', 'transport.pause'],
  ['seekforward', 'seek.forwardRow'],
  ['seekbackward', 'seek.backwardRow'],
];

/** Mirror the transport to `navigator.mediaSession` and route its actions; returns the unbind function. */
export function bindMediaSession(
  engine: Pick<PlayerEngine, 'subscribe' | 'getSnapshot'>,
  bus: CommandDispatcher,
): () => void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return () => {};
  const session = navigator.mediaSession;

  let published: MediaSessionPlaybackState | null = null;
  const sync = () => {
    // Paused maps to 'paused', not 'none': 'none' dismisses the OS card, so the user could not resume.
    const state = mediaSessionPlaybackState(engine.getSnapshot().transportState);
    if (state !== published) {
      published = state;
      session.playbackState = state;
    }
  };
  sync();
  const unsubscribe = engine.subscribe(sync);

  for (const [action, id] of ACTIONS) {
    session.setActionHandler(action, () => { bus.dispatch(id, 'mediaSession'); });
  }

  return () => {
    unsubscribe();
    for (const [action] of ACTIONS) session.setActionHandler(action, null);
  };
}
