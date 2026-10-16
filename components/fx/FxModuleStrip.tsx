/** One FX rack module (#453): enable switch, order buttons, status, its params. */
import React from 'react';
import { FX_PARAM_SPECS, type ParamSpec } from '../../audio/fx/spec/paramSpecs';
import type { FxModuleId, FxModuleState, FxParamsById } from '../../audio/fx/types';
import type { FxModuleRuntime } from '../../store/fxStore';
import { cn } from '../../utils/cn';
import { Knob } from '../Knob';

const FX_MODULE_TITLES: Record<FxModuleId, string> = {
  character: 'Character',
  eq: 'EQ',
  comp: 'Glue comp',
  room: 'Room',
};

const MODULE_HINTS: Partial<Record<FxModuleId, string>> = {
  character:
    "The LED filter here colors the whole master bus, any format. For MODs, libopenmpt's Amiga resampler already models Paula's output filter and E0x LED commands — this stacks on top.",
};

interface FxModuleStripProps {
  id: FxModuleId;
  state: FxModuleState<FxParamsById[FxModuleId]>;
  rackEnabled: boolean;
  runtime: FxModuleRuntime | undefined;
  isFirst: boolean;
  isLast: boolean;
  reducedMotion: boolean;
  onToggle: () => void;
  onMove: (delta: -1 | 1) => void;
  onParam: (key: string, value: number | boolean | string) => void;
  onRetry: () => void;
}

const toggleClass = (on: boolean) =>
  cn(
    'px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider transition-colors',
    on
      ? 'bg-cyan-900/40 text-cyan-200 border-cyan-600'
      : 'bg-transparent text-[var(--text-secondary)] border-[var(--edge-highlight)] hover:text-[var(--text-accent)]',
  );

function ParamControl({
  moduleId,
  spec,
  value,
  disabled,
  reducedMotion,
  onParam,
}: {
  moduleId: FxModuleId;
  spec: ParamSpec;
  value: unknown;
  disabled: boolean;
  reducedMotion: boolean;
  onParam: (key: string, value: number | boolean | string) => void;
}) {
  const name = `${FX_MODULE_TITLES[moduleId]} ${spec.label}`;
  if (spec.kind === 'number') {
    return (
      <Knob
        spec={spec}
        value={value as number}
        label={spec.label}
        disabled={disabled}
        reducedMotion={reducedMotion}
        onChange={(v) => onParam(spec.key, v)}
      />
    );
  }
  if (spec.kind === 'bool') {
    const on = value as boolean;
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-label={name}
        disabled={disabled}
        onClick={() => onParam(spec.key, !on)}
        className={cn(toggleClass(on), 'self-center disabled:opacity-40')}
      >
        {spec.label}
      </button>
    );
  }
  return (
    <div role="radiogroup" aria-label={name} className="flex self-center rounded border border-[var(--edge-highlight)] overflow-hidden">
      {spec.options.map((option) => {
        const checked = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onParam(spec.key, option.value)}
            className={cn(
              'px-2 py-0.5 text-[10px] font-mono disabled:opacity-40',
              checked ? 'bg-cyan-900/50 text-cyan-200' : 'text-[var(--text-secondary)] hover:text-[var(--text-accent)]',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export const FxModuleStrip: React.FC<FxModuleStripProps> = ({
  id,
  state,
  rackEnabled,
  runtime,
  isFirst,
  isLast,
  reducedMotion,
  onToggle,
  onMove,
  onParam,
  onRetry,
}) => {
  const title = FX_MODULE_TITLES[id];
  const unavailable = runtime?.status === 'unavailable';
  const params = state.params as unknown as Record<string, unknown>;
  const hint = MODULE_HINTS[id];

  return (
    <section
      aria-label={`${title} module`}
      className={cn(
        'rounded-lg border p-2 flex flex-col gap-2 min-w-0',
        state.enabled && rackEnabled ? 'border-cyan-800 bg-cyan-950/20' : 'border-[var(--edge-highlight)] bg-panel-inset',
      )}
    >
      <header className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={state.enabled}
          aria-label={`${title} ${state.enabled ? 'on' : 'off'}`}
          disabled={unavailable && !state.enabled}
          onClick={onToggle}
          className={cn(toggleClass(state.enabled), 'disabled:opacity-40')}
        >
          {state.enabled ? 'On' : 'Off'}
        </button>
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-accent flex-1 truncate">{title}</h3>
        {runtime?.status === 'loading' && <span className="text-[10px] text-amber-300 font-mono">Loading IR…</span>}
        <button
          type="button"
          aria-label={`Move ${title} earlier`}
          disabled={isFirst}
          onClick={() => onMove(-1)}
          className="px-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-accent)] disabled:opacity-30"
        >
          ◀
        </button>
        <button
          type="button"
          aria-label={`Move ${title} later`}
          disabled={isLast}
          onClick={() => onMove(1)}
          className="px-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-accent)] disabled:opacity-30"
        >
          ▶
        </button>
      </header>

      {unavailable && (
        <p role="status" className="text-[10px] text-amber-300 font-mono flex items-center gap-2">
          <span className="flex-1">Unavailable — this browser couldn&apos;t load the room IR.</span>
          <button type="button" onClick={onRetry} className="underline hover:text-amber-200">
            Retry
          </button>
        </p>
      )}

      <div className="flex flex-wrap gap-x-1 gap-y-2 items-start">
        {FX_PARAM_SPECS[id].map((spec) => (
          <ParamControl
            key={spec.key}
            moduleId={id}
            spec={spec}
            value={params[spec.key]}
            disabled={unavailable}
            reducedMotion={reducedMotion}
            onParam={onParam}
          />
        ))}
      </div>
      {hint && <p className="text-[9px] leading-snug text-[var(--text-secondary)]">{hint}</p>}
    </section>
  );
};
