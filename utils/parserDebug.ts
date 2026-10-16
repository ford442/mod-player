/** Opt-in parser pipeline logging via `?debug=parser` or `localStorage xasm1_debug_parser=1`. */

/**
 * The parser worker has neither the page URL nor localStorage (and no `window`), so it cannot
 * evaluate the switches above itself; the main thread forwards the decision with each parse request
 * and the worker records it here.
 */
let forcedByMainThread = false;

/** Called from the parser worker with the request's `debug` flag. */
export function setParserDebugFromMainThread(on: boolean): void {
  forcedByMainThread = on;
}

export function isParserDebugEnabled(): boolean {
  if (forcedByMainThread) return true;
  if (typeof window === 'undefined') return false;
  try {
    // `?debug=parser`, or a comma list shared with other switches (`?debug=parser,log`).
    if (new URLSearchParams(window.location.search).get('debug')?.split(',').includes('parser')) return true;
    if (localStorage.getItem('xasm1_debug_parser') === '1') return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function parserLog(...args: unknown[]): void {
  if (isParserDebugEnabled()) {
    // eslint-disable-next-line no-console -- opt-in (?debug=parser) diagnostic that must work in production builds
    console.log('[Parser]', ...args);
  }
}
