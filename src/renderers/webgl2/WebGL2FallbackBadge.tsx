/**
 * Persistent label shown over the canvas for as long as the opt-in WebGL2
 * visualizer is the active backend (#462). A DOM element — deliberately not
 * drawn in GL — so it can never be lost to a context/shader failure.
 */
export function WebGL2FallbackBadge() {
  return (
    <div
      role="status"
      data-webgl2-fallback-badge="true"
      className="pointer-events-none absolute left-2 top-2 z-20 rounded border border-amber-400/70 bg-black/80 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-300 shadow"
    >
      WebGL2 fallback — WebGPU not in use
    </div>
  );
}
