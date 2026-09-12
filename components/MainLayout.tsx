import { KeyboardShortcutHelp } from './KeyboardShortcutHelp';
import { ChromeLayout } from './ChromeLayout';
import { cn } from '../utils/cn';
import { usePlayerUiStore } from '../store/playerUiStore';

export function MainLayout() {
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
      <ChromeLayout />
      {cheatsheetOpen && <KeyboardShortcutHelp onClose={() => setCheatsheetOpen(false)} />}
    </div>
  );
}
