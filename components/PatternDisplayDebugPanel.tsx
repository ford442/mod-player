import type { SyncDebugInfo } from '../types';
import type { DebugInfo } from '../src/renderers/params';
import type { PatternRendererBackend } from '../src/renderers/types';
import { setRendererOverride } from '../src/renderers/rendererSelection';

export interface PatternDisplayDebugPanelProps {
  debugPanelOpen: boolean;
  onCloseDebug?: () => void;
  onOpenDebug?: () => void;
  activeBackend: PatternRendererBackend;
  setActiveBackend: (backend: PatternRendererBackend) => void;
  debugInfo: DebugInfo;
  syncDebug?: SyncDebugInfo;
  debugBloomLayer: number;
  bloomLayerLabel: string | null;
}

export function PatternDisplayDebugPanel({
  debugPanelOpen,
  onCloseDebug,
  onOpenDebug,
  activeBackend,
  setActiveBackend,
  debugInfo,
  syncDebug,
  debugBloomLayer,
  bloomLayerLabel,
}: PatternDisplayDebugPanelProps) {
  return (
    <>
      {!debugPanelOpen && (
        <button
          onClick={onOpenDebug}
          className="fixed top-4 right-4 z-50 rounded-full border border-green-500/40 bg-black/80 px-3 py-1 text-sm text-green-300 shadow-lg hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
          aria-label="Open debug panel"
        >
          🔍
        </button>
      )}

      {debugPanelOpen && (
        <div className="fixed top-4 right-4 bg-black/90 border border-green-500/50 rounded p-3 text-xs font-mono z-50 max-w-xs" style={{ backdropFilter: 'blur(4px)' }}>
          <div className="flex justify-between items-center mb-2">
            <span className="text-green-400 font-bold">🔍 PatternDisplay Debug</span>
            <button onClick={onCloseDebug} className="text-gray-500 hover:text-white">✕</button>
          </div>
          <div className="mb-2">
            <span className="text-gray-400">Renderer:</span>
            <select
              value={activeBackend}
              onChange={(e) => {
                const next = e.target.value as PatternRendererBackend;
                setRendererOverride(next);
                setActiveBackend(next);
              }}
              className="ml-2 bg-[#111] border border-green-500/40 text-green-300 rounded px-1 py-0.5 text-[10px]"
            >
              <option value="webgpu">webgpu</option>
              <option value="html">html (DOM grid)</option>
              <option value="webgl2" disabled title="WebGL2 shader path deferred">
                webgl2 (deferred)
              </option>
            </select>
          </div>
          {typeof window !== 'undefined' && window.__WEBGPU_PROBE__ && !window.__WEBGPU_PROBE__.ok && (
            <div className="mb-2 text-[10px] text-red-300 break-words">
              Probe: {window.__WEBGPU_PROBE__.browserBrand} · {window.__WEBGPU_PROBE__.stage}
              {window.__WEBGPU_PROBE__.error ? ` — ${window.__WEBGPU_PROBE__.error}` : ''}
            </div>
          )}
          <div className="mb-2">
            <span className="text-gray-400">Layout:</span>
            <span className={`ml-2 font-bold ${debugInfo.layoutMode.includes('32') ? 'text-blue-400' : debugInfo.layoutMode.includes('64') ? 'text-purple-400' : 'text-orange-400'}`}>
              {debugInfo.layoutMode}
            </span>
          </div>
          {import.meta.env.DEV && activeBackend === 'webgl2' && (
            <div className="mb-2 text-[10px] text-yellow-300">
              Alt+D cycles debug modes (wireframe, UV, playhead…)
            </div>
          )}
          {debugInfo.errors.length > 0 && (
            <div className="mb-2">
              <div className="text-red-400 font-bold mb-1">Errors:</div>
              {debugInfo.errors.map((err, i) => (
                <div key={i} className="text-red-300 text-[10px] truncate">• {err}</div>
              ))}
            </div>
          )}
          <div className="border-t border-gray-700 pt-2 mt-2">
            <div className="text-gray-500 text-[10px] mb-1">Uniforms:</div>
            {Object.entries(debugInfo.uniforms).map(([key, val]) => (
              <div key={key} className="flex justify-between text-[10px]">
                <span className="text-gray-400">{key}:</span>
                <span className="text-cyan-300 ml-2">{String(val)}</span>
              </div>
            ))}
          </div>
          {syncDebug && (syncDebug.sampleRow != null || syncDebug.driftMs !== 0) && (
            <div className="border-t border-gray-700 pt-2 mt-2">
              <div className="text-gray-500 text-[10px] mb-1">Playhead sync:</div>
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-400">mode:</span>
                <span className="text-cyan-300 ml-2">{syncDebug.mode}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-400">driftMs:</span>
                <span className="text-cyan-300 ml-2">{syncDebug.driftMs}</span>
              </div>
              {syncDebug.sampleRow != null && (
                <>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-gray-400">sampleRow:</span>
                    <span className="text-cyan-300 ml-2">{syncDebug.sampleRow.toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-gray-400">predictedRow:</span>
                    <span className="text-cyan-300 ml-2">{syncDebug.predictedRow?.toFixed(3) ?? '—'}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-gray-400">smoothedRow:</span>
                    <span className="text-cyan-300 ml-2">{syncDebug.smoothedRow?.toFixed(3) ?? '—'}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-gray-400">lagRows:</span>
                    <span className={`ml-2 ${Math.abs(syncDebug.predictionLagRows ?? 0) > 0.5 ? 'text-yellow-300' : 'text-green-300'}`}>
                      {syncDebug.predictionLagRows?.toFixed(3) ?? '—'}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {import.meta.env.DEV && debugBloomLayer >= 0 && (
        <div className="absolute top-2 right-2 z-50 pointer-events-none">
          <div className="bg-black/80 text-yellow-300 font-mono text-[10px] px-2 py-1 rounded border border-yellow-500/60">
            BLOOM: {bloomLayerLabel ?? `layer ${debugBloomLayer}`} only
            <span className="text-gray-500 ml-1">(Alt+B)</span>
          </div>
        </div>
      )}
    </>
  );
}
