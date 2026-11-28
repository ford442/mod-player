import { useShallow } from 'zustand/react/shallow';
import { useState } from 'react';
import { Header } from './Header';
import { GlobalControlsBar } from './GlobalControlsBar';
import { PerformanceStage } from './PerformanceStage';
import { TransportBar } from './TransportBar';
import { SidePanelGrid } from './SidePanelGrid';
import { PatternEditorSection } from './PatternEditorSection';
import { LibraryAndPlaylistSection } from './LibraryAndPlaylistSection';
import { HardwareMovingHead } from './HardwareMovingHead';
import { moduleFormatsSummary } from '../utils/moduleFormats';
import { usePlayerEngine } from '../hooks/usePlayerEngine';
import { usePlayerUiStore } from '../store/playerUiStore';

export interface ChromeLayoutProps {
  /** See MainLayoutProps.studioDisplayHost — forwarded to PerformanceStage. */
  studioDisplayHost?: HTMLDivElement | null;
}

/**
 * Invariant page tree: chrome wrappers stay mounted; PerformanceStage is always
 * child index 1. Stage mode is CSS (`data-stage-mode` on MainLayout), not a subtree swap.
 * 3D mode is likewise CSS/overlay (App.tsx renders it as a sibling), never a subtree swap.
 */
export function ChromeLayout({ studioDisplayHost = null }: ChromeLayoutProps = {}) {
  const status = usePlayerEngine((s) => s.status);
  const isModuleLoaded = usePlayerEngine((s) => s.isModuleLoaded);
  const { stageMode } = usePlayerUiStore(useShallow((s) => ({ stageMode: s.stageMode })));
  const [showMovingHead, setShowMovingHead] = useState(false);

  return (
    <div className="w-full max-w-[1280px]">
      <div className="stage-chrome" aria-hidden={stageMode}>
        <Header status={status} isModuleLoaded={isModuleLoaded} />
        <GlobalControlsBar />
      </div>

      <PerformanceStage studioDisplayHost={studioDisplayHost} />

      <div className="stage-chrome" aria-hidden={stageMode}>
        <TransportBar />
        <SidePanelGrid />
        <PatternEditorSection />
        <LibraryAndPlaylistSection />
        <div className="mt-8 text-center text-xs opacity-50">
          <p>{moduleFormatsSummary()}</p>
          <p>WebGPU required for visualization.</p>
          <button
            onClick={() => setShowMovingHead(true)}
            className="mt-3 px-3 py-1 text-xs bg-cyan-900/50 hover:bg-cyan-800/70 border border-cyan-700 rounded text-cyan-300"
          >
            DIY Moving Head
          </button>
        </div>
      </div>

      {showMovingHead && <HardwareMovingHead onClose={() => setShowMovingHead(false)} />}
    </div>
  );
}
