import { useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { InstrumentTable } from '../types/instruments';
import { usePlayerUiStore } from '../store/playerUiStore';
import { useShaderPrefsStore } from '../store/shaderPrefsStore';
import { usesInstrumentPalette } from '../utils/shaderVersion';
import { SampleWaveform } from './SampleWaveform';
import { cn } from '../utils/cn';

const ROW_HEIGHT = 72;

interface InstrumentPanelProps {
  table: InstrumentTable;
  instrumentPalette: Uint8Array;
  shaderFile: string;
  isDarkMode: boolean;
}

function paletteSwatchCss(palette: Uint8Array, instrumentIndex1Based: number): string {
  const i = Math.max(0, instrumentIndex1Based - 1) % 64;
  const o = i * 4;
  const r = palette[o] ?? 40;
  const g = palette[o + 1] ?? 40;
  const b = palette[o + 2] ?? 40;
  return `rgb(${r},${g},${b})`;
}

function formatBytes(n: number): string {
  if (n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function InstrumentPanel({
  table,
  instrumentPalette,
  shaderFile,
  isDarkMode,
}: InstrumentPanelProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const selectedInstrumentIndex = usePlayerUiStore((s) => s.selectedInstrumentIndex);
  const selectedSampleIndex = usePlayerUiStore((s) => s.selectedSampleIndex);
  const setSelectedInstrumentIndex = usePlayerUiStore((s) => s.setSelectedInstrumentIndex);
  const setSelectedSampleIndex = usePlayerUiStore((s) => s.setSelectedSampleIndex);
  const setPaletteMode = useShaderPrefsStore((s) => s.setPaletteMode);

  const instruments = table.instruments;
  const hasPcm = table.format !== 'unknown' && table.samples.some((s) => s.length > 0);

  const virtualizer = useVirtualizer({
    count: instruments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });

  const selectedSample = useMemo(() => {
    if (selectedSampleIndex == null) return null;
    return table.samples.find((s) => s.index === selectedSampleIndex) ?? null;
  }, [table.samples, selectedSampleIndex]);

  const onSelectInstrument = useCallback(
    (index: number) => {
      setSelectedInstrumentIndex(index);
      const inst = instruments.find((i) => i.index === index);
      const firstSample = inst?.sampleIndices[0] ?? null;
      setSelectedSampleIndex(firstSample);
      if (usesInstrumentPalette(shaderFile)) {
        setPaletteMode(1);
      }
    },
    [
      instruments,
      setSelectedInstrumentIndex,
      setSelectedSampleIndex,
      setPaletteMode,
      shaderFile,
    ],
  );

  if (instruments.length === 0) {
    return (
      <div className={cn('text-xs font-mono p-3', isDarkMode ? 'text-gray-500' : 'text-gray-600')}>
        No instruments loaded.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-xs font-mono">
      {!hasPcm && (
        <p className={cn('px-1', isDarkMode ? 'text-amber-500/80' : 'text-amber-700')}>
          Sample PCM unavailable for this format — showing names only.
        </p>
      )}
      <div
        ref={parentRef}
        className={cn(
          'h-72 overflow-auto rounded-lg border',
          isDarkMode ? 'border-white/10 bg-black/30' : 'border-gray-300 bg-white/60',
        )}
      >
        <div
          style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const inst = instruments[virtualRow.index];
            if (!inst) return null;
            const selected = selectedInstrumentIndex === inst.index;
            const swatch = paletteSwatchCss(instrumentPalette, inst.index);
            const sampleCount = inst.sampleIndices.length || inst.samples.length;
            const preview =
              selected && selectedSample
                ? selectedSample
                : inst.samples[0] ?? table.samples.find((s) => s.index === inst.sampleIndices[0]);

            return (
              <button
                key={inst.index}
                type="button"
                onClick={() => onSelectInstrument(inst.index)}
                className={cn(
                  'absolute left-0 top-0 w-full flex items-center gap-2 px-2 text-left transition-colors',
                  selected
                    ? 'bg-cyan-900/40 ring-1 ring-inset ring-cyan-500/50'
                    : isDarkMode
                      ? 'hover:bg-white/5'
                      : 'hover:bg-black/5',
                  selected && 'animate-[pulse_0.6s_ease-in-out_1]',
                )}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <span
                  className="w-3 h-3 rounded-sm shrink-0 border border-white/20"
                  style={{ backgroundColor: swatch }}
                  aria-hidden
                />
                <span className={cn('w-8 shrink-0 tabular-nums', isDarkMode ? 'text-cyan-400' : 'text-cyan-700')}>
                  {inst.index.toString(16).toUpperCase().padStart(2, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate', isDarkMode ? 'text-gray-200' : 'text-gray-800')}>
                    {inst.name || '(unnamed)'}
                  </div>
                  <div className={cn('text-[10px]', isDarkMode ? 'text-gray-500' : 'text-gray-500')}>
                    {sampleCount} sample{sampleCount === 1 ? '' : 's'}
                    {preview && preview.length > 0 ? ` · ${formatBytes(preview.length)}` : ''}
                    {preview && preview.volume > 0 ? ` · vol ${preview.volume}` : ''}
                  </div>
                </div>
                {preview && preview.waveform.length > 0 && preview.length > 0 && (
                  <SampleWaveform
                    waveform={preview.waveform}
                    length={preview.length}
                    loopStart={preview.loopStart}
                    loopEnd={preview.loopEnd}
                    width={96}
                    height={28}
                    color={swatch}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selectedInstrumentIndex != null && (
        <div className={cn('rounded-lg border p-2', isDarkMode ? 'border-white/10' : 'border-gray-300')}>
          <div className={cn('mb-1 text-[10px] uppercase tracking-wide', isDarkMode ? 'text-gray-500' : 'text-gray-500')}>
            Samples
          </div>
          <ul className="flex flex-col gap-1 max-h-40 overflow-auto">
            {(instruments.find((i) => i.index === selectedInstrumentIndex)?.samples ??
              table.samples.filter((s) =>
                instruments
                  .find((i) => i.index === selectedInstrumentIndex)
                  ?.sampleIndices.includes(s.index),
              )
            ).map((sample) => {
              const active = selectedSampleIndex === sample.index;
              return (
                <li key={sample.index}>
                  <button
                    type="button"
                    onClick={() => setSelectedSampleIndex(sample.index)}
                    className={cn(
                      'w-full flex items-center gap-2 px-1 py-1 rounded text-left',
                      active
                        ? 'bg-cyan-900/30'
                        : isDarkMode
                          ? 'hover:bg-white/5'
                          : 'hover:bg-black/5',
                    )}
                  >
                    <span className="w-6 tabular-nums text-cyan-400/80">
                      {sample.index.toString(16).toUpperCase().padStart(2, '0')}
                    </span>
                    <span className="flex-1 truncate">{sample.name || '(unnamed)'}</span>
                    <span className="text-[10px] opacity-60">{formatBytes(sample.length)}</span>
                  </button>
                  {active && sample.length > 0 && (
                    <SampleWaveform
                      waveform={sample.waveform}
                      length={sample.length}
                      loopStart={sample.loopStart}
                      loopEnd={sample.loopEnd}
                      width={280}
                      height={48}
                      className="mt-1 w-full"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
