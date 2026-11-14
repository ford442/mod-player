import { describe, expect, it } from 'vitest';
import { LruCache } from '../../utils/lruCache';

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

describe('LruCache byte budget', () => {
  it('evicts least-recently-used entries until the byte total fits', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, number>(100, (key) => evicted.push(key), 100);
    cache.set('a', 1, 40);
    cache.set('b', 2, 40);
    cache.touch('a');
    cache.set('c', 3, 40); // 120 > 100 — 'b' is the LRU entry
    expect(evicted).toEqual(['b']);
    expect(cache.bytes).toBe(80);
    expect(cache.size).toBe(2);
  });

  it('setBytes() charges a pending entry later and evicts over budget', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, number>(100, (key) => evicted.push(key), 100);
    cache.set('a', 1, 60);
    cache.set('b', 2); // pending: costs 0
    expect(evicted).toEqual([]);
    cache.setBytes('b', 60);
    expect(evicted).toEqual(['a']);
    expect(cache.bytes).toBe(60);
  });

  it('does not keep a single entry larger than the budget', () => {
    const cache = new LruCache<string, number>(100, undefined, 100);
    cache.set('small', 1, 10);
    cache.set('huge', 2, 500);
    expect(cache.has('huge')).toBe(false);
    expect(cache.has('small')).toBe(false); // evicted first, oldest-first
    expect(cache.bytes).toBe(0);
  });

  it('re-set and delete keep the byte total exact', () => {
    const cache = new LruCache<string, number>(10, undefined, 1000);
    cache.set('a', 1, 100);
    cache.set('a', 2, 30);
    expect(cache.bytes).toBe(30);
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    expect(cache.bytes).toBe(0);
    cache.set('b', 1, 5);
    cache.clear();
    expect(cache.bytes).toBe(0);
  });
});
