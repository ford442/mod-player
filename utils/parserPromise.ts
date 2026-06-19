/**
 * Low-level promise wrapper around a Web Worker parse call.
 *
 * - Attaches message / error / messageerror listeners.
 * - Rejects with a timeout if no response arrives within `timeoutMs`.
 * - Terminates the worker on timeout.
 * - Guarantees listener cleanup on every path (success, error, timeout,
 *   postMessage exception).
 */
export interface ParserPromiseOptions<T> {
  /** Return true to resolve the promise with this message. */
  shouldResolve: (data: T) => boolean;
  /** Called for messages that do not resolve the promise (e.g. progress). */
  onIntermediate?: (data: T) => void;
}

export interface ParserPromiseControls<T> {
  promise: Promise<T>;
  cleanup: () => void;
}

export function createParserPromise<T>(
  worker: Worker,
  timeoutMs: number,
  post: () => void,
  options: ParserPromiseOptions<T>,
): ParserPromiseControls<T> {
  let settled = false;
  let timer = 0;
  let workerTerminated = false;

  let onMessage: (e: MessageEvent<T>) => void;
  let onError: (e: ErrorEvent) => void;
  let onMessageError: () => void;

  const cleanup = () => {
    if (settled) return;
    settled = true;
    if (timer) {
      window.clearTimeout(timer);
      timer = 0;
    }
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    worker.removeEventListener('messageerror', onMessageError);
  };

  const promise = new Promise<T>((resolve, reject) => {
    timer = window.setTimeout(() => {
      cleanup();
      if (!workerTerminated) {
        workerTerminated = true;
        try {
          worker.terminate();
        } catch {
          /* ignore */
        }
      }
      reject(new Error(`Parser timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    onMessage = (e: MessageEvent<T>) => {
      if (!options.shouldResolve(e.data)) {
        options.onIntermediate?.(e.data);
        return;
      }
      cleanup();
      resolve(e.data);
    };

    onError = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(e.message || 'Parser worker error'));
    };

    onMessageError = () => {
      cleanup();
      reject(new Error('Parser worker message deserialization failed'));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);

    try {
      post();
    } catch (postErr) {
      cleanup();
      reject(
        postErr instanceof Error
          ? postErr
          : new Error('Failed to post message to parser worker'),
      );
    }
  });

  return { promise, cleanup };
}
