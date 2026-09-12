import { ShaderSelectorPanel } from './ShaderSelectorPanel';
import { AccessibilityPanel } from './AccessibilityPanel';
import { cn } from '../utils/cn';
import { setLiteOverride } from '../utils/deviceCapabilities';
import { usesInstrumentPalette } from '../utils/shaderVersion';
import { IS_PUBLIC_MODE, AVAILABLE_SHADERS, THEME_OPTIONS, LIGHT_THEMES, type AppTheme } from '../appConfig';
import { usePlayerSession } from '../context/PlayerSessionContext';
import { usePlayerFeatures } from '../context/PlayerFeaturesContext';
import { usePlayerUiStore } from '../store/playerUiStore';
import { useShaderPrefsStore } from '../store/shaderPrefsStore';

/** Toolbar row: 3D mode, theme, engine, lite/reactive/stage toggles, edit mode, shader selector, palette/steps, accessibility. */
export function GlobalControlsBar() {
  const session = usePlayerSession();
  const features = usePlayerFeatures();
  const {
    theme,
    setTheme,
    liteMode,
    setLiteMode,
    reactiveMode,
    setReactiveMode,
    editMode,
    toggleEditMode,
    stageMode,
    toggleStageMode,
  } = usePlayerUiStore();
  const {
    storedShader: shaderFile,
    selectShader: setShaderFile,
    randomizeShader: handleRandomShader,
    shaderThumbnails,
    toggleShaderFavorite,
    colorPalette,
    setColorPalette,
    paletteMode,
    setPaletteMode,
    stepsLength,
    setStepsLength,
  } = useShaderPrefsStore();

  const isDarkMode = !LIGHT_THEMES.has(theme);
  const showDevSurface = !IS_PUBLIC_MODE;
  const { isModuleLoaded, activeEngine, isWorkletSupported, workletLoadError, toggleAudioEngine, isStepsShader } = session;
  const {
    setIs3DMode,
    onCopyShareLink,
    shaderCatalog,
    shaderCatalogLoading,
    shaderCatalogError,
    onRateShader,
    ratingInFlightShaderId,
    validShaderFavorites,
    validShaderRecents,
    patternEditDirty = false,
    canPatternUndo = false,
    canPatternRedo = false,
    onPatternUndo,
    onPatternRedo,
    onPatternRevert,
    onExportPatternDump,
    isExporting,
  } = features;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
      <div className="flex gap-2">
        {showDevSurface && (
          <button
            onClick={() => setIs3DMode(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-mono rounded-lg shadow-lg hover:bg-blue-700 transition-colors border border-blue-500"
          >
            🎬 3D Mode
          </button>
        )}
        {/* Theme selector */}
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as AppTheme)}
          className={cn(
            'px-3 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border outline-none cursor-pointer',
            isDarkMode
              ? 'bg-gray-800 text-white border-gray-700 hover:bg-gray-700'
              : 'bg-white text-black border-gray-300 hover:bg-gray-50',
          )}
          title="Switch UI theme"
        >
          {THEME_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {showDevSurface && (
          <button
            onClick={toggleAudioEngine}
            disabled={!isWorkletSupported || !!workletLoadError}
            title={workletLoadError ? `Worklet Error: ${workletLoadError}` : !isWorkletSupported ? "AudioWorklet not supported" : "Toggle Audio Engine (Worklet vs ScriptProcessor)"}
            className={`px-4 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border ${
              !isWorkletSupported || !!workletLoadError
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed border-gray-400 opacity-50'
                : activeEngine === 'native-worklet'
                  ? 'bg-purple-600 text-white border-purple-500 hover:bg-purple-700'
                  : activeEngine === 'worklet'
                    ? 'bg-green-600 text-white border-green-500 hover:bg-green-700'
                    : 'bg-yellow-500 text-black border-yellow-400 hover:bg-yellow-600'
            }`}
          >
            {activeEngine === 'native-worklet' ? '🚀 Native' : activeEngine === 'worklet' ? '⚡ Worklet' : '🐌 Script'}
          </button>
        )}
        <button
          onClick={() => {
            const next = !liteMode;
            setLiteMode(next);
            setLiteOverride(next);
          }}
          className={cn(
            'px-4 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border',
            liteMode
              ? 'bg-orange-600 text-white border-orange-500 hover:bg-orange-700'
              : 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600',
          )}
          title={liteMode ? 'Lite mode active (mobile/low-power)' : 'Desktop mode'}
        >
          {liteMode ? '⚡ Lite' : '🖥️ Full'}
        </button>
        {showDevSurface && (
          <button
            onClick={() => setReactiveMode(!reactiveMode)}
            className={cn(
              'px-4 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border',
              reactiveMode
                ? 'bg-fuchsia-700 text-white border-fuchsia-500 hover:bg-fuchsia-600'
                : 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600',
            )}
            title={reactiveMode ? 'Audio-reactive chassis on (v0.58+)' : 'Static chassis — no SAB band drive'}
          >
            {reactiveMode ? '🎛️ Reactive' : '🎛️ Static'}
          </button>
        )}
        <button
          onClick={() => toggleStageMode()}
          className={cn(
            'px-4 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border',
            stageMode
              ? 'bg-indigo-700 text-white border-indigo-500 hover:bg-indigo-600'
              : 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600',
          )}
          title="Full-viewport performance stage — hides chrome, shows only the visualizer"
        >
          🎤 Stage
        </button>
        {showDevSurface && onCopyShareLink && (
          <button
            type="button"
            onClick={onCopyShareLink}
            disabled={!isModuleLoaded}
            className={cn(
              'px-4 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border',
              isModuleLoaded
                ? 'bg-cyan-700 text-white border-cyan-500 hover:bg-cyan-600'
                : 'bg-gray-700 text-gray-500 border-gray-600 cursor-not-allowed opacity-60',
            )}
            title="Copy a link that restores this module, shader, and playback position"
          >
            🔗 Share
          </button>
        )}
        {showDevSurface && isModuleLoaded && (
          <button
            type="button"
            onClick={() => toggleEditMode()}
            disabled={isExporting}
            className={cn(
              'px-4 py-2 text-sm font-mono rounded-lg shadow-lg transition-colors border',
              editMode
                ? 'bg-amber-600 text-white border-amber-500 hover:bg-amber-700'
                : isExporting
                  ? 'bg-gray-700 text-gray-500 border-gray-600 cursor-not-allowed opacity-60'
                  : 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600',
            )}
            title={
              isExporting
                ? 'Pattern editor locked while export is running'
                : 'Toggle pattern edit mode (session-only visualization)'
            }
          >
            ✏️ Edit{patternEditDirty ? ' *' : ''}
          </button>
        )}
        {editMode && (
          <>
            <button
              type="button"
              onClick={onPatternUndo}
              disabled={!canPatternUndo || isExporting}
              className={cn(
                'px-3 py-2 text-sm font-mono rounded-lg border transition-colors',
                canPatternUndo && !isExporting
                  ? 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600'
                  : 'bg-gray-800 text-gray-600 border-gray-700 cursor-not-allowed',
              )}
              title="Undo (Ctrl+Z)"
            >
              ↶ Undo
            </button>
            <button
              type="button"
              onClick={onPatternRedo}
              disabled={!canPatternRedo || isExporting}
              className={cn(
                'px-3 py-2 text-sm font-mono rounded-lg border transition-colors',
                canPatternRedo && !isExporting
                  ? 'bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600'
                  : 'bg-gray-800 text-gray-600 border-gray-700 cursor-not-allowed',
              )}
              title="Redo (Ctrl+Shift+Z)"
            >
              ↷ Redo
            </button>
            {patternEditDirty && onPatternRevert && (
              <button
                type="button"
                onClick={onPatternRevert}
                disabled={isExporting}
                className={cn(
                  'px-3 py-2 text-sm font-mono rounded-lg border transition-colors',
                  isExporting
                    ? 'bg-gray-800 text-gray-600 border-gray-700 cursor-not-allowed'
                    : 'bg-amber-900/60 text-amber-100 border-amber-700 hover:bg-amber-800/70',
                )}
                title="Discard edits and restore loaded pattern (session-only)"
              >
                ↩ Revert
              </button>
            )}
            {onExportPatternDump && (
              <button
                type="button"
                onClick={onExportPatternDump}
                className="px-3 py-2 text-sm font-mono rounded-lg border transition-colors bg-cyan-900/50 text-cyan-100 border-cyan-700 hover:bg-cyan-800/70"
                title="Download edited pattern matrix as JSON"
              >
                ⬇ Dump JSON
              </button>
            )}
          </>
        )}
      </div>

      <div className={cn('flex flex-wrap gap-2 p-2 rounded-xl border', isDarkMode ? 'bg-black border-gray-800' : 'bg-gray-200 border-gray-300')}>
        {!IS_PUBLIC_MODE && (
          <>
            <ShaderSelectorPanel
              shaderOptions={AVAILABLE_SHADERS}
              selectedShader={shaderFile}
              onSelectShader={setShaderFile}
              onRandomShader={handleRandomShader}
              favorites={validShaderFavorites}
              recents={validShaderRecents}
              thumbnails={shaderThumbnails}
              onToggleFavorite={toggleShaderFavorite}
              isDarkMode={isDarkMode}
              shaderCatalog={shaderCatalog}
              shaderCatalogLoading={shaderCatalogLoading}
              shaderCatalogError={shaderCatalogError}
              onRateShader={onRateShader}
              ratingInFlightShaderId={ratingInFlightShaderId}
            />
            <div className={cn('w-px h-6', isDarkMode ? 'bg-gray-800' : 'bg-gray-300')}></div>
          </>
        )}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold text-gray-500 uppercase px-1">Palette</span>
          <select
            className={cn('text-xs font-mono p-1 rounded border outline-none', isDarkMode ? 'bg-gray-800 border-gray-600 text-white' : 'bg-white border-gray-300 text-black')}
            value={colorPalette}
            onChange={(e) => setColorPalette(parseInt(e.target.value, 10))}
          >
            <option value={0}>Rainbow</option>
            <option value={1}>Warm</option>
            <option value={2}>Cool</option>
            <option value={3}>Neon</option>
            <option value={4}>Acid</option>
            <option value={5}>Fifths</option>
          </select>
          {showDevSurface && (
            <button
              onClick={() => setPaletteMode(paletteMode === 0 ? 1 : 0)}
              disabled={!usesInstrumentPalette(shaderFile)}
              title={usesInstrumentPalette(shaderFile) ? 'Toggle pitch hue vs per-instrument color' : 'Per-instrument palette not available on this shader'}
              className={cn(
                'text-[10px] font-mono px-2 py-1 rounded border transition-colors',
                usesInstrumentPalette(shaderFile)
                  ? paletteMode === 1
                    ? 'bg-cyan-700 text-white border-cyan-500 hover:bg-cyan-600'
                    : isDarkMode
                      ? 'bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  : 'bg-gray-700 text-gray-500 border-gray-600 cursor-not-allowed opacity-50'
              )}
            >
              {paletteMode === 1 ? 'By Instrument' : 'By Pitch'}
            </button>
          )}
        </div>
        {isStepsShader && (
          <>
            <div className={cn('w-px h-6', isDarkMode ? 'bg-gray-800' : 'bg-gray-300')}></div>
            <button
              onClick={() => setStepsLength(stepsLength === 32 ? 64 : 32)}
              className={cn(
                'text-xs font-mono px-2 py-1 rounded border transition-colors',
                isDarkMode
                  ? 'bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700 hover:text-white'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50',
              )}
              title="Toggle pattern length (32 or 64 steps visible)"
            >
              {stepsLength} Steps
            </button>
          </>
        )}
        {/* Accessibility settings — always visible */}
        <AccessibilityPanel />
      </div>
    </div>
  );
}
