import { ChannelMeters } from './ChannelMeters';
import { MetadataPanel } from './MetadataPanel';
import { Panel } from './Panel';
import { MidiControlsPanel } from './MidiControlsPanel';
import { ExportPanel } from './ExportPanel';
import { InstrumentPanel } from './InstrumentPanel';
import { FX_RACK_ENABLED, IS_PUBLIC_MODE, LIGHT_THEMES } from '../appConfig';
import { FxRackPanelLazy } from './fx/FxRackPanelLazy';
import { usePlayerEngine, usePlayerEngineInstance } from '../hooks/usePlayerEngine';
import {
  useChannelMuteMask,
  useInstrumentPalette,
  useModuleMetadata,
  usePlayerActions,
} from '../hooks/usePlayerView';
import { usePlayerFeatures } from '../context/PlayerFeaturesContext';
import { usePlayerUiStore } from '../store/playerUiStore';
import { useShaderPrefsStore } from '../store/shaderPrefsStore';

/** Module Info, bound to the engine; owns the row-rate subscription so the grid does not re-render per row. */
function LiveMetadataPanel() {
  const metadata = useModuleMetadata();
  const sequencerMatrix = usePlayerEngine((s) => s.sequencerMatrix);
  const currentRow = usePlayerEngine((s) => Math.floor(s.playbackRowFraction));
  const playbackSeconds = usePlayerEngine((s) => s.playbackSeconds);
  const isPlaying = usePlayerEngine((s) => s.isPlaying);
  return (
    <MetadataPanel
      metadata={metadata}
      currentOrder={sequencerMatrix?.order ?? 0}
      currentRow={currentRow}
      currentPattern={sequencerMatrix?.patternIndex ?? 0}
      matrix={sequencerMatrix}
      isPlaying={isPlaying}
      playbackSeconds={playbackSeconds}
    />
  );
}

/** VU meters: they read the engine's live channel levels every frame, not a React snapshot. */
function LiveChannelMeters() {
  const { channelStatesRef } = usePlayerEngineInstance();
  const numChannels = usePlayerEngine((s) => s.sequencerMatrix?.numChannels ?? 4);
  const analyserNode = usePlayerEngine((s) => s.analyserNode);
  const isPlaying = usePlayerEngine((s) => s.isPlaying);
  return (
    <ChannelMeters
      channelLevelsRef={channelStatesRef}
      numChannels={numChannels}
      analyserNode={analyserNode}
      isPlaying={isPlaying}
    />
  );
}

/** Side panels: FX rack (left, wide); Module Info, Instruments, VU Meters, MIDI/Hardware, Export (right). */
export function SidePanelGrid() {
  const features = usePlayerFeatures();
  const { theme, showMetadata, showInstruments, showChannelMeters, showFxRack } = usePlayerUiStore();
  const { storedShader: shaderFile } = useShaderPrefsStore();

  const isDarkMode = !LIGHT_THEMES.has(theme);
  const showDevSurface = !IS_PUBLIC_MODE;
  const isModuleLoaded = usePlayerEngine((s) => s.isModuleLoaded);
  const numChannels = usePlayerEngine((s) => s.sequencerMatrix?.numChannels ?? 0);
  const moduleFileName = usePlayerEngine((s) => s.moduleFileName);
  const moduleDurationSeconds = usePlayerEngine((s) => s.moduleDurationSeconds);
  const instrumentTable = usePlayerEngine((s) => s.instrumentTable);
  const instrumentPalette = useInstrumentPalette();
  const channelMuteMask = useChannelMuteMask();
  const { toggleChannelMute: onToggleChannelMute } = usePlayerActions();
  const {
    midiControls,
    onExportWav,
    onStartCapture,
    onStopCapture,
    offlineExportState,
    isExporting,
    captureState,
    isRecording,
    getRendererBackend,
  } = features;

  return (
    <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Left Column: FX rack (#453) — PatternDisplay is rendered above */}
      <div className="lg:col-span-2">
        {FX_RACK_ENABLED && showFxRack && (
          <Panel variant="bezel" title="FX Rack" titleAccent>
            <FxRackPanelLazy />
          </Panel>
        )}
      </div>

      {/* Right Column: Metadata + VU Meters */}
      <div className="flex flex-col gap-4">
        {showMetadata && (
          <Panel variant="bezel" title="Module Info" titleAccent>
            <LiveMetadataPanel />
          </Panel>
        )}
        {showInstruments && showDevSurface && (
          <Panel variant="bezel" title="Instruments" titleAccent>
            <InstrumentPanel
              table={instrumentTable}
              instrumentPalette={instrumentPalette}
              shaderFile={shaderFile}
              isDarkMode={isDarkMode}
            />
          </Panel>
        )}
        {showChannelMeters && (
          <Panel variant="bezel" title="VU Meters" titleAccent>
            <LiveChannelMeters />
          </Panel>
        )}
        {midiControls && showDevSurface && (
          <Panel variant="bezel" title="MIDI / Hardware" titleAccent>
            <MidiControlsPanel midi={midiControls} isDarkMode={isDarkMode} />
          </Panel>
        )}
        {showDevSurface && (
          <Panel variant="bezel" title="Export" titleAccent>
            <ExportPanel
              isModuleLoaded={isModuleLoaded}
              isDarkMode={isDarkMode}
              moduleFileName={moduleFileName}
              moduleDurationSeconds={moduleDurationSeconds}
              numChannels={numChannels}
              channelMuteMask={channelMuteMask}
              onToggleChannelMute={onToggleChannelMute}
              onExportWav={onExportWav}
              onStartCapture={onStartCapture}
              onStopCapture={onStopCapture}
              offlineExport={offlineExportState}
              isExporting={isExporting}
              captureState={captureState}
              isRecording={isRecording}
              rendererBackend={getRendererBackend()}
            />
          </Panel>
        )}
      </div>
    </div>
  );
}
