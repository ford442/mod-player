import { useRef, useEffect, useState, useCallback } from 'react';

interface ChannelMetersProps {
  channelVU: Float32Array | null;
  numChannels: number;
  analyserNode: AnalyserNode | null;
  isPlaying: boolean;
}

const PEAK_DECAY = 0.98;
const SCOPE_HEIGHT = 80;
const SCOPE_BG = '#111827';     // bg-gray-900
const SCOPE_STROKE = '#34d399'; // emerald-400

/** Per-channel VU meters with peak hold + stereo oscilloscope waveform. */
export const ChannelMeters: React.FC<ChannelMetersProps> = ({
  channelVU,
  numChannels,
  analyserNode,
  isPlaying,
}) => {
  const peaksRef = useRef<Float32Array>(new Float32Array(32));
  const scopeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [peaks, setPeaks] = useState<number[]>([]);

  // Reset peaks when channel count changes
  useEffect(() => {
    peaksRef.current = new Float32Array(numChannels);
  }, [numChannels]);

  // Main animation loop: update VU peaks + draw oscilloscope
  const tick = useCallback(() => {
    // --- VU peak decay ---
    const currentVU = channelVU;
    const p = peaksRef.current;
    const newLevels: number[] = [];
    const newPeaks: number[] = [];

    for (let i = 0; i < numChannels; i++) {
      const v = currentVU && i < currentVU.length
        ? Math.min(1, Math.max(0, currentVU[i]))
        : 0;
      p[i] = Math.max(v, (p[i] ?? 0) * PEAK_DECAY);
      newLevels.push(v);
      newPeaks.push(p[i]);
    }
    setLevels(newLevels);
    setPeaks(newPeaks);

    // --- Oscilloscope ---
    const canvas = scopeCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx && analyserNode) {
      const w = canvas.width;
      const h = canvas.height;
      const bufLen = analyserNode.frequencyBinCount;
      const buf = new Uint8Array(bufLen);
      analyserNode.getByteTimeDomainData(buf);

      ctx.fillStyle = SCOPE_BG;
      ctx.fillRect(0, 0, w, h);

      // Center line
      ctx.strokeStyle = '#374151'; // gray-700
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Waveform
      ctx.strokeStyle = SCOPE_STROKE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const sliceWidth = w / bufLen;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const y = (buf[i] / 255) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.stroke();
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [channelVU, numChannels, analyserNode]);

  useEffect(() => {
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, tick]);

  // Clear state when not playing
  useEffect(() => {
    if (!isPlaying) {
      setLevels([]);
      setPeaks([]);
      peaksRef.current = new Float32Array(numChannels);
      const canvas = scopeCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        ctx.fillStyle = SCOPE_BG;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, [isPlaying, numChannels]);

  // Resize canvas to match container
  const scopeContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = scopeContainerRef.current;
    const canvas = scopeCanvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect;
      canvas.width = Math.round(width * (window.devicePixelRatio || 1));
      canvas.height = Math.round(SCOPE_HEIGHT * (window.devicePixelRatio || 1));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${SCOPE_HEIGHT}px`;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex flex-col gap-2 bg-gray-900 rounded-lg p-3 shadow-lg select-none">
      {/* VU Meters */}
      <div className="flex items-end justify-center gap-px overflow-x-auto" style={{ height: 120 }}>
        {Array.from({ length: numChannels }, (_, i) => {
          const level = levels[i] ?? 0;
          const peak = peaks[i] ?? 0;
          const pct = Math.round(level * 100);
          const peakPct = Math.round(peak * 100);

          return (
            <div
              key={i}
              className="flex flex-col items-center"
              style={{ minWidth: numChannels > 16 ? 14 : 24, flex: '1 1 0' }}
            >
              {/* Bar container */}
              <div
                className="relative w-full bg-gray-800 rounded-sm overflow-hidden"
                style={{ height: 96 }}
              >
                {/* Filled bar with gradient */}
                <div
                  className="absolute bottom-0 left-0 right-0 transition-[height] duration-75"
                  style={{
                    height: `${pct}%`,
                    background:
                      'linear-gradient(to top, #22c55e 0%, #22c55e 50%, #eab308 75%, #ef4444 100%)',
                  }}
                />
                {/* Peak hold indicator */}
                {peakPct > 0 && (
                  <div
                    className="absolute left-0 right-0"
                    style={{
                      bottom: `${peakPct}%`,
                      height: 2,
                      backgroundColor: '#fbbf24', // amber-400
                      transform: 'translateY(1px)',
                    }}
                  />
                )}
              </div>
              {/* Channel label */}
              <span
                className="text-gray-500 font-mono leading-none mt-1 whitespace-nowrap"
                style={{ fontSize: numChannels > 16 ? 7 : 9 }}
              >
                {numChannels > 16 ? i + 1 : `CH ${i + 1}`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Oscilloscope */}
      <div ref={scopeContainerRef} className="w-full rounded-sm overflow-hidden border border-gray-800">
        <canvas
          ref={scopeCanvasRef}
          style={{ width: '100%', height: SCOPE_HEIGHT, display: 'block' }}
        />
      </div>
    </div>
  );
};

export default ChannelMeters;
