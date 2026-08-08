import { lazy } from 'react';

/** 3D Studio pulls in three/R3F/drei — lazy-loaded so 2D-only users skip that payload. */
export const App3DView = lazy(() =>
  import('../components/App3DView').then((m) => ({ default: m.App3DView })),
);

export function App3DLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-panel text-edge">
      <p className="text-sm tracking-wide">Loading 3D Studio…</p>
    </div>
  );
}
