import { ProjectMEmbedView } from '../components/ProjectMEmbedView';
import { usePlayerEngine } from '../hooks/usePlayerEngine';
import { useModuleMetadata, usePlayerActions } from '../hooks/usePlayerView';

/** The ProjectM embed page, bound to the PlayerEngine (#492). */
export function ProjectMEmbedHost({ handleFileSelected }: { handleFileSelected: (file: File) => void }) {
  const status = usePlayerEngine((s) => s.status);
  const isReady = usePlayerEngine((s) => s.isReady);
  const isModuleLoaded = usePlayerEngine((s) => s.isModuleLoaded);
  const isPlaying = usePlayerEngine((s) => s.isPlaying);
  const isLooping = usePlayerEngine((s) => s.isLooping);
  const playbackSeconds = usePlayerEngine((s) => s.playbackSeconds);
  const playbackRow = usePlayerEngine((s) => Math.floor(s.playbackRowFraction));
  const totalRows = usePlayerEngine((s) => s.totalPatternRows);
  const moduleTitle = useModuleMetadata()?.title ?? null;
  const { play, stopMusic, seekToStep, setIsLooping } = usePlayerActions();
  return (
    <ProjectMEmbedView
      status={status}
      isReady={isReady}
      isModuleLoaded={isModuleLoaded}
      isPlaying={isPlaying}
      isLooping={isLooping}
      playbackSeconds={playbackSeconds}
      playbackRow={playbackRow}
      totalRows={totalRows}
      moduleTitle={moduleTitle}
      play={play}
      stopMusic={stopMusic}
      seekToStep={seekToStep}
      setIsLooping={setIsLooping}
      handleFileSelected={handleFileSelected}
    />
  );
}
