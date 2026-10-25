/**
 * Main-thread owner of the module-create worker (#513, audio-worklet/createThreadProtocol.ts).
 *
 * The worklet announces its shared-memory heap (WT.createHeap) after initLib; this starts one
 * worker per heap (= per AudioWorkletGlobalScope, i.e. per page session) and gives each new
 * AudioWorkletNode a MessagePort to it. From then on `postModuleLoad` sends module bytes to the
 * worker instead of the worklet: the parse runs there, and the worklet only swaps the finished
 * module in. Until the worker is up — the very first load of a session, which races the
 * handshake — or if it fails, loads go to the worklet as before (`postLoad`).
 */
import createWorkerUrl from '../../workers/openmpt-create.worker.ts?worker&url';
import { CREATE_WORKER, CREATE_WORKER_REPLY } from '../../audio-worklet/createThreadProtocol';
import {
  postAttachCreatePort,
  postLoad,
  type WorkletCreateHeapMessage,
} from '../../audio-worklet/protocol';
import { createLogger } from '../../utils/log';

const log = createLogger('CreateWorker');

/** What the worker boots from: the playback glue and the playback wasm, compiled here. */
export interface CreateWorkerAssets {
  scriptText: string;
  wasmModule: Promise<WebAssembly.Module>;
}

interface CreateWorkerHost {
  worker: Worker;
  heapId: number;
  ready: boolean;
  node: AudioWorkletNode | null;
  seq: number;
  /** Loads the worker has not answered: re-sent to the worklet if the worker dies. */
  inflight: Map<number, () => void>;
}

let host: CreateWorkerHost | null = null;

/**
 * The playback pair most recently sent to a worklet, for booting the worker when its heap is
 * announced. Module state, not a closure of the start call: the app re-runs the start path
 * (hot reload) right after creating a node, which replaces the port handler before the
 * worklet's `createHeap` may have arrived.
 */
let pendingAssets: CreateWorkerAssets | null = null;

/** Remember the playback pair a new node is being booted with (see `pendingAssets`). */
export function prepareCreateWorker(assets: CreateWorkerAssets): void {
  pendingAssets = assets;
}

/**
 * Create off the audio thread only on a crossOriginIsolated page (a shared WebAssembly.Memory
 * needs it). `?audioCreate=worklet` keeps the in-worklet create, for A/B measurement.
 */
export function wantsCreateThread(): boolean {
  if (typeof window === 'undefined' || !window.crossOriginIsolated) return false;
  if (typeof SharedArrayBuffer === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('audioCreate') !== 'worklet';
  } catch {
    return true;
  }
}

function fail(h: CreateWorkerHost, reason: string): void {
  console.warn(`[CreateWorker] create worker unavailable — loads create in the worklet again: ${reason}`);
  if (host === h) host = null;
  try { h.worker.terminate(); } catch { /* ignore */ }
  const pending = [...h.inflight.values()];
  h.inflight.clear();
  for (const resend of pending) resend();
}

function onReply(h: CreateWorkerHost, data: unknown): void {
  const msg = data as { type?: string; seq?: number; ok?: boolean; createMs?: number; message?: string; error?: string };
  if (msg.type === CREATE_WORKER_REPLY.ready) {
    h.ready = true;
    log.log('create worker ready — module loads now parse off the audio thread');
  } else if (msg.type === CREATE_WORKER_REPLY.initFailed) {
    fail(h, msg.message ?? 'init failed');
  } else if (msg.type === CREATE_WORKER_REPLY.created && typeof msg.seq === 'number') {
    h.inflight.delete(msg.seq);
    log.log(`create #${msg.seq} ${msg.ok ? 'ok' : 'failed'} in ${(msg.createMs ?? 0).toFixed(1)} ms (off the audio thread)`);
  }
}

/**
 * The worklet announced its heap: start the worker for it (once, from the pair given to
 * `prepareCreateWorker`) and connect `node` to it. A node that reuses the scope's existing heap
 * finds the worker already running.
 */
export function attachCreateWorker(node: AudioWorkletNode, heap: WorkletCreateHeapMessage): void {
  // Same heap (a restarted node in the same scope) keeps its worker. A new heap means a new scope:
  // the old heap is gone with it, so stopping its worker cannot strand a lock anyone still needs.
  if (host && host.heapId !== heap.heapId) fail(host, 'the worklet heap changed');
  if (!host) {
    const assets = pendingAssets;
    if (!assets) {
      console.warn('[CreateWorker] heap announced but no playback assets to boot a worker — staying in-worklet');
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(createWorkerUrl, { type: 'module' });
    } catch (err) {
      console.warn('[CreateWorker] could not start the create worker:', err);
      return;
    }
    const h: CreateWorkerHost = { worker, heapId: heap.heapId, ready: false, node: null, seq: 0, inflight: new Map() };
    host = h;
    worker.onmessage = (e: MessageEvent) => onReply(h, e.data);
    worker.onerror = (e: ErrorEvent) => fail(h, e.message || 'worker error');
    assets.wasmModule.then(
      (wasmModule) => {
        worker.postMessage({
          type: CREATE_WORKER.init,
          scriptText: assets.scriptText,
          wasmModule,
          memory: heap.memory,
          stackLow: heap.stackLow,
          stackSize: heap.stackSize,
        });
      },
      (err: unknown) => fail(h, `wasm compile failed: ${String(err)}`),
    );
  }

  const channel = new MessageChannel();
  host.worker.postMessage({ type: CREATE_WORKER.attachPort, port: channel.port1 }, [channel.port1]);
  node.port.postMessage(postAttachCreatePort(channel.port2), [channel.port2]);
  host.node = node;
}

/** True when loads for `node` go to the create worker. */
export function createWorkerReadyFor(node: AudioWorkletNode): boolean {
  return host != null && host.ready && host.node === node;
}

/**
 * Send a module to `node`: to the create worker when it serves this node, else to the worklet.
 * Either way the worklet answers with `loaded` or `error`, so callers don't care which ran.
 * The bytes are copied, not transferred, so a dying worker's loads can still be re-sent.
 */
export function postModuleLoad(node: AudioWorkletNode, moduleData: ArrayBuffer): void {
  const h = host;
  if (!h || !h.ready || h.node !== node) {
    node.port.postMessage(postLoad(moduleData));
    return;
  }
  const seq = ++h.seq;
  h.inflight.set(seq, () => node.port.postMessage(postLoad(moduleData)));
  h.worker.postMessage({ type: CREATE_WORKER.create, seq, moduleData });
}

/** Tear the worker down (tests). The worklet's next loads create in-worklet. */
export function disposeCreateWorker(): void {
  pendingAssets = null;
  if (!host) return;
  const h = host;
  host = null;
  h.inflight.clear();
  try { h.worker.terminate(); } catch { /* ignore */ }
}
