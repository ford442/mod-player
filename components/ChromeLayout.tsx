import { Header } from './Header';
import { GlobalControlsBar } from './GlobalControlsBar';
import { PerformanceStage } from './PerformanceStage';
import { TransportBar } from './TransportBar';
import { SidePanelGrid } from './SidePanelGrid';
import { PatternEditorSection } from './PatternEditorSection';
import { LibraryAndPlaylistSection } from './LibraryAndPlaylistSection';
import { usePlayerSession } from '../context/PlayerSessionContext';

/** The full "normal" (non-stage-mode) page: header, toolbars, stage, transport, panels, library. */
export function ChromeLayout() {
  const { status, isModuleLoaded } = usePlayerSession();

  return (
    <div className="w-full max-w-[1280px]">
      <Header status={status} isModuleLoaded={isModuleLoaded} />

      <GlobalControlsBar />

      {/* Main Display Area */}
      <PerformanceStage />

      <TransportBar />

      <SidePanelGrid />

      <PatternEditorSection />

      <LibraryAndPlaylistSection />

      <div className="mt-8 text-center text-xs opacity-50">
        <p>Supports .mod, .xm, .s3m, .it files.</p>
        <p>WebGPU required for visualization.</p>
      </div>
    </div>
  );
}
