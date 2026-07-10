/**
 * Tracks WebGPU buffers/textures and recycles same-sized pattern buffers.
 * Dev-only counters: created vs destroyed vs pooled reuse.
 */

export type GpuDisposable = { destroy(): void };

export type GpuResourceScope = 'shader' | 'matrix' | 'persistent';

export interface GpuResourcePoolStats {
  created: number;
  destroyed: number;
  reused: number;
  pooled: number;
  alive: number;
  pooledBuffers: number;
}

function bufferPoolKey(label: string, size: number, usage: GPUBufferUsageFlags): string {
  return `${label}:${size}:${usage}`;
}

export class GpuResourcePool {
  private readonly alive = new Set<GpuDisposable>();
  private readonly scopes = new Map<GpuResourceScope, Set<GpuDisposable>>();
  private readonly bufferPool = new Map<string, GPUBuffer>();
  private disposed = false;
  private stats = { created: 0, destroyed: 0, reused: 0, pooled: 0 };

  constructor(private readonly device: GPUDevice) {}

  get isDisposed(): boolean {
    return this.disposed;
  }

  get deviceRef(): GPUDevice {
    return this.device;
  }

  track<T extends GpuDisposable>(resource: T, scope: GpuResourceScope = 'shader'): T {
    if (this.disposed) {
      throw new Error('[GpuResourcePool] Cannot track resource on disposed pool');
    }
    this.alive.add(resource);
    let bucket = this.scopes.get(scope);
    if (!bucket) {
      bucket = new Set();
      this.scopes.set(scope, bucket);
    }
    bucket.add(resource);
    this.stats.created++;
    return resource;
  }

  /** Returns true when the resource is still tracked (not destroyed). */
  isAlive(resource: GpuDisposable | null | undefined): boolean {
    return resource != null && this.alive.has(resource);
  }

  /**
   * Reuse a pooled buffer when size/usage match, otherwise create a new one.
   * `fill` runs after acquisition (writeBuffer for recycled buffers).
   */
  acquireBuffer(
    label: string,
    size: number,
    usage: GPUBufferUsageFlags,
    fill: (buffer: GPUBuffer) => void,
    scope: GpuResourceScope = 'matrix',
  ): GPUBuffer {
    if (this.disposed) {
      throw new Error('[GpuResourcePool] Cannot acquire buffer on disposed pool');
    }
    const key = bufferPoolKey(label, size, usage);
    const pooled = this.bufferPool.get(key);
    if (pooled && this.alive.has(pooled)) {
      this.bufferPool.delete(key);
      this.stats.reused++;
      fill(pooled);
      return pooled;
    }
    const buffer = this.device.createBuffer({
      size: Math.max(16, size),
      usage,
    });
    this.track(buffer, scope);
    fill(buffer);
    return buffer;
  }

  /** Return a buffer to the pool for reuse, or destroy when disposed / pool cap exceeded. */
  releaseBuffer(label: string, buffer: GPUBuffer | null | undefined, usage: GPUBufferUsageFlags): void {
    if (!buffer || !this.alive.has(buffer)) return;
    if (this.disposed) {
      this.destroyTracked(buffer);
      return;
    }
    const key = bufferPoolKey(label, buffer.size, usage);
    if (this.bufferPool.has(key)) {
      this.destroyTracked(buffer);
      return;
    }
    for (const bucket of this.scopes.values()) {
      bucket.delete(buffer);
    }
    this.bufferPool.set(key, buffer);
    this.stats.pooled++;
  }

  destroyTracked(resource: GpuDisposable | null | undefined): void {
    if (!resource || !this.alive.has(resource)) return;
    try {
      resource.destroy();
    } catch {
      // Already destroyed or device lost.
    }
    this.alive.delete(resource);
    for (const bucket of this.scopes.values()) {
      bucket.delete(resource);
    }
    for (const [key, buf] of this.bufferPool.entries()) {
      if (buf === resource) this.bufferPool.delete(key);
    }
    this.stats.destroyed++;
  }

  disposeScope(scope: GpuResourceScope): void {
    const bucket = this.scopes.get(scope);
    if (!bucket) return;
    for (const resource of [...bucket]) {
      if (resource instanceof GPUBuffer) {
        // Buffers may already be in the pool — skip double-free.
        let inPool = false;
        for (const pooled of this.bufferPool.values()) {
          if (pooled === resource) {
            inPool = true;
            break;
          }
        }
        if (inPool) continue;
      }
      this.destroyTracked(resource);
    }
    bucket.clear();
  }

  disposeAll(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const buffer of this.bufferPool.values()) {
      this.destroyTracked(buffer);
    }
    this.bufferPool.clear();
    for (const resource of [...this.alive]) {
      this.destroyTracked(resource);
    }
    this.scopes.clear();
  }

  getStats(): GpuResourcePoolStats {
    return {
      ...this.stats,
      alive: this.alive.size,
      pooledBuffers: this.bufferPool.size,
    };
  }

  logStats(label = 'GpuResourcePool'): void {
    const s = this.getStats();
    console.log(
      `[${label}] created=${s.created} destroyed=${s.destroyed} reused=${s.reused} ` +
        `pooled=${s.pooled} alive=${s.alive} pooledBuffers=${s.pooledBuffers}`,
    );
  }
}
