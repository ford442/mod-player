/** Opt-in parser pipeline logging via `?debug=parser` or `localStorage xasm1_debug_parser=1`. */
export function isParserDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('debug') === 'parser') return true;
    if (localStorage.getItem('xasm1_debug_parser') === '1') return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function parserLog(...args: unknown[]): void {
  if (isParserDebugEnabled()) {
    console.log('[Parser]', ...args);
  }
}
