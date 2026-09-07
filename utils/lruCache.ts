/** Small bounded least-recently-used cache with an eviction callback. */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly order: K[] = [];

  constructor(
    private readonly limit: number,
    private readonly onEvict?: (key: K, value: V) => void,
  ) {}

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Mark `key` as most-recently-used without changing its value. */
  touch(key: K): void {
    const idx = this.order.indexOf(key);
    if (idx !== -1) this.order.splice(idx, 1);
    this.order.push(key);
  }

  /** Insert/replace `key`, mark it most-recently-used, then evict over the limit (oldest first). */
  set(key: K, value: V): void {
    this.map.set(key, value);
    this.touch(key);
    while (this.order.length > this.limit) {
      const evictKey = this.order.shift();
      if (evictKey === undefined) break;
      const evictValue = this.map.get(evictKey);
      this.map.delete(evictKey);
      if (evictValue !== undefined) this.onEvict?.(evictKey, evictValue);
    }
  }

  /** Evict every entry (oldest first) and empty the cache. */
  clear(): void {
    for (const key of this.order) {
      const value = this.map.get(key);
      if (value !== undefined) this.onEvict?.(key, value);
    }
    this.map.clear();
    this.order.length = 0;
  }

  get size(): number {
    return this.map.size;
  }
}
