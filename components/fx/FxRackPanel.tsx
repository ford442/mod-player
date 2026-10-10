/**
 * FX rack panel (#453): preset picker, global / this-song scope, rack switch,
 * and one strip per module in rack order. Talks only to the store; the audio
 * graph follows the store through the lazily loaded rack controller.
 */
import React, { useMemo, useState } from 'react';
import { retryFxModule } from '../../audio/fx/fxBootstrap';
import { CUSTOM_PRESET_ID, listFxPresets, useFxStore } from '../../store/fxStore';
import { useShaderPrefsStore } from '../../store/shaderPrefsStore';
import { cn } from '../../utils/cn';
import { FxModuleStrip } from './FxModuleStrip';

const buttonClass =
  'px-2 py-1 rounded border text-[10px] font-mono transition-colors border-[var(--edge-highlight)] ' +
  'text-[var(--text-secondary)] hover:text-[var(--text-accent)] disabled:opacity-40 disabled:hover:text-[var(--text-secondary)]';

export const FxRackPanel: React.FC = () => {
  const effective = useFxStore((s) => s.effective);
  const scope = useFxStore((s) => s.scope);
  const presetId = useFxStore((s) => s.effectivePresetId);
  const userPresets = useFxStore((s) => s.userPresets);
  const songFingerprint = useFxStore((s) => s.songFingerprint);
  const moduleStatus = useFxStore((s) => s.moduleStatus);
  const rackStatus = useFxStore((s) => s.rackStatus);
  const reducedMotion = useShaderPrefsStore((s) => s.reducedMotion);
  const actions = useFxStore.getState();
  const presets = useMemo(() => listFxPresets(userPresets), [userPresets]);
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState('');

  const selectValue = presetId && presets.some((p) => p.id === presetId) ? presetId : CUSTOM_PRESET_ID;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={effective.enabled}
          onClick={() => actions.setModuleEnabled('rack')}
          className={cn(
            'px-3 py-1 rounded border font-mono text-[11px] uppercase tracking-wider',
            effective.enabled
              ? 'bg-cyan-900/40 text-cyan-200 border-cyan-600'
              : 'text-[var(--text-secondary)] border-[var(--edge-highlight)]',
          )}
        >
          Rack {effective.enabled ? 'on' : 'bypassed'}
        </button>

        <label className="flex items-center gap-1 text-[var(--text-secondary)]">
          <span className="sr-only sm:not-sr-only">Preset</span>
          <select
            value={selectValue}
            onChange={(e) => e.target.value !== CUSTOM_PRESET_ID && actions.applyPreset(e.target.value)}
            className="bg-panel-inset border border-[var(--edge-highlight)] rounded px-1 py-0.5 font-mono text-[11px]"
          >
            {selectValue === CUSTOM_PRESET_ID && <option value={CUSTOM_PRESET_ID}>Custom</option>}
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <span
          className={cn(
            'px-2 py-0.5 rounded-full text-[10px] font-mono border',
            scope === 'song' ? 'text-amber-200 border-amber-700 bg-amber-900/30' : 'text-[var(--text-secondary)] border-[var(--edge-highlight)]',
          )}
          title={scope === 'song' ? 'Edits apply to this song only' : 'Edits apply to every song without its own settings'}
        >
          {scope === 'song' ? 'This song' : 'Global'}
        </span>

        <button type="button" className={buttonClass} disabled={!songFingerprint} onClick={() => actions.saveForThisSong()}>
          Save for this song
        </button>
        <button type="button" className={buttonClass} disabled={scope !== 'song'} onClick={() => actions.resetSongToGlobal()}>
          Reset to global
        </button>
        {naming ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              actions.saveUserPreset(presetName);
              setPresetName('');
              setNaming(false);
            }}
          >
            <input
              autoFocus
              aria-label="Preset name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
              className="bg-panel-inset border border-[var(--edge-highlight)] rounded px-1 py-0.5 font-mono text-[11px] w-28"
            />
            <button type="submit" className={buttonClass}>
              Save
            </button>
          </form>
        ) : (
          <button type="button" className={buttonClass} onClick={() => setNaming(true)}>
            Save preset…
          </button>
        )}
        {rackStatus === 'error' && <span className="text-amber-300 font-mono text-[10px]">FX rack failed to load</span>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {effective.order.map((id, index) => (
          <FxModuleStrip
            key={id}
            id={id}
            state={effective.modules[id]}
            rackEnabled={effective.enabled}
            runtime={moduleStatus[id]}
            isFirst={index === 0}
            isLast={index === effective.order.length - 1}
            reducedMotion={reducedMotion}
            onToggle={() => actions.setModuleEnabled(id)}
            onMove={(delta) => actions.moveModule(id, delta)}
            onParam={(key, value) => actions.setParam(id, key, value)}
            onRetry={() => retryFxModule(id)}
          />
        ))}
      </div>
    </div>
  );
};

export default FxRackPanel;
