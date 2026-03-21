import React from 'react';

interface ControlsProps {
  isPlaying: boolean;
  isModuleLoaded: boolean;
  playbackSeconds: number;
  durationSeconds: number;
  currentOrder: number;
  numOrders: number;
  onPlay: () => void;
  onStop: () => void;
  onPreviousPattern: () => void;
  onNextPattern: () => void;
  onToggleLoop: () => void;
  isLooping: boolean;
}

/**
 * Format seconds as MM:SS
 */
const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const Controls: React.FC<ControlsProps> = ({
  isPlaying,
  isModuleLoaded,
  playbackSeconds,
  durationSeconds,
  currentOrder,
  numOrders,
  onPlay,
  onStop,
  onPreviousPattern,
  onNextPattern,
  onToggleLoop,
  isLooping,
}) => {
  const progressPercent = durationSeconds > 0 
    ? (playbackSeconds / durationSeconds) * 100 
    : 0;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      padding: '16px',
      backgroundColor: '#1a1a1c',
      borderRadius: '8px',
      border: '1px solid #333',
    }}>
      {/* Time Display */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#fff',
      }}>
        <span style={{ color: '#4f4' }}>
          {formatTime(playbackSeconds)}
        </span>
        <span style={{ color: '#666' }}>/</span>
        <span style={{ color: '#888' }}>
          {formatTime(durationSeconds)}
        </span>
      </div>

      {/* Progress Bar */}
      <div style={{
        width: '100%',
        height: '6px',
        backgroundColor: '#333',
        borderRadius: '3px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${progressPercent}%`,
          height: '100%',
          backgroundColor: '#4f4',
          borderRadius: '3px',
          transition: 'width 0.1s linear',
        }} />
      </div>

      {/* Main Controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        marginTop: '8px',
      }}>
        {/* Previous Pattern */}
        <button
          onClick={onPreviousPattern}
          disabled={!isModuleLoaded || currentOrder <= 0}
          style={{
            padding: '8px 16px',
            fontSize: '12px',
            fontWeight: 'bold',
            backgroundColor: currentOrder > 0 ? '#333' : '#222',
            color: currentOrder > 0 ? '#fff' : '#666',
            border: '1px solid #444',
            borderRadius: '4px',
            cursor: currentOrder > 0 ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          title="Previous Pattern (←)"
        >
          <span>◀◀</span>
          <span>PREV</span>
        </button>

        {/* Play/Stop */}
        <button
          onClick={isPlaying ? onStop : onPlay}
          disabled={!isModuleLoaded}
          style={{
            padding: '12px 24px',
            fontSize: '14px',
            fontWeight: 'bold',
            backgroundColor: isPlaying ? '#d44' : '#4a4',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: isModuleLoaded ? 'pointer' : 'not-allowed',
            minWidth: '100px',
          }}
        >
          {isPlaying ? '⏹ STOP' : '▶ PLAY'}
        </button>

        {/* Next Pattern */}
        <button
          onClick={onNextPattern}
          disabled={!isModuleLoaded || currentOrder >= numOrders - 1}
          style={{
            padding: '8px 16px',
            fontSize: '12px',
            fontWeight: 'bold',
            backgroundColor: currentOrder < numOrders - 1 ? '#333' : '#222',
            color: currentOrder < numOrders - 1 ? '#fff' : '#666',
            border: '1px solid #444',
            borderRadius: '4px',
            cursor: currentOrder < numOrders - 1 ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          title="Next Pattern (→)"
        >
          <span>NEXT</span>
          <span>▶▶</span>
        </button>
      </div>

      {/* Pattern Indicator & Loop Toggle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: '8px',
        padding: '8px 12px',
        backgroundColor: '#111',
        borderRadius: '4px',
      }}>
        {/* Pattern Info */}
        <div style={{
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#888',
        }}>
          PATTERN <span style={{ color: '#fff', fontWeight: 'bold' }}>{currentOrder + 1}</span> / {numOrders}
        </div>

        {/* Loop Toggle */}
        <button
          onClick={onToggleLoop}
          style={{
            padding: '4px 12px',
            fontSize: '11px',
            fontWeight: 'bold',
            backgroundColor: isLooping ? '#4a4' : '#333',
            color: isLooping ? '#fff' : '#888',
            border: '1px solid #444',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
          title="Toggle Loop (L)"
        >
          {isLooping ? '🔁 LOOP ON' : '➡️ LOOP OFF'}
        </button>
      </div>

      {/* Keyboard Shortcuts Hint */}
      <div style={{
        fontSize: '10px',
        color: '#555',
        textAlign: 'center',
        marginTop: '4px',
        fontFamily: 'monospace',
      }}>
        ← → : Pattern | Space : Play/Stop | L : Loop
      </div>
    </div>
  );
};

export default Controls;
