/**
 * The live FX rack owner (#453) — lazy chunk.
 *
 * Follows two sources: the master-graph host (audio/fx/fxHost.ts, published
 * once a context exists — the first play) and the store's `effective` state.
 *
 * - A rack is built per context, bypassed, as soon as there's a host.
 * - When a module becomes active: attach (complementary 10 ms fade of
 *   masterDirect ↔ the rack return, inaudible with every slot bypassed), then
 *   apply the state once the attach fade is done — slots warm up and fade in.
 * - When nothing is active: apply (slots fade out, tails ring), and once the
 *   rack is quiet, collapse back to masterDirect and detach.
 * - A new context (remount, HMR) disposes the old rack and builds a new one.
 */
import { useFxStore } from '../../store/fxStore';
import { isAudioDiagEnabled } from '../../utils/audioDiagOptions';
import { getFxHost, subscribeFxHost, type FxHost } from './fxHost';
import { FxRack } from './FxRack';
import { sharedIrLoader } from './room/irLoader';
import { createContextScheduler } from './scheduler';
import { defaultFxRackState } from './spec/schema';
import { anyModuleActive, FX_MODULE_IDS, type FxModuleId, type FxRackState } from './types';

/** How often a pending collapse re-checks that every tail has rung out. */
const COLLAPSE_POLL_MS = 200;

export interface FxDiagSnapshot {
  attached: boolean;
  active: string[];
  unavailable: string[];
  latencyMs: number;
  tailMs: number;
}

declare global {
  interface Window {
    __FX_DIAG__?: FxDiagSnapshot;
  }
}

class FxRackController {
  private host: FxHost | null = null;
  private rack: FxRack | null = null;
  private building: Promise<FxRack | null> | null = null;
  private syncing: Promise<void> = Promise.resolve();
  private collapseTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribers: (() => void)[] = [];

  start(): void {
    this.unsubscribers.push(
      subscribeFxHost((host) => void this.onHost(host)),
      useFxStore.subscribe((s, prev) => {
        if (s.effective !== prev.effective) this.requestSync();
      }),
    );
    void this.onHost(getFxHost());
  }

  /** Retry a module that was unavailable (e.g. its IR failed to load). */
  retry(id: FxModuleId): void {
    const rack = this.rack;
    if (!rack) return;
    useFxStore.getState().setModuleStatus(id, 'loading');
    void rack.retry(id).then(() => {
      if (rack.unavailable.has(id)) return; // onStatus already reported why
      if (anyModuleActive(useFxStore.getState().effective)) this.requestSync();
    });
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.disposeRack();
  }

  private async onHost(host: FxHost | null): Promise<void> {
    if (host === this.host) return;
    this.disposeRack();
    this.host = host;
    if (host) this.requestSync();
  }

  private disposeRack(): void {
    if (this.collapseTimer !== null) clearTimeout(this.collapseTimer);
    this.collapseTimer = null;
    this.rack?.dispose();
    this.rack = null;
    this.building = null;
  }

  private ensureRack(host: FxHost): Promise<FxRack | null> {
    if (this.rack) return Promise.resolve(this.rack);
    if (!this.building) {
      const store = useFxStore.getState();
      this.building = FxRack.create(host.ctx, defaultFxRackState(), {
        mode: 'live',
        scheduler: createContextScheduler(host.ctx),
        irLoader: sharedIrLoader(),
        onStatus: (module, status, detail) => useFxStore.getState().setModuleStatus(module, status, detail),
      }).then(
        (rack) => {
          if (this.host !== host) {
            rack.dispose();
            return null;
          }
          this.rack = rack;
          store.setRackStatus('ready');
          return rack;
        },
        (err: unknown) => {
          console.error('[FX] Failed to build the FX rack', err);
          useFxStore.getState().setRackStatus('error');
          this.building = null;
          return null;
        },
      );
    }
    return this.building;
  }

  /** Serialized: each sync applies the latest effective state. */
  private requestSync(): void {
    this.syncing = this.syncing.then(() => this.sync()).catch((err: unknown) => {
      console.error('[FX] Sync failed', err);
    });
  }

  private async sync(): Promise<void> {
    const host = this.host;
    if (!host) return; // no context yet: the first play publishes one
    const state = useFxStore.getState().effective;
    const active = anyModuleActive(state);
    if (!active && !this.rack) return; // nothing to do, nothing built
    const rack = await this.ensureRack(host);
    if (!rack || this.host !== host) return;

    if (active) {
      if (this.collapseTimer !== null) {
        clearTimeout(this.collapseTimer);
        this.collapseTimer = null;
      }
      const attach = rack.attach({ masterInput: host.masterInput, masterDirect: host.masterDirect, analyser: host.analyser });
      await rack.apply(state, { at: attach.end });
    } else {
      await rack.apply(state);
      this.scheduleCollapse(rack);
    }
    this.publishDiag(rack, state);
  }

  private scheduleCollapse(rack: FxRack): void {
    if (this.collapseTimer !== null) clearTimeout(this.collapseTimer);
    const check = () => {
      this.collapseTimer = null;
      if (this.rack !== rack || anyModuleActive(useFxStore.getState().effective)) return;
      if (rack.isQuiet()) {
        const window = rack.collapse();
        // The rack detaches on the audio clock after the fade; report it then.
        createContextScheduler(rack.ctx).at(window.end + 0.05, () => {
          if (this.rack === rack) this.publishDiag(rack, useFxStore.getState().effective);
        });
      } else {
        this.collapseTimer = setTimeout(check, COLLAPSE_POLL_MS);
      }
    };
    this.collapseTimer = setTimeout(check, COLLAPSE_POLL_MS);
  }

  private publishDiag(rack: FxRack, state: FxRackState): void {
    if (!isAudioDiagEnabled()) return;
    window.__FX_DIAG__ = {
      attached: rack.isAttached,
      active: FX_MODULE_IDS.filter((id) => state.enabled && state.modules[id].enabled),
      unavailable: [...rack.unavailable],
      latencyMs: rack.latencySeconds() * 1000,
      tailMs: rack.tailSeconds() * 1000,
    };
  }
}

let instance: FxRackController | null = null;

export function startFxRackController(): void {
  if (instance) return;
  instance = new FxRackController();
  instance.start();
}

export function retryFxModule(id: FxModuleId): void {
  instance?.retry(id);
}

/** Tests / teardown. */
export function stopFxRackController(): void {
  instance?.stop();
  instance = null;
}
