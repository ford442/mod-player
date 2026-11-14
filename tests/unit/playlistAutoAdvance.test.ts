/**
 * Playlist auto-advance (phase 1: stop-and-load). A song that plays out advances the playlist only
 * when the playlist is what is playing it; everything else (library loads, dropped files, unsaved
 * pattern edits) leaves playback stopped.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { playlistItemAfterSongEnded, type PlaylistOwnedLoad } from '../../app/playlistAutoAdvance';
import { resetPlaylistStore, usePlaylistStore } from '../../store/playlistStore';
import type { PlaylistItem } from '../../components/Playlist';

function item(name: string): PlaylistItem {
  return { id: name, fileName: `${name}.mod`, fileData: new Uint8Array([name.length]) };
}

const store = () => usePlaylistStore.getState();

function owned(name: string): PlaylistOwnedLoad {
  return { id: name, fileName: `${name}.mod` };
}

function ended(input: { owned: PlaylistOwnedLoad | null; endedFileName: string; patternEditDirty?: boolean }) {
  return playlistItemAfterSongEnded({ patternEditDirty: false, store: store(), ...input });
}

beforeEach(() => {
  resetPlaylistStore();
  store().addItems([item('a'), item('b'), item('c')]);
});

describe('playlistItemAfterSongEnded', () => {
  it('advances to the next item when the playlist was playing the current one', () => {
    store().select(0);
    expect(ended({ owned: owned('a'), endedFileName: 'a.mod' })?.id).toBe('b');
    expect(store().currentIndex).toBe(1);
  });

  it('stops at the end of the list with repeat none, wraps with repeat all', () => {
    store().select(2);
    expect(ended({ owned: owned('c'), endedFileName: 'c.mod' })).toBeNull();
    store().cycleRepeat(); // all
    expect(ended({ owned: owned('c'), endedFileName: 'c.mod' })?.id).toBe('a');
  });

  it('replays the same item under repeat one', () => {
    store().select(1);
    store().cycleRepeat();
    store().cycleRepeat(); // one
    expect(ended({ owned: owned('b'), endedFileName: 'b.mod' })?.id).toBe('b');
    expect(store().currentIndex).toBe(1);
  });

  it('does nothing when the playlist did not load what played (library, dropped file)', () => {
    store().select(0);
    expect(ended({ owned: null, endedFileName: 'a.mod' })).toBeNull();
    expect(ended({ owned: owned('a'), endedFileName: 'dropped.it' })).toBeNull();
    expect(store().currentIndex).toBe(0);
  });

  it('does nothing when the owned item is no longer current (removed, or another selected)', () => {
    store().select(0);
    store().remove(0); // current becomes b
    expect(ended({ owned: owned('a'), endedFileName: 'a.mod' })).toBeNull();
    expect(store().current()?.id).toBe('b');
  });

  it('does not advance over unsaved pattern edits', () => {
    store().select(0);
    expect(ended({ owned: owned('a'), endedFileName: 'a.mod', patternEditDirty: true })).toBeNull();
    expect(store().currentIndex).toBe(0);
  });
});
