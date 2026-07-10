/**
 * Generation counter for WebGPU resource lifetimes.
 * Bump on shader switch / matrix rebuild; RAF render skips stale generations.
 */

export class GpuLifecycle {
  private generation = 0;

  /** Invalidate in-flight renders and return the new generation. */
  bump(): number {
    this.generation += 1;
    return this.generation;
  }

  get current(): number {
    return this.generation;
  }

  isCurrent(gen: number): boolean {
    return gen === this.generation;
  }
}
