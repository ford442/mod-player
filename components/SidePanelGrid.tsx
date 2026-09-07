import { ChannelMeters } from './ChannelMeters';
import { MetadataPanel } from './MetadataPanel';
import { Panel } from './Panel';
import { MidiControlsPanel } from './MidiControlsPanel';
import { ExportPanel } from './ExportPanel';
import { InstrumentPanel } from './InstrumentPanel';
import { IS_PUBLIC_MODE, LIGHT_THEMES } from '../appConfig';
import { usePlayerSession } from '../context/PlayerSessionContext';
import { usePlayerFeatures } from '../context/PlayerFeaturesContext';
import { usePlayerUiStore } from '../store/playerUiStore';
import { useShaderPrefsStore } from '../store/shaderPrefsStore';

/** Right-column grid: Module Info, Instruments, VU Meters, MIDI/Hardware, Export. */
export function SidePanelGrid() {
  const session = usePlayerSession();
  const features = usePlayerFeatures();
  const { theme, showMetadata, showInstruments, showChannelMeters } = usePlayerUiStore();
  const { storedShader: shaderFile } = useShaderPrefsStore();

  const isDarkMode = !LIGHT_THEMES.has(theme);
  const showDevSurface = !IS_PUBLIC_MODE;
  const {
    isModuleLoaded,
    isPlaying,
    playbackSeconds,
    playbackRowFraction,
    sequencerMatrix,
    channelVU,
    analyserNode,
    moduleMetadata,
    moduleFileName,
    moduleDurationSeconds,
    instrumentTable,
    channelMuteMask,
    instrumentPalette,
    toggleChannelMute: onToggleChannelMute,
  } = session;
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
    dualAudioContext,
  } = features;

  return (
    <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Left Column: placeholder — PatternDisplay is rendered above */}
      <div className="lg:col-span-2" />

      {/* Right Column: Metadata + VU Meters */}
      <div className="flex flex-col gap-4">
        {showMetadata && (
          <Panel variant="bezel" title="Module Info" titleAccent>
            <MetadataPanel
              metadata={moduleMetadata}
              currentOrder={sequencerMatrix?.order ?? 0}
              currentRow={Math.floor(playbackRowFraction)}
              currentPattern={sequencerMatrix?.patternIndex ?? 0}
              matrix={sequencerMatrix}
              isPlaying={isPlaying}
              playbackSeconds={playbackSeconds}
            />
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
            <ChannelMeters
              channelVU={channelVU}
              numChannels={sequencerMatrix?.numChannels ?? 4}
              analyserNode={analyserNode}
              isPlaying={isPlaying}
            />
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
              numChannels={sequencerMatrix?.numChannels ?? 0}
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
              dualAudioContext={dualAudioContext}
            />
          </Panel>
        )}
      </div>
    </div>
  );
}
