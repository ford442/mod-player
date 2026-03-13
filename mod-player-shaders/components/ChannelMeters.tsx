import React, { useMemo } from 'react';

interface ChannelMetersProps {
  numChannels: number;
  levels: number[];
  peaks?: number[];
  mutedChannels?: boolean[];
  onMuteChannel?: (channel: number, muted: boolean) => void;
  onSoloChannel?: (channel: number) => void;
}

export const ChannelMeters: React.FC<ChannelMetersProps> = ({
  numChannels,
  levels,
  peaks = [],
  mutedChannels = [],
  onMuteChannel,
  onSoloChannel,
}) => {
  // Oscilloscope data simulation (would come from analyser in real implementation)
  const oscilloscopeData = useMemo(() => {
    const points: string[] = [];
    for (let i = 0; i <= 100; i++) {
      const x = (i / 100) * 200;
      const y = 25 + Math.sin(i * 0.2) * 15 * (Math.random() * 0.5 + 0.5);
      points.push(`${x},${y}`);
    }
    return points.join(' ');
  }, []);

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%',
      backgroundColor: '#111',
      borderRadius: '4px',
      overflow: 'hidden'
    }}>
      <div style={{ 
        display: 'flex', 
        flexDirection: 'row', 
        flex: 1,
        padding: '4px',
        gap: '2px'
      }}>
        {Array.from({ length: numChannels }, (_, i) => {
          const level = levels[i] ?? 0;
          const peak = peaks[i] ?? 0;
          const pct = Math.round(level * 100);
          const peakPct = Math.round(peak * 100);
          const isMuted = mutedChannels[i] ?? false;

          return (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                minWidth: numChannels > 16 ? 14 : 24,
                flex: '1 1 0',
                opacity: isMuted ? 0.4 : 1,
                transition: 'opacity 0.15s ease'
              }}
            >
              {/* Mute/Solo buttons */}
              <div style={{ 
                display: 'flex', 
                gap: '1px', 
                marginBottom: '2px',
                fontSize: '8px',
                fontWeight: 'bold'
              }}>
                <button
                  onClick={() => onMuteChannel?.(i, !isMuted)}
                  style={{
                    width: '14px',
                    height: '14px',
                    padding: 0,
                    border: 'none',
                    borderRadius: '2px',
                    backgroundColor: isMuted ? '#d44' : '#333',
                    color: isMuted ? '#fff' : '#888',
                    cursor: 'pointer',
                    fontSize: '7px',
                    lineHeight: '14px',
                    transition: 'all 0.1s ease'
                  }}
                  title={`Mute CH${i + 1}`}
                >
                  M
                </button>
                <button
                  onClick={() => onSoloChannel?.(i)}
                  style={{
                    width: '14px',
                    height: '14px',
                    padding: 0,
                    border: 'none',
                    borderRadius: '2px',
                    backgroundColor: '#333',
                    color: '#888',
                    cursor: 'pointer',
                    fontSize: '7px',
                    lineHeight: '14px',
                    transition: 'all 0.1s ease'
                  }}
                  title={`Solo CH${i + 1}`}
                >
                  S
                </button>
              </div>

              {/* Bar container */}
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  flex: 1,
                  backgroundColor: '#1a1a1a',
                  borderRadius: '2px',
                  overflow: 'hidden',
                  minHeight: '40px'
                }}
              >
                {/* Filled bar with gradient */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: `${pct}%`,
                    background: isMuted 
                      ? 'linear-gradient(to top, #444, #666)' 
                      : 'linear-gradient(to top, #2a4, #4f4)',
                    borderRadius: '2px',
                    transition: 'height 0.05s linear, background 0.15s ease',
                    opacity: isMuted ? 0.3 : 0.9
                  }}
                />

                {/* Peak hold indicator */}
                {peakPct > 0 && !isMuted && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: `${peakPct}%`,
                      height: '2px',
                      backgroundColor: peakPct > 95 ? '#f44' : '#fff',
                      borderRadius: '1px',
                      boxShadow: '0 0 2px rgba(255,255,255,0.5)'
                    }}
                  />
                )}
              </div>

              {/* Channel label */}
              <div
                style={{
                  marginTop: '2px',
                  fontSize: numChannels > 16 ? '7px' : '9px',
                  color: isMuted ? '#666' : '#aaa',
                  fontFamily: 'monospace',
                  textAlign: 'center',
                  transition: 'color 0.15s ease'
                }}
              >
                {numChannels > 16 ? i + 1 : `CH ${i + 1}`}
              </div>
            </div>
          );
        })}
      </div>

      {/* Oscilloscope */}
      <div style={{ 
        height: '50px', 
        backgroundColor: '#0a0a0a',
        borderTop: '1px solid #222',
        position: 'relative'
      }}>
        <svg 
          width="100%" 
          height="100%" 
          viewBox="0 0 200 50"
          preserveAspectRatio="none"
          style={{ display: 'block' }}
        >
          <defs>
            <linearGradient id="oscGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#4f4" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#2a4" stopOpacity="0.4" />
            </linearGradient>
          </defs>
          <polyline
            fill="none"
            stroke="url(#oscGradient)"
            strokeWidth="1.5"
            points={oscilloscopeData}
          />
        </svg>
        <div style={{
          position: 'absolute',
          top: '2px',
          right: '4px',
          fontSize: '9px',
          color: '#444',
          fontFamily: 'monospace'
        }}>
          OSC
        </div>
      </div>
    </div>
  );
};

export default ChannelMeters;
