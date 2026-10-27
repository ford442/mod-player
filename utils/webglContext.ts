/**
 * WebGL context hygiene shared by the opt-in WebGL2 pattern renderer (`src/renderers/webgl2/`)
 * and the hybrid overlay (`hooks/useWebGLOverlay.ts`) — #492.
 *
 * Kept free of renderer imports so both the main chunk (overlay, renderer selection) and the
 * lazily loaded WebGL2 renderer chunk can use it without dragging each other in.
 */

export interface WebGLContextLossHandlers {
  /** The context is gone: stop issuing GL calls and forget (never delete) every GL object. */
  onLost: () => void;
  /** The browser handed the context back: re-create every GL resource, then resume. */
  onRestored: () => void;
}

/**
 * Listen for `webglcontextlost` / `webglcontextrestored` on `canvas`. The lost handler calls
 * `preventDefault()`, which is what tells the browser this page can restore — without it the
 * context stays lost for the life of the canvas and `webglcontextrestored` never fires.
 * Returns a disposer that removes both listeners.
 */
export function watchWebGLContextLoss(
  canvas: HTMLCanvasElement,
  handlers: WebGLContextLossHandlers,
): () => void {
  const onLost = (event: Event) => {
    event.preventDefault();
    handlers.onLost();
  };
  const onRestored = () => handlers.onRestored();
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  return () => {
    canvas.removeEventListener('webglcontextlost', onLost, false);
    canvas.removeEventListener('webglcontextrestored', onRestored, false);
  };
}

/**
 * Give a context back to the browser now instead of whenever it is garbage collected: every live
 * context counts against the per-page cap (~16 in Chromium), past which the oldest one is lost.
 */
export function releaseWebGLContext(gl: WebGLRenderingContext | WebGL2RenderingContext | null): void {
  if (!gl) return;
  try {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* already lost, or the extension is unavailable — nothing to release */
  }
}

/**
 * Should the WebGL2 pattern renderer ask for `preserveDrawingBuffer: true`?
 *
 * Preserving costs a full drawing-buffer copy per frame, and only automation needs it: a
 * `readPixels()` from a later task (Playwright's `page.evaluate`, after the frame was composited)
 * reads a cleared buffer otherwise. On for `navigator.webdriver` (Playwright, puppeteer, WebDriver —
 * every smoke script) or `?debug=readback` (comma list, like `?debug=log`) for a manual readback.
 */
export function wantsDrawingBufferReadback(): boolean {
  try {
    const g = globalThis as { navigator?: { webdriver?: boolean }; location?: { search?: string } };
    if (g.navigator?.webdriver === true) return true;
    const flags = new URLSearchParams(g.location?.search ?? '').get('debug');
    return flags?.split(',').includes('readback') ?? false;
  } catch {
    return false;
  }
}
