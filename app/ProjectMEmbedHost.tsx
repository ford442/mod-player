import { ProjectMEmbedView } from '../components/ProjectMEmbedView';
import { usePlayerEngine } from '../hooks/usePlayerEngine';
import { useModuleMetadata, usePlayerActions } from '../hooks/usePlayerView';

/**
 * The ProjectM embed page, bound to the PlayerEngine (#492). It selects transport-rate fields only;
 * the row-rate position lives in the view's LiveSeekBar (pitfall 17), so the host does not
 * re-render on every row.
 */
export function ProjectMEmbedHost({ handleFileSelected }: { handleFileSelected: (file: File) => void }) {
  const status = usePlayerEngine((s) => s.status);
  const isReady = usePlayerEngine((s) => s.isReady);
  const isModuleLoaded = usePlayerEngine((s) => s.isModuleLoaded);
  const isPlaying = usePlayerEngine((s) => s.isPlaying);
  const isPaused = usePlayerEngine((s) => s.isPaused);
  const isLooping = usePlayerEngine((s) => s.isLooping);
  const moduleTitle = useModuleMetadata()?.title ?? null;
  const { play, pause, stopMusic, setIsLooping } = usePlayerActions();
  return (
    <ProjectMEmbedView
      status={status}
      isReady={isReady}
      isModuleLoaded={isModuleLoaded}
      isPlaying={isPlaying}
      isPaused={isPaused}
      isLooping={isLooping}
      moduleTitle={moduleTitle}
      play={play}
      pause={pause}
      stop={() => stopMusic(false)}
      setIsLooping={setIsLooping}
      handleFileSelected={handleFileSelected}
    />
  );
}
