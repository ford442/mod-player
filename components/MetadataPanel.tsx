import { useMemo } from 'react';
import type { PatternMatrix } from '../types';

export interface ModuleMetadata {
  title: string;
  artist: string;
  tracker: string;
  numChannels: number;
  numOrders: number;
  numPatterns: number;
  numInstruments: number;
  durationSeconds: number;
  currentBpm: number;
  instruments: string[];
}

interface MetadataPanelProps {
  metadata: ModuleMetadata | null;
  currentOrder: number;
  currentRow: number;
  currentPattern: number;
  matrix: PatternMatrix | null;
  isPlaying: boolean;
  playbackSeconds: number;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export const MetadataPanel: React.FC<MetadataPanelProps> = ({
  metadata,
  currentOrder,
  currentRow,
  currentPattern,
  matrix,
  isPlaying,
  playbackSeconds,
}) => {
  const instruments = useMemo(() => {
    if (!metadata?.instruments) return [];
    return metadata.instruments.filter(name => name.trim().length > 0);
  }, [metadata?.instruments]);

  if (!metadata) {
    return (
      <section className="bg-gray-900 rounded-xl border border-white/5 p-4 text-sm text-gray-500 font-mono">
        No module loaded
      </section>
    );
  }

  return (
    <section className="bg-gray-900 rounded-xl border border-white/5 shadow-lg overflow-hidden text-xs font-mono">
      {/* Title bar */}
      <div className="px-4 py-2 bg-black/40 border-b border-white/5 flex items-center justify-between">
        <span className="text-cyan-300 font-bold text-sm truncate">
          {metadata.title || 'Untitled'}
        </span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${isPlaying ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
          {isPlaying ? '▶ PLAYING' : '■ STOPPED'}
        </span>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-px bg-white/5">
        <InfoRow label="Artist" value={metadata.artist || '—'} />
        <InfoRow label="Tracker" value={metadata.tracker || '—'} />
        <InfoRow label="Channels" value={String(metadata.numChannels)} />
        <InfoRow label="BPM" value={String(Math.round(metadata.currentBpm))} />
        <InfoRow label="Orders" value={`${currentOrder}/${metadata.numOrders}`} />
        <InfoRow label="Pattern" value={currentPattern.toString(16).toUpperCase().padStart(2, '0')} />
        <InfoRow label="Row" value={`${currentRow}/${matrix?.numRows ?? '?'}`} />
        <InfoRow label="Length" value={formatTime(metadata.durationSeconds)} />
        <InfoRow label="Position" value={formatTime(playbackSeconds)} span2 />
      </div>

      {/* Instruments */}
      {instruments.length > 0 && (
        <div className="border-t border-white/5">
          <div className="px-3 py-1.5 bg-black/20 text-gray-500 text-[10px] uppercase tracking-wider">
            Instruments ({instruments.length})
          </div>
          <div className="max-h-32 overflow-y-auto pattern-scrollbar">
            {instruments.map((name, i) => (
              <div
                key={i}
                className="px-3 py-0.5 text-gray-400 hover:bg-white/5 flex gap-2"
              >
                <span className="text-gray-600 w-5 text-right shrink-0">
                  {(i + 1).toString(16).toUpperCase().padStart(2, '0')}
                </span>
                <span className="truncate">{name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

function InfoRow({ label, value, span2 }: { label: string; value: string; span2?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 bg-gray-900 ${span2 ? 'col-span-2' : ''}`}>
      <span className="text-gray-500 w-16 shrink-0">{label}</span>
      <span className="text-gray-200 truncate">{value}</span>
    </div>
  );
}
