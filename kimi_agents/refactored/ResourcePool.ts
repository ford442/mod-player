/**
 * ResourcePool - Manages GPU buffer and texture pooling to prevent memory leaks
 * and reduce allocation overhead.
 */

interface PooledResource<T> {
  resource: T;
  lastUsed: number;
  size: number;
}

interface BufferPoolConfig {
  maxPoolSize?: number;      // Maximum number of buffers to keep in pool
  maxMemoryMB?: number;      // Maximum memory for pooled buffers
  expirationMs?: number;     // Time before unused buffers are cleaned up
}

export class BufferPool {
  private pools: Map<number, PooledResource<GPUBuffer>[]> = new Map();
  private inUse: Map<GPUBuffer, { size: number; acquiredAt: number }> = new Map();
  private totalPooledMemory = 0;
  private cleanupInterval: number | null = null;
  
  constructor(
    private device: GPUDevice,
    private config: BufferPoolConfig = {}
  ) {
    this.config = {
      maxPoolSize: 50,
      maxMemoryMB: 128,
      expirationMs: 30000,
      ...config,
    };
    
    // Start cleanup interval
    this.cleanupInterval = window.setInterval(() => {
      this.performCleanup();
    }, 10000);
  }

  /**
   * Acquire a buffer from the pool or create a new one
   */
  acquire(
    size: number,
    usage: GPUBufferUsageFlags,
    label?: string
  ): GPUBuffer {
    const pool = this.pools.get(size);
    
    if (pool && pool.length > 0) {
      const pooled = pool.pop()!;
      this.totalPooledMemory -= pooled.size;
      this.inUse.set(pooled.resource, { size, acquiredAt: Date.now() });
      return pooled.resource;
    }
    
    // Create new buffer
    const buffer = this.device.createBuffer({
      size,
      usage,
      label,
    });
    
    this.inUse.set(buffer, { size, acquiredAt: Date.now() });
    return buffer;
  }

  /**
   * Release a buffer back to the pool
   */
  release(buffer: GPUBuffer): void {
    const info = this.inUse.get(buffer);
    if (!info) {
      console.warn('Releasing buffer that was not acquired from pool');
      buffer.destroy();
      return;
    }
    
    this.inUse.delete(buffer);
    
    // Check if we should pool this buffer
    const maxMemoryBytes = (this.config.maxMemoryMB || 128) * 1024 * 1024;
    const pool = this.pools.get(info.size) || [];
    
    if (pool.length < (this.config.maxPoolSize || 50) && 
        this.totalPooledMemory + info.size < maxMemoryBytes) {
      pool.push({
        resource: buffer,
        lastUsed: Date.now(),
        size: info.size,
      });
      this.pools.set(info.size, pool);
      this.totalPooledMemory += info.size;
    } else {
      // Don't pool, destroy immediately
      buffer.destroy();
    }
  }

  /**
   * Acquire a buffer and write data to it
   */
  acquireWithData(
    data: BufferSource,
    usage: GPUBufferUsageFlags,
    label?: string
  ): GPUBuffer {
    const buffer = this.acquire(data.byteLength, usage, label);
    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  /**
   * Get statistics about pool usage
   */
  getStats(): {
    pooledBuffers: number;
    inUseBuffers: number;
    pooledMemoryMB: number;
    inUseMemoryMB: number;
  } {
    let pooledBuffers = 0;
    for (const pool of this.pools.values()) {
      pooledBuffers += pool.length;
    }
    
    let inUseMemory = 0;
    for (const info of this.inUse.values()) {
      inUseMemory += info.size;
    }
    
    return {
      pooledBuffers,
      inUseBuffers: this.inUse.size,
      pooledMemoryMB: this.totalPooledMemory / (1024 * 1024),
      inUseMemoryMB: inUseMemory / (1024 * 1024),
    };
  }

  /**
   * Clean up expired pooled buffers
   */
  private performCleanup(): void {
    const now = Date.now();
    const expirationMs = this.config.expirationMs || 30000;
    
    for (const [size, pool] of this.pools.entries()) {
      const toKeep: PooledResource<GPUBuffer>[] = [];
      
      for (const item of pool) {
        if (now - item.lastUsed < expirationMs) {
          toKeep.push(item);
        } else {
          item.resource.destroy();
          this.totalPooledMemory -= item.size;
        }
      }
      
      if (toKeep.length > 0) {
        this.pools.set(size, toKeep);
      } else {
        this.pools.delete(size);
      }
    }
  }

  /**
   * Destroy all pooled resources and clean up
   */
  destroy(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Destroy all pooled buffers
    for (const pool of this.pools.values()) {
      for (const item of pool) {
        item.resource.destroy();
      }
    }
    this.pools.clear();
    
    // Destroy all in-use buffers
    for (const buffer of this.inUse.keys()) {
      buffer.destroy();
    }
    this.inUse.clear();
    
    this.totalPooledMemory = 0;
  }
}

/**
 * TextureManager - Manages texture loading with LRU cache and memory limits
 */
interface TextureEntry {
  texture: GPUTexture;
  view: GPUTextureView;
  size: number;
  lastUsed: number;
  refCount: number;
}

export class TextureManager {
  private cache: Map<string, TextureEntry> = new Map();
  private totalMemory = 0;
  private readonly maxMemory: number;

  constructor(
    private device: GPUDevice,
    maxMemoryMB: number = 256
  ) {
    this.maxMemory = maxMemoryMB * 1024 * 1024;
  }

  async loadFromURL(
    url: string,
    format: GPUTextureFormat = 'rgba8unorm'
  ): Promise<{ texture: GPUTexture; view: GPUTextureView }> {
    // Check cache
    const cached = this.cache.get(url);
    if (cached) {
      cached.lastUsed = Date.now();
      cached.refCount++;
      return { texture: cached.texture, view: cached.view };
    }

    // Load image
    const response = await fetch(url);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    // Calculate size
    const bytesPerPixel = this.getBytesPerPixel(format);
    const size = bitmap.width * bitmap.height * bytesPerPixel;

    // Evict if necessary
    if (this.totalMemory + size > this.maxMemory) {
      this.evictLRU(size);
    }

    // Create texture
    const texture = this.device.createTexture({
      size: [bitmap.width, bitmap.height],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture },
      [bitmap.width, bitmap.height]
    );

    const view = texture.createView();

    // Cache
    this.cache.set(url, {
      texture,
      view,
      size,
      lastUsed: Date.now(),
      refCount: 1,
    });
    this.totalMemory += size;

    return { texture, view };
  }

  release(url: string): void {
    const entry = this.cache.get(url);
    if (entry) {
      entry.refCount--;
      if (entry.refCount <= 0) {
        // Don't destroy immediately, let LRU handle it
        entry.lastUsed = 0; // Mark as oldest
      }
    }
  }

  private evictLRU(neededSpace: number): void {
    const entries = Array.from(this.cache.entries())
      .filter(([, e]) => e.refCount <= 0)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    let freed = 0;
    for (const [url, entry] of entries) {
      if (freed >= neededSpace) break;
      
      entry.texture.destroy();
      this.cache.delete(url);
      freed += entry.size;
      this.totalMemory -= entry.size;
    }
  }

  private getBytesPerPixel(format: GPUTextureFormat): number {
    switch (format) {
      case 'rgba8unorm':
      case 'rgba8unorm-srgb':
      case 'bgra8unorm':
        return 4;
      case 'rgba16float':
        return 8;
      case 'rgba32float':
        return 16;
      default:
        return 4;
    }
  }

  getStats(): { cachedTextures: number; totalMemoryMB: number } {
    return {
      cachedTextures: this.cache.size,
      totalMemoryMB: this.totalMemory / (1024 * 1024),
    };
  }

  destroy(): void {
    for (const entry of this.cache.values()) {
      entry.texture.destroy();
    }
    this.cache.clear();
    this.totalMemory = 0;
  }
}
