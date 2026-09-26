import type { DebugInfo } from './params';

/** Max rate at which debug info reaches React state (and so re-renders PatternDisplay). */
export const DEBUG_INFO_PUBLISH_INTERVAL_MS = 250;

export type DebugInfoAction = DebugInfo | ((prev: DebugInfo) => DebugInfo);

export interface DebugInfoSinkClock {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const defaultClock: DebugInfoSinkClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Accumulates DebugInfo updates in a plain field (a ref, in effect) and
 * publishes them to React state only while the debug panel is open, at most
 * once per `intervalMs`.
 *
 * The WebGPU frame loop reports debug info every frame; routing that straight
 * into a `useState` setter re-rendered PatternDisplay at display rate. With the
 * panel closed, `dispatch` never calls `publish`.
 */
export class DebugInfoSink {
  private current: DebugInfo;
  private lastPublished: DebugInfo | null = null;
  private lastPublishAt = Number.NEGATIVE_INFINITY;
  private timer: unknown = null;
  private open = false;

  constructor(
    initial: DebugInfo,
    private readonly publish: (info: DebugInfo) => void,
    private readonly intervalMs = DEBUG_INFO_PUBLISH_INTERVAL_MS,
    private readonly clock: DebugInfoSinkClock = defaultClock,
  ) {
    this.current = initial;
  }

  /** Latest accumulated info, whether or not it has been published. */
  get snapshot(): DebugInfo {
    return this.current;
  }

  /** Drop-in for a `useState` setter: accepts a value or an updater. Stable identity. */
  readonly dispatch = (action: DebugInfoAction): void => {
    this.current = typeof action === 'function' ? action(this.current) : action;
    if (this.open) this.schedule();
  };

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    if (open) {
      this.cancelTimer();
      this.flush();
    } else {
      this.cancelTimer();
    }
  }

  dispose(): void {
    this.open = false;
    this.cancelTimer();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    const wait = Math.max(0, this.lastPublishAt + this.intervalMs - this.clock.now());
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.flush();
    }, wait);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private flush(): void {
    if (!this.open || this.current === this.lastPublished) return;
    this.lastPublished = this.current;
    this.lastPublishAt = this.clock.now();
    this.publish(this.current);
  }
}
