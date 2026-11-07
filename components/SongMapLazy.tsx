/** Lazy song map (#537): its chunk loads when the map first renders. */
import { lazy, Suspense } from 'react';

const SongMap = lazy(() => import('./SongMap').then((m) => ({ default: m.SongMap })));

export function SongMapLazy() {
  return (
    <Suspense fallback={<div className="h-6 rounded bg-panel-inset" aria-hidden="true" />}>
      <SongMap />
    </Suspense>
  );
}
