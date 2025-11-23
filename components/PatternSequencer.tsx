import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PatternMatrix } from '../types';

interface PatternSequencerProps {
  matrix: PatternMatrix | null;
  currentRow: number;
  globalRow?: number;
  totalRows?: number;
  onSeek?: (stepIndex: number) => void;
  bpm?: number;
}

export const PatternSequencer: React.FC<PatternSequencerProps> = ({ matrix, currentRow, globalRow = 0, totalRows: _totalRows = 0, onSeek, bpm: _bpm = 120 }) => {
  // 1. Defined all hooks unconditionally at the top
  const [cellSize] = useState<number>(14); // px
  const [visibleRows] = useState<number>(16);
  const [repeatCount] = useState<number>(2);
  const [layout] = useState<'4x32' | '8x16' | '2x64'>('4x32');
  const [autoFollow] = useState<boolean>(true);
  const [manualBank] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // 2. Always run useMemo, even if matrix is null (return safe defaults inside)
  const display = useMemo(() => {
    if (!matrix) return { rows: [], numChannels: 0, numRows: 0, order: 0, start: 0 };
    const { rows, numChannels, numRows, order } = matrix;
    let start = Math.max(0, currentRow - Math.floor(visibleRows / 2));
    if (start + visibleRows > numRows) start = Math.max(0, numRows - visibleRows);
    const slice = rows.slice(start, start + visibleRows);
    return { rows: slice, numChannels, numRows, order, start };
  }, [matrix, currentRow, visibleRows]);

  // 3. Always run useEffect
  useEffect(() => {
    if (!containerRef.current) return;

    const gap = 6;
    const headerOffset = cellSize + gap;
    const start = display.start ?? 0;
    const stepsPerRepeat = display.rows?.length ?? 0;

    if (stepsPerRepeat === 0) return;

    const visibleIndex = ((currentRow - start) % stepsPerRepeat + stepsPerRepeat) % stepsPerRepeat;
    const middleRepeat = Math.floor(repeatCount / 2);
    const targetIndex = visibleIndex + middleRepeat * stepsPerRepeat;

    const stepSpan = cellSize + gap;
    const targetLeft = headerOffset + targetIndex * stepSpan;

    if (playheadRef.current) {
      playheadRef.current.style.transform = `translateX(${targetLeft}px)`;
      playheadRef.current.style.opacity = '1';
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [currentRow, cellSize, visibleRows, display.start, display.rows, repeatCount]);

  // Helpers (not hooks)
  const columns = matrix?.numChannels ?? 0;
  const patternLen = matrix?.numRows ?? 64;
  const stepCount = Math.max(64, patternLen);

  let rowsLayout = 4, colsLayout = 32;
  if (layout === '8x16') { rowsLayout = 8; colsLayout = 16; }
  if (layout === '2x64') { rowsLayout = 2; colsLayout = 64; }

  const gridCapacity = colsLayout * rowsLayout;
  const totalBanks = Math.max(1, Math.ceil(stepCount / gridCapacity));
  const followBank = Math.floor((currentRow % Math.max(1, patternLen)) / gridCapacity);
  const bank = autoFollow ? followBank : Math.min(totalBanks - 1, Math.max(0, manualBank));
  // BPM calculation removed; per-channel display uses smooth CSS transitions

  const noteToHue = (note: string): number => {
    const noteMap: Record<string, number> = {
      'C': 0, 'C#': 30, 'D': 60, 'D#': 90, 'E': 120, 'F': 150,
      'F#': 180, 'G': 210, 'G#': 240, 'A': 270, 'A#': 300, 'B': 330
    };
    const match = (note || '').match(/^([A-G]#?)-?(\d)?/i);
    if (!match) return 0;
    const noteName = match[1];
    return noteMap[noteName.toUpperCase()] ?? 0;
  };

  const octaveToLightness = (note: string): number => {
    const match = (note || '').match(/-(\d)/);
    if (!match) return 50;
    const octave = parseInt(match[1], 10);
    return 35 + (octave * 8);
  };

  // 4. Always run this useMemo too
  const patternTiles = useMemo(() => {
    if (!matrix) return null;

    let rLayout = 4, cLayout = 32;
    if (layout === '8x16') { rLayout = 8; cLayout = 16; }
    if (layout === '2x64') { rLayout = 2; cLayout = 64; }

    const displayBanks = [] as number[];
    if (bank - 1 >= 0) displayBanks.push(bank - 1);
    displayBanks.push(bank);
    if (bank + 1 < totalBanks) displayBanks.push(bank + 1);
    const colsForRender = cLayout * displayBanks.length;

    const patternRows = matrix.rows || Array.from({ length: patternLen }, () => Array.from({ length: columns }, () => ({ type: 'empty', text: '' })));

    return { displayBanks, colsForRender, rLayout, cLayout, patternRows };
  }, [matrix, layout, bank, totalBanks, patternLen, columns]);

  // 5. Finally, conditional rendering logic at the very end
  if (!matrix || !patternTiles) {
    return (
        <section className="bg-gradient-to-br from-gray-900 to-black p-4 rounded-xl mb-4 text-sm text-gray-400 border border-white/4 shadow-lg">
          No pattern data available.
        </section>
    );
  }

  return (
      <section className="bg-gradient-to-b from-black/60 via-gray-900/60 to-black/40 p-4 rounded-xl mb-4 border border-white/5 shadow-2xl">
        <style>{`
        @keyframes neonPulse {
          0% { transform: scale(1); filter: drop-shadow(0 0 6px rgba(255,255,255,0.06)); }
          50% { transform: scale(1.12); filter: drop-shadow(0 0 22px rgba(255,255,255,0.14)); }
          100% { transform: scale(1); filter: drop-shadow(0 0 6px rgba(255,255,255,0.06)); }
        }
      `}</style>
        {/* Futuristic per-channel sequencer display */}
        <div className="mb-4 flex flex-col gap-3 relative">
          <div className="text-xs text-gray-400 flex items-center justify-between">
            <span>Multi-Channel Pattern Sequencer — {columns} Channels × {patternLen} Steps</span>
            <span className="text-gray-500">Row {currentRow + 1}/{patternLen}</span>
          </div>

          {/* Per-channel sequencer strips */}
          <div className="relative bg-black/60 rounded-xl p-4 border border-white/5 shadow-2xl overflow-x-auto" style={{ maxHeight: '60vh' }}>
            {Array.from({ length: columns }).map((_, chIdx) => {
              const { patternRows } = patternTiles;

              return (
                <div key={chIdx} className="flex items-center gap-2 mb-2 last:mb-0">
                  {/* Channel label */}
                  <div className="flex-shrink-0 w-16 text-right pr-2">
                    <div className="text-xs font-mono text-gray-400">CH {(chIdx + 1).toString().padStart(2, '0')}</div>
                  </div>

                  {/* Step strip for this channel */}
                  <div className="flex-1 flex gap-0.5 relative" style={{ minWidth: 0 }}>
                    {Array.from({ length: patternLen }).map((_, stepIdx) => {
                      const cells = patternRows[stepIdx] || Array.from({ length: columns }, () => ({ type: 'empty', text: '' }));
                      const cell = cells[chIdx];
                      const cellNote = cell && /[A-G]#?-/i.test(cell.text || '') ? cell.text : '';
                      const isActive = stepIdx === (currentRow % patternLen);

                      let cellColor = 'rgba(60,60,70,0.3)'; // empty/dim
                      let cellGlow = {};

                      if (cellNote) {
                        const hue = noteToHue(cellNote);
                        const light = octaveToLightness(cellNote);
                        cellColor = `hsl(${hue} 85% ${light}%)`;

                        if (isActive) {
                          // Active step: brightest neon glow
                          cellGlow = { boxShadow: `0 0 16px hsl(${hue} 95% ${light + 5}%)AA, 0 0 32px hsl(${hue} 90% ${light}%)66` };
                        } else {
                          // Inactive but has note: subtle glow
                          cellGlow = { boxShadow: `0 0 6px ${cellColor}55` };
                        }
                      } else if (isActive) {
                        // Active but empty: white/neutral glow
                        cellColor = 'rgba(255,255,255,0.15)';
                        cellGlow = { boxShadow: '0 0 12px rgba(255,255,255,0.4)' };
                      }

                      return (
                        <button
                          key={stepIdx}
                          data-row={stepIdx}
                          data-channel={chIdx}
                          onClick={() => {
                            const baseGlobal = (globalRow ?? 0) - currentRow;
                            const targetGlobal = baseGlobal + stepIdx;
                            onSeek?.(targetGlobal);
                          }}
                          className="flex-1 h-5 rounded transition-all duration-75 hover:opacity-90"
                          style={{
                            background: cellColor,
                            ...cellGlow,
                            transform: isActive ? 'scaleY(1.3)' : undefined,
                            opacity: cellNote ? (isActive ? 1 : 0.75) : (isActive ? 0.6 : 0.3),
                            minWidth: 4,
                            maxWidth: 20,
                          }}
                          title={cellNote ? `${cellNote} @ row ${stepIdx + 1}` : `Empty @ row ${stepIdx + 1}`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Playhead sweep line (vertical bar moving across all channels) */}
            <div
              style={{
                position: 'absolute',
                left: 'calc(4rem + 0.5rem)',
                top: 0,
                bottom: 0,
                width: 2,
                background: 'linear-gradient(180deg, rgba(255,230,120,0.8), rgba(255,230,120,0.3))',
                boxShadow: '0 0 16px rgba(255,230,120,0.6), 0 0 32px rgba(255,230,120,0.3)',
                pointerEvents: 'none',
                zIndex: 10,
                transform: `translateX(${((currentRow % patternLen) / Math.max(1, patternLen - 1)) * 100}%)`,
                transition: 'transform 80ms ease-out',
              }}
            />
          </div>
        </div>
        <div style={{ position: 'relative' }} ref={containerRef}>
          <div
              ref={playheadRef}
              style={{
                position: 'absolute',
                pointerEvents: 'none',
                transition: 'none',
                transform: 'translate(0px,0px)',
                zIndex: 60,
                opacity: 0,
                borderRadius: 6,
                boxShadow: '0 8px 30px rgba(255,200,60,0.06)',
                border: '2px solid rgba(255,230,120,0.2)',
                background: 'transparent'
              }}
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="text-xs text-gray-400">Pos</div>
          <input
              type="range"
              min={0}
              max={Math.max(0, (_totalRows || 0) - 1)}
              value={Math.min(globalRow, Math.max(0, (_totalRows || 0) - 1))}
              onChange={e => onSeek?.(Number(e.target.value))}
              className="w-full"
          />
          <div className="text-xs text-gray-300">{globalRow}/{_totalRows}</div>
        </div>
      </section>
  );
};