import { Panel } from './Panel';
import { PatternEditor } from './PatternEditor';
import { IS_PUBLIC_MODE } from '../appConfig';
import { usePlayerSession } from '../context/PlayerSessionContext';
import { usePlayerFeatures } from '../context/PlayerFeaturesContext';
import { usePlayerUiStore } from '../store/playerUiStore';

/** Pattern editor overlay, shown only while `editMode` is on (chrome mode only). */
export function PatternEditorSection() {
  const session = usePlayerSession();
  const features = usePlayerFeatures();
  const { editMode, selectedInstrumentIndex } = usePlayerUiStore();

  const showDevSurface = !IS_PUBLIC_MODE;
  const { sequencerMatrix, playbackRowFraction, isPlaying, seekToStep } = session;
  const {
    patternEditDirty = false,
    onPatternCellEdit,
    onPatternCellPatch,
    onPatternCellClear,
    onExportPatternDump,
    isExporting,
  } = features;

  if (!showDevSurface || !editMode || !onPatternCellEdit || !onPatternCellPatch || !onPatternCellClear) {
    return null;
  }

  return (
    <div className="mt-4">
      <Panel
        variant="raised"
        title={patternEditDirty ? 'Pattern Editor (unsaved)' : 'Pattern Editor'}
        titleAccent
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {onExportPatternDump && (
            <button
              type="button"
              onClick={onExportPatternDump}
              className="px-3 py-1.5 text-xs font-mono rounded border bg-cyan-900/50 text-cyan-100 border-cyan-700 hover:bg-cyan-800/70"
            >
              Download pattern JSON
            </button>
          )}
        </div>
        <PatternEditor
          matrix={sequencerMatrix}
          currentRow={Math.floor(playbackRowFraction)}
          numChannels={sequencerMatrix?.numChannels ?? 4}
          isPlaying={isPlaying}
          editMode={editMode}
          readOnly={isExporting}
          highlightInstrument={selectedInstrumentIndex}
          onCellEdit={onPatternCellEdit}
          onCellPatch={onPatternCellPatch}
          onCellClear={onPatternCellClear}
          onSeek={(row) => seekToStep(row)}
        />
      </Panel>
    </div>
  );
}
