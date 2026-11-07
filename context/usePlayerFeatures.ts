import { createContext, useContext } from 'react';
import type { PlayerFeaturesValue } from './PlayerFeaturesContext';

// Kept out of PlayerFeaturesContext.tsx so that file exports only a component (react-refresh).
export const PlayerFeaturesContext = createContext<PlayerFeaturesValue | null>(null);

export function usePlayerFeatures(): PlayerFeaturesValue {
  const ctx = useContext(PlayerFeaturesContext);
  if (!ctx) {
    throw new Error('usePlayerFeatures must be used within PlayerFeaturesProvider');
  }
  return ctx;
}
