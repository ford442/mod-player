import type { InstrumentEnvelopeInfo } from '../types/instruments';
import { cn } from '../utils/cn';

interface EnvelopeLaneProps {
  label: string;
  envelope: InstrumentEnvelopeInfo;
  /** Ticks shown across the lane (shared by an instrument's lanes so they line up). */
  ticks: number;
  isDarkMode: boolean;
  /** Panning / pitch envelopes are centred on 32. */
  centred?: boolean;
  width?: number;
  height?: number;
}

/** Envelope values run 0..64 (libopenmpt's ENVELOPE_MAX). */
const ENVELOPE_MAX = 64;

/**
 * One instrument envelope (volume / panning / pitch) as a polyline over its nodes, with the
 * sustain point and loop range marked. Data from libopenmpt via the inspection shim
 * (utils/instrumentTable.ts); every format with instruments has them.
 */
export function EnvelopeLane({
  label,
  envelope,
  ticks,
  isDarkMode,
  centred = false,
  width = 280,
  height = 36,
}: EnvelopeLaneProps) {
  const { points } = envelope;
  const span = Math.max(1, ticks);
  const x = (tick: number) => (tick / span) * (width - 2) + 1;
  const y = (value: number) => height - 1 - (value / ENVELOPE_MAX) * (height - 2);
  const at = (node: number) => points[Math.min(Math.max(0, node), points.length - 1)];
  const loopFrom = envelope.loop ? at(envelope.loopStart) : undefined;
  const loopTo = envelope.loop ? at(envelope.loopEnd) : undefined;
  const sustain = envelope.sustain ? at(envelope.sustainStart) : undefined;
  const flags = [
    envelope.enabled ? null : 'off',
    envelope.loop ? 'loop' : null,
    envelope.sustain ? 'sus' : null,
    envelope.carry ? 'carry' : null,
    envelope.filter ? 'filter' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-0.5">
      <div className={cn('flex justify-between text-[10px]', isDarkMode ? 'text-gray-500' : 'text-gray-600')}>
        <span className="uppercase tracking-wide">{label}</span>
        <span>{flags || `${points.length} pts`}</span>
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn('w-full rounded', isDarkMode ? 'bg-black/35' : 'bg-gray-200/70')}
        role="img"
        aria-label={`${label} envelope, ${points.length} points`}
      >
        {centred && <line x1={0} x2={width} y1={y(32)} y2={y(32)} stroke="currentColor" strokeOpacity={0.12} />}
        {loopFrom && loopTo && (
          <rect
            x={x(loopFrom.tick)}
            y={0}
            width={Math.max(1, x(loopTo.tick) - x(loopFrom.tick))}
            height={height}
            fill="rgb(34 211 238 / 0.12)"
          />
        )}
        {sustain && (
          <line x1={x(sustain.tick)} x2={x(sustain.tick)} y1={0} y2={height} stroke="rgb(250 204 21 / 0.7)" strokeDasharray="2 2" />
        )}
        {points.length > 0 && (
          <polyline
            points={points.map((p) => `${x(p.tick)},${y(p.value)}`).join(' ')}
            fill="none"
            stroke={envelope.enabled ? '#22d3ee' : 'rgb(148 163 184 / 0.6)'}
            strokeWidth={1.25}
          />
        )}
        {points.map((p, i) => (
          <circle key={i} cx={x(p.tick)} cy={y(p.value)} r={1.75} fill={envelope.enabled ? '#22d3ee' : 'rgb(148 163 184)'} />
        ))}
      </svg>
    </div>
  );
}
