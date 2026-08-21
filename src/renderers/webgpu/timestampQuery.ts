/**
 * Optional `timestamp-query` wrapper for GPU pass timing.
 *
 * ## Feature policy
 *
 * `timestamp-query` follows the same rule as `float32-filterable` in
 * utils/webgpuDevice.ts: requested only when the adapter reports it, never
 * required. Adapters without it (and lite mode, which never asks) get
 * `create()` → `null` and the debug panel says so instead of showing numbers.
 *
 * ## Accuracy
 *
 * Browsers quantise timestamp values (Chrome to 100 µs by default) unless the
 * user runs with `--enable-webgpu-developer-features`. Treat the numbers as
 * relative pass costs, not absolute microbenchmarks.
 */

/** The optional GPU feature this module needs. */
export const TIMESTAMP_QUERY_FEATURE = 'timestamp-query' as GPUFeatureName;

/** True when the device enabled `timestamp-query`. */
export function deviceHasTimestampQuery(device: GPUDevice | null | undefined): boolean {
  if (!device) return false;
  try {
    return device.features.has(TIMESTAMP_QUERY_FEATURE);
  } catch {
    return false;
  }
}

/** Nanoseconds → milliseconds. */
const NS_PER_MS = 1_000_000;

/**
 * Records begin/end timestamps for a fixed set of named passes.
 *
 * Usage per frame:
 *   const writes = recorder.timestampWrites('compute');   // pass descriptor field
 *   …encode passes…
 *   recorder.resolve(encoder);                            // outside every pass
 *   device.queue.submit([encoder.finish()]);
 *   recorder.poll();                                      // async readback
 */
export class GpuTimestampRecorder {
  private readonly slots = new Map<string, number>();
  private readonly durationsMs = new Map<string, number>();
  private readonly writtenThisFrame = new Set<string>();
  private mapPending = false;
  private disposed = false;

  private constructor(
    private readonly querySet: GPUQuerySet,
    private readonly resolveBuffer: GPUBuffer,
    private readonly stagingBuffer: GPUBuffer,
    labels: readonly string[],
  ) {
    labels.forEach((label, i) => this.slots.set(label, i * 2));
  }

  /**
   * Allocate a recorder for `labels`, or return null when the device lacks
   * `timestamp-query` (or resource creation fails — never a hard error).
   */
  static create(
    device: GPUDevice | null | undefined,
    labels: readonly string[],
  ): GpuTimestampRecorder | null {
    if (!device || labels.length === 0) return null;
    if (!deviceHasTimestampQuery(device)) return null;

    const count = labels.length * 2;
    const byteLength = count * 8; // u64 per query
    try {
      const querySet = device.createQuerySet({ type: 'timestamp', count });
      const resolveBuffer = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      const stagingBuffer = device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      return new GpuTimestampRecorder(querySet, resolveBuffer, stagingBuffer, labels);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn(
          '[WebGPU] timestamp-query resource creation failed; GPU pass timing disabled:',
          err instanceof Error ? err.message : err,
        );
      }
      return null;
    }
  }

  /**
   * Timestamp writes for one pass descriptor. Returns undefined for an unknown
   * label so callers can spread it unconditionally.
   */
  timestampWrites(label: string): GPURenderPassTimestampWrites | undefined {
    if (this.disposed) return undefined;
    const base = this.slots.get(label);
    if (base === undefined) return undefined;
    this.writtenThisFrame.add(label);
    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex: base,
      endOfPassWriteIndex: base + 1,
    };
  }

  /**
   * Resolve this frame's queries into the staging buffer. Call once, after
   * every pass has ended and before `encoder.finish()`.
   */
  resolve(encoder: GPUCommandEncoder): void {
    if (this.disposed || this.writtenThisFrame.size === 0) return;
    // Skip while a readback still owns the staging buffer — dropping a frame of
    // timing data is cheaper than stalling the queue.
    if (this.mapPending) return;
    try {
      encoder.resolveQuerySet(this.querySet, 0, this.slots.size * 2, this.resolveBuffer, 0);
      encoder.copyBufferToBuffer(
        this.resolveBuffer,
        0,
        this.stagingBuffer,
        0,
        this.slots.size * 2 * 8,
      );
    } catch {
      /* device lost mid-frame — timings are best-effort */
    }
  }

  /** Kick an async readback of the last resolved frame. Call after submit. */
  poll(): void {
    if (this.disposed || this.mapPending || this.writtenThisFrame.size === 0) return;
    const labelsThisFrame = [...this.writtenThisFrame];
    this.writtenThisFrame.clear();
    this.mapPending = true;

    this.stagingBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        if (this.disposed) return;
        const raw = new BigInt64Array(this.stagingBuffer.getMappedRange().slice(0));
        for (const label of labelsThisFrame) {
          const base = this.slots.get(label);
          if (base === undefined) continue;
          const begin = raw[base];
          const end = raw[base + 1];
          if (begin === undefined || end === undefined) continue;
          const delta = end - begin;
          // A zero/negative delta means the query never landed this frame.
          if (delta <= 0n) continue;
          this.durationsMs.set(label, Number(delta) / NS_PER_MS);
        }
      })
      .catch(() => {
        /* unmapped by dispose(), or device lost — drop this sample */
      })
      .finally(() => {
        if (!this.disposed) {
          try {
            this.stagingBuffer.unmap();
          } catch {
            /* already unmapped */
          }
        }
        this.mapPending = false;
      });
  }

  /** Last known duration per label, in milliseconds. */
  report(): Record<string, number> {
    return Object.fromEntries(this.durationsMs);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.querySet.destroy(); } catch { /* device may be lost */ }
    try { this.resolveBuffer.destroy(); } catch { /* device may be lost */ }
    try { this.stagingBuffer.destroy(); } catch { /* device may be lost */ }
    this.durationsMs.clear();
    this.writtenThisFrame.clear();
  }
}
