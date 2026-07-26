import { useEffect, useRef } from 'react';

interface SampleWaveformProps {
  waveform: Float32Array;
  /** Sample length in bytes (for loop marker mapping). */
  length: number;
  loopStart?: number;
  loopEnd?: number;
  width?: number;
  height?: number;
  className?: string;
  /** Accent stroke color. */
  color?: string;
}

/**
 * Canvas 2D mini waveform from downsampled peaks (typically 256 points in [-1, 1]).
 */
export function SampleWaveform({
  waveform,
  length,
  loopStart = 0,
  loopEnd = 0,
  width = 160,
  height = 36,
  className,
  color = '#22d3ee',
}: SampleWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, width, height);

    const mid = height / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();

    const n = waveform.length;
    if (n === 0) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / Math.max(1, n - 1)) * width;
      const v = waveform[i] ?? 0;
      const y = mid - v * (mid - 1);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (length > 0 && loopEnd > loopStart) {
      const x0 = (loopStart / length) * width;
      const x1 = (loopEnd / length) * width;
      ctx.fillStyle = 'rgba(34, 211, 238, 0.12)';
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), height);
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.7)';
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0, height);
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, height);
      ctx.stroke();
    }
  }, [waveform, length, loopStart, loopEnd, width, height, color]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={width}
      height={height}
      aria-hidden
    />
  );
}
