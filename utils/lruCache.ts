/**
 * Small bounded least-recently-used cache with an eviction callback.
 *
 * Bounded by entry count (`limit`) and, optionally, by total bytes
 * (`maxBytes`): each `set` can carry the entry's byte cost (`setBytes` updates
 * it later, e.g. once a pending download resolves). Eviction is oldest-first
 * until both bounds hold — an entry larger than `maxBytes` on its own is
 * evicted too, so one oversized value never pins the budget.
 *
 * `get` does not refresh recency; call `touch` (or `set`) on a hit.
 */
export class LruCache<K, V> {
  /** Insertion order of a Map is the recency order: oldest first. */
  private readonly map = new Map<K, { value: V; bytes: number }>();
  private totalBytes = 0;

  constructor(
    private readonly limit: number,
    private readonly onEvict?: (key: K, value: V) => void,
    private readonly maxBytes: number = Number.POSITIVE_INFINITY,
  ) {}

  get(key: K): V | undefined {
    return this.map.get(key)?.value;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Mark `key` as most-recently-used without changing its value. */
  touch(key: K): void {
    const entry = this.map.get(key);
    if (!entry) return;
    this.map.delete(key);
    this.map.set(key, entry);
  }

  /**
   * Insert/replace `key` (costing `bytes`), mark it most-recently-used, then
   * evict over the limits (oldest first).
   */
  set(key: K, value: V, bytes = 0): void {
    const prev = this.map.get(key);
    if (prev) {
      this.totalBytes -= prev.bytes;
      this.map.delete(key);
    }
    const cost = sanitizeBytes(bytes);
    this.map.set(key, { value, bytes: cost });
    this.totalBytes += cost;
    this.evictOverLimits();
  }

  /** Update the byte cost of an existing entry (recency unchanged), then evict over the limits. */
  setBytes(key: K, bytes: number): void {
    const entry = this.map.get(key);
    if (!entry) return;
    const cost = sanitizeBytes(bytes);
    this.totalBytes += cost - entry.bytes;
    entry.bytes = cost;
    this.evictOverLimits();
  }

  /** Remove `key` without calling `onEvict`. Returns whether it was present. */
  delete(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.totalBytes -= entry.bytes;
    this.map.delete(key);
    return true;
  }

  /** Evict every entry (oldest first) and empty the cache. */
  clear(): void {
    const entries = [...this.map];
    this.map.clear();
    this.totalBytes = 0;
    for (const [key, entry] of entries) this.onEvict?.(key, entry.value);
  }

  get size(): number {
    return this.map.size;
  }

  /** Sum of the byte costs of the entries currently held. */
  get bytes(): number {
    return this.totalBytes;
  }

  private evictOverLimits(): void {
    while (this.map.size > this.limit || (this.totalBytes > this.maxBytes && this.map.size > 0)) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      const key = oldest.value;
      const entry = this.map.get(key)!;
      this.map.delete(key);
      this.totalBytes -= entry.bytes;
      this.onEvict?.(key, entry.value);
    }
  }
}

function sanitizeBytes(bytes: number): number {
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}
