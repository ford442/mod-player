/** Lazy FX rack panel (#453): its chunk loads when the panel first renders. */
import { lazy, Suspense } from 'react';

const FxRackPanel = lazy(() => import('./FxRackPanel').then((m) => ({ default: m.FxRackPanel })));

export function FxRackPanelLazy() {
  return (
    <Suspense
      fallback={
        <div className="h-48 animate-pulse rounded-lg bg-panel-inset" role="status" aria-label="Loading FX rack" />
      }
    >
      <FxRackPanel />
    </Suspense>
  );
}
