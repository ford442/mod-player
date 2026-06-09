import type { CurrentPatternRenderer } from './types';

declare global {
  interface Window {
    currentPatternRenderer: CurrentPatternRenderer | null;
  }
}

export function setCurrentPatternRenderer(handle: CurrentPatternRenderer | null): void {
  if (typeof window !== 'undefined') {
    window.currentPatternRenderer = handle;
  }
}
