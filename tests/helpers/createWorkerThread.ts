/**
 * Runs the real module-create worker (workers/openmpt-create.worker.ts) under node:worker_threads:
 * esbuild bundles it, and a few lines map the Web Worker globals it uses (self.onmessage,
 * postMessage) onto parentPort. Paired with tests/helpers/workletScope.ts, this is the whole #513
 * pipeline without a browser: compiled processor ↔ MessagePort ↔ create worker, one shared heap.
 */
import { buildSync } from 'esbuild';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageChannel, Worker, type MessagePort } from 'node:worker_threads';
import { CREATE_WORKER } from '../../audio-worklet/createThreadProtocol';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const SHIM = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
globalThis.postMessage = (m, t) => parentPort.postMessage(m, t);
// The playback glue registers Emscripten's own wasm-worker message listener; nothing sends those here.
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
parentPort.on('message', (data) => { globalThis.onmessage?.({ data }); });
`;

let bundled: string | null = null;
function workerSource(): string {
  if (bundled == null) {
    const out = buildSync({
      entryPoints: [join(ROOT, 'workers/openmpt-create.worker.ts')],
      bundle: true,
      format: 'iife',
      platform: 'neutral',
      target: 'es2022',
      write: false,
    });
    bundled = SHIM + out.outputFiles[0]!.text;
  }
  return bundled;
}

export interface Reply { type: string; [k: string]: unknown }

export class CreateWorkerThread {
  readonly worker: Worker;
  readonly replies: Reply[] = [];
  private wake: (() => void) | null = null;

  constructor() {
    this.worker = new Worker(workerSource(), { eval: true });
    this.worker.on('message', (m: Reply) => { this.replies.push(m); this.wake?.(); });
    this.worker.on('error', (e) => { this.replies.push({ type: 'error', message: String(e) }); this.wake?.(); });
  }

  /** Wait for the next reply of `type` (consumes it). */
  async next(type: string, timeoutMs = 30_000): Promise<Reply> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.replies.findIndex((r) => r.type === type || r.type === 'error');
      if (i >= 0) return this.replies.splice(i, 1)[0]!;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}`);
      await new Promise<void>((r) => { this.wake = r; setTimeout(r, 50); });
    }
  }

  /** A channel: port1 goes to the worker (attachPort), port2 is for the processor. */
  attachPort(): MessagePort {
    const { port1, port2 } = new MessageChannel();
    this.worker.postMessage({ type: CREATE_WORKER.attachPort, port: port1 }, [port1]);
    return port2;
  }

  async terminate(): Promise<void> {
    await this.worker.terminate();
  }
}
