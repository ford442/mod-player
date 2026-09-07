import { describe, expect, it } from 'vitest';
import { LruCache } from '../utils/lruCache';

describe('LruCache', () => {
  it('returns stored values and reports absence', () => {
    const cache = new LruCache<string, number>(3);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.has('a')).toBe(true);
    expect(cache.get('missing')).toBeUndefined();
    expect(cache.has('missing')).toBe(false);
  });

  it('evicts the least-recently-used entry once over the limit', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, number>(2, (key) => evicted.push(key));
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // over limit — 'a' is oldest, evicted
    expect(evicted).toEqual(['a']);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.size).toBe(2);
  });

  it('touch() protects a key from eviction by marking it recently used', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, number>(2, (key) => evicted.push(key));
    cache.set('a', 1);
    cache.set('b', 2);
    cache.touch('a'); // 'a' is now more recent than 'b'
    cache.set('c', 3); // over limit — 'b' is now oldest
    expect(evicted).toEqual(['b']);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('re-set of an existing key refreshes recency without duplicating eviction order', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, number>(2, (key) => evicted.push(key));
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // re-inserting 'a' should make 'b' the oldest
    cache.set('c', 3);
    expect(evicted).toEqual(['b']);
    expect(cache.get('a')).toBe(10);
  });

  it('clear() evicts every remaining entry in LRU order and empties the cache', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, number>(5, (key) => evicted.push(key));
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(evicted).toEqual(['a', 'b']);
    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
  });

  it('supports a cache with no eviction callback', () => {
    const cache = new LruCache<string, number>(1);
    cache.set('a', 1);
    expect(() => cache.set('b', 2)).not.toThrow();
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe(2);
  });
});
