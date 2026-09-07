import { KeyboardShortcutHelp } from './KeyboardShortcutHelp';
import { ChromeLayout } from './ChromeLayout';
import { PerformanceStage } from './PerformanceStage';
import { cn } from '../utils/cn';
import { usePlayerUiStore } from '../store/playerUiStore';

export function MainLayout() {
  const { stageMode, cheatsheetOpen, setCheatsheetOpen } = usePlayerUiStore();

  return (
    <div
      className={cn(
        'text-[var(--text-primary)] transition-colors duration-300',
        stageMode
          ? 'w-screen h-screen bg-black overflow-hidden'
          : 'min-h-screen bg-panel-base p-4 flex flex-col items-center',
      )}
    >
      {stageMode ? <PerformanceStage /> : <ChromeLayout />}
      {cheatsheetOpen && <KeyboardShortcutHelp onClose={() => setCheatsheetOpen(false)} />}
    </div>
  );
}
