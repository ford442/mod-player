import { Header } from './Header';
import { GlobalControlsBar } from './GlobalControlsBar';
import { PerformanceStage } from './PerformanceStage';
import { TransportBar } from './TransportBar';
import { SidePanelGrid } from './SidePanelGrid';
import { PatternEditorSection } from './PatternEditorSection';
import { LibraryAndPlaylistSection } from './LibraryAndPlaylistSection';
import { usePlayerSession } from '../context/PlayerSessionContext';
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
  const { status, isModuleLoaded } = usePlayerSession();
  const { stageMode } = usePlayerUiStore();

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
          <p>Supports .mod, .xm, .s3m, .it files.</p>
          <p>WebGPU required for visualization.</p>
        </div>
      </div>
    </div>
  );
}
