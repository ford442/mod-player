import type React from 'react';
import { PlayerFeaturesContext, type PlayerFeaturesValue } from './playerFeatures';

export type { PlayerFeaturesValue } from './playerFeatures';

/** Provider only — the value type, context object and `usePlayerFeatures` live in ./playerFeatures (fast refresh). */
export function PlayerFeaturesProvider({
  value,
  children,
}: {
  value: PlayerFeaturesValue;
  children: React.ReactNode;
}) {
  return <PlayerFeaturesContext.Provider value={value}>{children}</PlayerFeaturesContext.Provider>;
}
