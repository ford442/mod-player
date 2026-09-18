import { KeyboardShortcutHelp } from './KeyboardShortcutHelp';
import { ChromeLayout } from './ChromeLayout';
import { cn } from '../utils/cn';
import { usePlayerUiStore } from '../store/playerUiStore';

export interface MainLayoutProps {
  /**
   * DOM node inside the R3F 3D studio's pattern-display panel, when 3D mode
   * is open. Threaded down to PerformanceStage, which teleports its live
   * PatternDisplay into this node instead of 3D mode constructing a second
   * instance (and a second WebGPU device) — see Problem A.
   */
  studioDisplayHost?: HTMLDivElement | null;
}

export function MainLayout({ studioDisplayHost }: MainLayoutProps = {}) {
  const { stageMode, cheatsheetOpen, setCheatsheetOpen } = usePlayerUiStore();

  return (
    <div
      data-stage-mode={stageMode ? 'on' : 'off'}
      className={cn(
        'text-[var(--text-primary)] transition-colors duration-300',
        stageMode && 'w-screen h-screen bg-black overflow-hidden',
        !stageMode && 'min-h-screen bg-panel-base p-4 flex flex-col items-center',
      )}
    >
      <ChromeLayout studioDisplayHost={studioDisplayHost ?? null} />
      {cheatsheetOpen && <KeyboardShortcutHelp onClose={() => setCheatsheetOpen(false)} />}
    </div>
  );
}
