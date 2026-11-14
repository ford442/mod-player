/**
 * Playlist store: selection must return the item synchronously (the old hook returned null from
 * select() while an index update was pending, so clicking a playlist row loaded nothing), and
 * auto-advance / repeat / shuffle navigation must be deterministic.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetPlaylistStore, setPlaylistRandom, usePlaylistStore } from '../../store/playlistStore';
import type { PlaylistItem } from '../../components/Playlist';

function item(name: string): PlaylistItem {
  return { id: name, fileName: `${name}.mod`, fileData: new Uint8Array([name.length]) };
}

const store = () => usePlaylistStore.getState();

beforeEach(() => {
  resetPlaylistStore();
  store().addItems([item('a'), item('b'), item('c')]);
});

afterEach(() => {
  setPlaylistRandom(null);
});

describe('playlist selection', () => {
  it('select() returns the item at once and makes it current', () => {
    expect(store().select(1)?.id).toBe('b');
    expect(store().currentIndex).toBe(1);
    expect(store().current()?.id).toBe('b');
  });

  it('select() of an out-of-range index returns null and changes nothing', () => {
    store().select(0);
    expect(store().select(5)).toBeNull();
    expect(store().select(-1)).toBeNull();
    expect(store().currentIndex).toBe(0);
  });

  it('works back to back without waiting for a render', () => {
    expect(store().select(2)?.id).toBe('c');
    expect(store().select(0)?.id).toBe('a');
    expect(store().next()?.id).toBe('b');
  });

  it('addFiles appends in the given order', async () => {
    resetPlaylistStore();
    const files = [new File([new Uint8Array([1])], 'one.xm'), new File([new Uint8Array([2, 2])], 'two.it')];
    await store().addFiles(files);
    expect(store().items.map((i) => i.fileName)).toEqual(['one.xm', 'two.it']);
    expect(Array.from(store().items[1]?.fileData ?? [])).toEqual([2, 2]);
  });
});

describe('next / prev', () => {
  it('walks forward and stops at the end without repeat', () => {
    expect(store().next()?.id).toBe('a'); // from -1
    expect(store().next()?.id).toBe('b');
    expect(store().next()?.id).toBe('c');
    expect(store().next()).toBeNull();
    expect(store().currentIndex).toBe(2);
  });

  it('wraps with repeat all, both ways', () => {
    store().cycleRepeat(); // all
    store().select(2);
    expect(store().next()?.id).toBe('a');
    expect(store().prev()?.id).toBe('c');
  });

  it('prev stops at the start without repeat', () => {
    store().select(0);
    expect(store().prev()).toBeNull();
    expect(store().currentIndex).toBe(0);
  });

  it('returns null on an empty playlist', () => {
    resetPlaylistStore();
    expect(store().next()).toBeNull();
    expect(store().prev()).toBeNull();
    expect(store().onTrackEnded()).toBeNull();
  });
});

describe('auto-advance (onTrackEnded)', () => {
  it('advances to the next item, then ends the playlist', () => {
    store().select(1);
    expect(store().onTrackEnded()?.id).toBe('c');
    expect(store().onTrackEnded()).toBeNull();
  });

  it('replays the current item under repeat one', () => {
    store().cycleRepeat(); // all
    store().cycleRepeat(); // one
    expect(store().repeat).toBe('one');
    store().select(1);
    expect(store().onTrackEnded()?.id).toBe('b');
    expect(store().currentIndex).toBe(1);
  });

  it('loops the playlist under repeat all', () => {
    store().cycleRepeat();
    store().select(2);
    expect(store().onTrackEnded()?.id).toBe('a');
  });
});

describe('shuffle', () => {
  it('never picks the current track and prev walks back through history', () => {
    store().toggleShuffle();
    setPlaylistRandom(() => 0); // lowest index other than the current one
    store().select(0);
    expect(store().next()?.id).toBe('b');
    expect(store().next()?.id).toBe('a');
    setPlaylistRandom(() => 0.99);
    expect(store().next()?.id).toBe('c');
    expect(store().prev()?.id).toBe('a');
    expect(store().prev()?.id).toBe('b');
    expect(store().prev()?.id).toBe('a');
  });
});

describe('remove', () => {
  it('keeps the current item current when an earlier one is removed', () => {
    store().select(2);
    store().remove(0);
    expect(store().current()?.id).toBe('c');
  });

  it('clamps the index when the last (current) item is removed', () => {
    store().select(2);
    store().remove(2);
    expect(store().currentIndex).toBe(1);
  });

  it('clear() empties the list', () => {
    store().select(1);
    store().clear();
    expect(store().items).toHaveLength(0);
    expect(store().currentIndex).toBe(-1);
  });
});
