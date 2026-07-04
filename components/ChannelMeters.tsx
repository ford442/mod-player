import { useRef, useEffect, useCallback } from 'react';
import {
  DB_FLOOR,
  advanceChannelMeter,
  applyDbGradient,
  capDeltaTime,
  createChannelMeterState,
  dbToNormalized,
  linearToDb,
  resetChannelMeterState,
  type ChannelMeterState,
} from './channelMetersUtils';

interface ChannelMetersProps {
  channelVU: Float32Array | null;
  numChannels: number;
  analyserNode: AnalyserNode | null;
  isPlaying: boolean;
}

const METER_BAR_HEIGHT = 96;
const METER_CONTAINER_HEIGHT = 120;
const SCOPE_HEIGHT = 80;
const SCOPE_BG = '#111827';     // bg-gray-900
const SCOPE_STROKE = '#34d399'; // emerald-400
const METER_BG = '#1f2937';     // gray-800
const TICK_COLOR = '#374151';   // gray-700
const ARIA_UPDATE_MS = 1000;

const DB_TICK_MARKS = [-20, -12, -6, 0];

function ensureChannelStates(
  states: ChannelMeterState[],
  count: number,
): ChannelMeterState[] {
  if (states.length === count) return states;
  const next: ChannelMeterState[] = [];
  for (let i = 0; i < count; i++) {
    next.push(states[i] ?? createChannelMeterState());
  }
  return next;
}

/** Per-channel VU meters (canvas, dB-scaled) with peak hold + stereo oscilloscope. */
export const ChannelMeters: React.FC<ChannelMetersProps> = ({
  channelVU,
  numChannels,
  analyserNode,
  isPlaying,
}) => {
  const channelStatesRef = useRef<ChannelMeterState[]>([]);
  const meterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scopeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const meterContainerRef = useRef<HTMLDivElement | null>(null);
  const scopeContainerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const lastAriaUpdateRef = useRef<number>(0);

  const channelVURef = useRef(channelVU);
  const numChannelsRef = useRef(numChannels);
  const analyserNodeRef = useRef(analyserNode);
  channelVURef.current = channelVU;
  numChannelsRef.current = numChannels;
  analyserNodeRef.current = analyserNode;

  useEffect(() => {
    channelStatesRef.current = ensureChannelStates(
      channelStatesRef.current,
      numChannels,
    ).map((s) => {
      resetChannelMeterState(s);
      return s;
    });
  }, [numChannels]);

  const drawMeters = useCallback((nowMs: number, dtSec: number) => {
    const canvas = meterCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;
    const barH = Math.round(METER_BAR_HEIGHT * dpr);
    const nCh = numChannelsRef.current;
    const states = channelStatesRef.current;
    const currentVU = channelVURef.current;

    ctx.fillStyle = METER_BG;
    ctx.fillRect(0, 0, w, h);

    if (nCh <= 0) return;

    const colW = w / nCh;
    const gap = Math.max(1, Math.round(dpr));
    const barW = Math.max(1, colW - gap);

    for (let tickDb of DB_TICK_MARKS) {
      const y = barH - dbToNormalized(tickDb) * barH;
      ctx.strokeStyle = TICK_COLOR;
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    for (let i = 0; i < nCh; i++) {
      const x = i * colW + gap / 2;
      const target =
        currentVU && i < currentVU.length
          ? Math.min(1, Math.max(0, currentVU[i] ?? 0))
          : 0;

      const state = states[i] ?? createChannelMeterState();
      if (!states[i]) states[i] = state;

      const frame = advanceChannelMeter(state, target, dtSec, nowMs);
      const levelNorm = dbToNormalized(frame.smoothedDb);
      const peakNorm = dbToNormalized(frame.peakDb);
      const fillH = levelNorm * barH;

      ctx.fillStyle = METER_BG;
      ctx.fillRect(x, 0, barW, barH);

      if (fillH > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, barH - fillH, barW, fillH);
        ctx.clip();
        ctx.fillStyle = applyDbGradient(ctx, x + barW / 2, 0, barH);
        ctx.fillRect(x, 0, barW, barH);
        ctx.restore();
      }

      if (peakNorm > 0) {
        const peakY = barH - peakNorm * barH;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, peakY - dpr, barW, Math.max(1, dpr * 2));
      }

      if (frame.hotLatched) {
        const ledSize = Math.max(3, Math.round(4 * dpr));
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(x + (barW - ledSize) / 2, 0, ledSize, ledSize);
      }
    }

    if (nowMs - lastAriaUpdateRef.current >= ARIA_UPDATE_MS) {
      lastAriaUpdateRef.current = nowMs;
      let active = 0;
      let hottestDb = DB_FLOOR;
      for (let i = 0; i < nCh; i++) {
        const s = states[i];
        if (!s) continue;
        const db = linearToDb(s.smoothedLinear);
        if (db > DB_FLOOR + 1) active++;
        if (db > hottestDb) hottestDb = db;
      }
      const hotText =
        hottestDb > DB_FLOOR + 1
          ? `, loudest channel about ${Math.round(hottestDb)} dB`
          : '';
      canvas.setAttribute(
        'aria-label',
        `VU meters for ${nCh} channels, ${active} active${hotText}. True 0 dBFS clip not detectable from level data; red LED indicates near-full-scale hot signal.`,
      );
    }
  }, []);

  const drawOscilloscope = useCallback(() => {
    const canvas = scopeCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    const an = analyserNodeRef.current;
    if (!canvas || !ctx || !an) return;

    const w = canvas.width;
    const h = canvas.height;
    const bufLen = an.frequencyBinCount;
    const buf = new Uint8Array(bufLen);
    an.getByteTimeDomainData(buf);

    ctx.fillStyle = SCOPE_BG;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    ctx.strokeStyle = SCOPE_STROKE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const sliceWidth = w / bufLen;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const sample = buf[i] ?? 128;
      const y = (sample / 255) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.stroke();
  }, []);

  const tick = useCallback((timestamp: number) => {
    const prev = lastFrameTimeRef.current;
    let dt =
      prev > 0 && timestamp > prev ? (timestamp - prev) / 1000 : 1 / 60;
    dt = capDeltaTime(dt);
    lastFrameTimeRef.current = timestamp;
    drawMeters(timestamp, dt);
    drawOscilloscope();
    rafRef.current = requestAnimationFrame(tick);
  }, [drawMeters, drawOscilloscope]);

  useEffect(() => {
    if (isPlaying) {
      lastFrameTimeRef.current = 0;
      lastAriaUpdateRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, tick]);

  useEffect(() => {
    if (!isPlaying) {
      lastFrameTimeRef.current = 0;
      channelStatesRef.current.forEach(resetChannelMeterState);

      const clearCanvas = (
        canvas: HTMLCanvasElement | null,
        bg: string,
      ) => {
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      };
      clearCanvas(meterCanvasRef.current, METER_BG);
      clearCanvas(scopeCanvasRef.current, SCOPE_BG);

      const meterCanvas = meterCanvasRef.current;
      if (meterCanvas) {
        meterCanvas.setAttribute(
          'aria-label',
          `VU meters for ${numChannels} channels, stopped.`,
        );
      }
    }
  }, [isPlaying, numChannels]);

  useEffect(() => {
    const container = meterContainerRef.current;
    const canvas = meterCanvasRef.current;
    if (!container || !canvas) return;

    const resize = (width: number) => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(METER_BAR_HEIGHT * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${METER_BAR_HEIGHT}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = METER_BG;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    };

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      resize(entry.contentRect.width);
    });
    ro.observe(container);
    resize(container.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const container = scopeContainerRef.current;
    const canvas = scopeCanvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(SCOPE_HEIGHT * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${SCOPE_HEIGHT}px`;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const labelSize = numChannels > 16 ? 7 : 9;
  const labelMinWidth = numChannels > 16 ? 14 : 24;

  return (
    <div className="flex flex-col gap-2 bg-gray-900 rounded-lg p-3 shadow-lg select-none">
      <div
        ref={meterContainerRef}
        className="w-full overflow-x-auto"
        style={{ height: METER_CONTAINER_HEIGHT }}
      >
        <canvas
          ref={meterCanvasRef}
          role="img"
          aria-label={`VU meters for ${numChannels} channels.`}
          style={{ width: '100%', height: METER_BAR_HEIGHT, display: 'block' }}
        />
        <div className="flex items-start justify-center gap-px mt-1">
          {Array.from({ length: numChannels }, (_, i) => (
            <span
              key={i}
              className="text-gray-500 font-mono leading-none whitespace-nowrap text-center"
              style={{
                fontSize: labelSize,
                minWidth: labelMinWidth,
                flex: '1 1 0',
              }}
            >
              {numChannels > 16 ? i + 1 : `CH ${i + 1}`}
            </span>
          ))}
        </div>
      </div>

      <div
        ref={scopeContainerRef}
        className="w-full rounded-sm overflow-hidden border border-gray-800"
      >
        <canvas
          ref={scopeCanvasRef}
          style={{ width: '100%', height: SCOPE_HEIGHT, display: 'block' }}
        />
      </div>
    </div>
  );
};

export default ChannelMeters;
