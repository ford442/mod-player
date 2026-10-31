import { SeekBar } from './SeekBar';
import { usePlayerEngine } from '../hooks/usePlayerEngine';
import { usePlayerActions } from '../hooks/usePlayerView';

/**
 * SeekBar bound to the engine. It owns the row-rate subscription (position, seconds), so the transport
 * controls around it do not re-render on every row (#492).
 */
export function LiveSeekBar() {
  const currentSeconds = usePlayerEngine((s) => s.playbackSeconds);
  const durationSeconds = usePlayerEngine((s) => s.moduleDurationSeconds);
  const currentRow = usePlayerEngine((s) => s.playbackRowFraction);
  const totalRows = usePlayerEngine((s) => s.totalPatternRows);
  const isPlaying = usePlayerEngine((s) => s.isPlaying);
  const { seekToStep } = usePlayerActions();
  return (
    <SeekBar
      currentSeconds={currentSeconds}
      durationSeconds={durationSeconds}
      currentRow={currentRow}
      totalRows={totalRows}
      isPlaying={isPlaying}
      onSeekRow={seekToStep}
    />
  );
}
