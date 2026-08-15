import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { InspectorListKind } from '../utils/inspectorListKind';

const ROW_HEIGHT = 22;
const VIRTUALIZE_THRESHOLD = 32;

export interface InstrumentInspectorProps {
  kind: InspectorListKind;
  names: readonly string[];
  format: string;
}

function formatIndex(index1Based: number): string {
  return index1Based.toString(16).toUpperCase().padStart(2, '0');
}

function displayName(name: string): string {
  return name.trim() ? name : '(unnamed)';
}

function ListRow({ index, name }: { index: number; name: string }) {
  const label = `${formatIndex(index)} ${displayName(name)}`;
  return (
    <div
      role="listitem"
      className="px-3 py-0.5 text-gray-400 hover:bg-white/5 flex gap-2"
      aria-label={label}
    >
      <span className="text-gray-600 w-5 text-right shrink-0 tabular-nums">
        {formatIndex(index)}
      </span>
      <span className="truncate">{displayName(name)}</span>
    </div>
  );
}

/**
 * Read-only instrument/sample name list for Module Info.
 * Collapsed chrome is owned by the parent (`<details>`).
 */
export function InstrumentInspector({ kind, names, format }: InstrumentInspectorProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const useVirtual = names.length > VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: useVirtual ? names.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  if (names.length === 0) {
    return (
      <div className="px-3 py-2 text-gray-500 text-[11px]">
        No {kind === 'instruments' ? 'instruments' : 'samples'} loaded.
      </div>
    );
  }

  const badge = format.trim() ? format.trim().toUpperCase() : null;

  return (
    <div className="flex flex-col">
      {badge && (
        <div className="px-3 pt-1.5 pb-0.5 flex items-center gap-2">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950/60 text-cyan-400/90 border border-cyan-900/50 uppercase tracking-wider">
            {badge}
          </span>
          <span className="text-[10px] text-gray-600">
            {kind === 'instruments' ? 'Instruments' : 'Samples'}
          </span>
        </div>
      )}
      <div
        ref={parentRef}
        role="list"
        aria-label={kind === 'instruments' ? 'Instruments' : 'Samples'}
        className="max-h-48 overflow-y-auto pattern-scrollbar"
      >
        {useVirtual ? (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const name = names[virtualRow.index] ?? '';
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ListRow index={virtualRow.index + 1} name={name} />
                </div>
              );
            })}
          </div>
        ) : (
          names.map((name, i) => (
            <ListRow key={i} index={i + 1} name={name} />
          ))
        )}
      </div>
    </div>
  );
}
