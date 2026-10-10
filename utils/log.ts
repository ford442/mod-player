/* eslint-disable no-console -- this module IS the sanctioned console wrapper */
/**
 * Scoped console logger for app code (main thread and module workers).
 *
 * `debug` / `log` are diagnostics: they print in `vite dev`, and in a production build only when
 * the viewer opts in with `?debug=log` (a comma list is fine: `?debug=parser,log`) or
 * `localStorage.xasm1_debug_log = '1'` — the same shape as the existing `?debug=parser` switch, so
 * a bug report can still come with the `[PLAY]` / `[INIT]` traces without shipping them to everyone.
 * `warn` / `error` always print: they report problems a user should be able to see.
 *
 * Output is `console.<level>('[scope]', ...args)`.
 *
 * Do NOT import this from the AudioWorklet bundle (audio-worklet/js/**, workletProtocolConstants.ts,
 * libRuntimeReady.ts): esbuild bundles that as a classic IIFE where `import.meta` is empty, so reading
 * `import.meta.env` there throws at runtime. The processor keeps its own `DEBUG`-gated `log`;
 * tests/logger.test.ts fails if a worklet source starts importing this module.
 */

export interface Logger {
  /** Verbose diagnostics (`console.debug`: hidden by default in Chromium's "Default levels"). */
  debug(...args: unknown[]): void;
  /** Diagnostics (`console.log`). */
  log(...args: unknown[]): void;
  /**
   * Open / close a console group — gated like `log`, so a production console never shows an empty
   * group. Always pair them; both follow the same switch, so they stay balanced.
   */
  group(...label: unknown[]): void;
  groupEnd(): void;
  /** Always printed. */
  warn(...args: unknown[]): void;
  /** Always printed. */
  error(...args: unknown[]): void;
}

export const LOG_OPT_IN_STORAGE_KEY = 'xasm1_debug_log';

let optIn: boolean | undefined;

/** Has the viewer asked for diagnostics in a production build? Read once; a reload picks up changes. */
function viewerOptedIn(): boolean {
  if (optIn !== undefined) return optIn;
  optIn = false;
  try {
    const g = globalThis as { location?: { search?: string }; localStorage?: Storage };
    const flags = new URLSearchParams(g.location?.search ?? '').get('debug');
    if (flags?.split(',').includes('log')) optIn = true;
    else if (g.localStorage?.getItem(LOG_OPT_IN_STORAGE_KEY) === '1') optIn = true;
  } catch {
    /* storage or location unavailable (private mode, worker): stay off */
  }
  return optIn;
}

/** Whether `debug` / `log` currently print. `import.meta.env.DEV` is a compile-time constant in production builds. */
export function isDiagnosticLoggingEnabled(): boolean {
  return Boolean(import.meta.env.DEV) || viewerOptedIn();
}

export function createLogger(scope: string): Logger {
  const prefix = `[${scope}]`;
  return {
    debug: (...args) => {
      if (isDiagnosticLoggingEnabled()) console.debug(prefix, ...args);
    },
    log: (...args) => {
      if (isDiagnosticLoggingEnabled()) console.log(prefix, ...args);
    },
    group: (...label) => {
      if (isDiagnosticLoggingEnabled()) console.group(prefix, ...label);
    },
    groupEnd: () => {
      if (isDiagnosticLoggingEnabled()) console.groupEnd();
    },
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}
