import { describe, expect, it } from 'vitest';
import {
  CROSS_ORIGIN_ISOLATION_HEADERS,
  vendorManualChunk,
} from '../vite-plugins/crossOriginIsolationHeaders';

describe('crossOriginIsolationHeaders', () => {
  it('exports COOP same-origin and COEP credentialless', () => {
    expect(CROSS_ORIGIN_ISOLATION_HEADERS['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(CROSS_ORIGIN_ISOLATION_HEADERS['Cross-Origin-Embedder-Policy']).toBe('credentialless');
  });

  it('routes three/R3F/drei into three-r3f vendor chunk', () => {
    expect(vendorManualChunk('/workspace/node_modules/three/build/three.module.js')).toBe('three-r3f');
    expect(vendorManualChunk('/workspace/node_modules/@react-three/fiber/dist/index.js')).toBe('three-r3f');
    expect(vendorManualChunk('/workspace/node_modules/@react-three/drei/index.js')).toBe('three-r3f');
    expect(vendorManualChunk('/workspace/node_modules/three-stdlib/index.js')).toBe('three-r3f');
    expect(vendorManualChunk('/workspace/node_modules/three-mesh-bvh/src/index.js')).toBe('three-r3f');
    expect(vendorManualChunk('/workspace/components/App.tsx')).toBeUndefined();
  });
});

describe('react-vendor chunk (keeps three-r3f off the initial page load)', () => {
  const nm = '/workspace/node_modules';

  it('routes the top-level React stack and zustand into react-vendor', () => {
    expect(vendorManualChunk(`${nm}/react/index.js`)).toBe('react-vendor');
    expect(vendorManualChunk(`${nm}/react/jsx-runtime.js`)).toBe('react-vendor');
    expect(vendorManualChunk(`${nm}/react-dom/client.js`)).toBe('react-vendor');
    expect(vendorManualChunk(`${nm}/zustand/esm/react.mjs`)).toBe('react-vendor');
  });

  it("includes react-dom's own nested scheduler", () => {
    expect(vendorManualChunk(`${nm}/react-dom/node_modules/scheduler/index.js`)).toBe('react-vendor');
  });

  it('includes the @rollup/plugin-commonjs virtual modules of those packages', () => {
    expect(vendorManualChunk(`\0${nm}/react/index.js?commonjs-proxy`)).toBe('react-vendor');
    expect(vendorManualChunk(`\0${nm}/react-dom/index.js?commonjs-module`)).toBe('react-vendor');
  });

  it('includes the Vite preload helper and commonjs helpers both sides import', () => {
    expect(vendorManualChunk('\0vite/preload-helper.js')).toBe('react-vendor');
    expect(vendorManualChunk('\0commonjsHelpers.js')).toBe('react-vendor');
  });

  it('does not treat look-alike or three-only packages as react-vendor', () => {
    // react-reconciler / react-use-measure start with "react" but are r3f internals.
    expect(vendorManualChunk(`${nm}/react-reconciler/cjs/react-reconciler.production.min.js`)).toBeUndefined();
    expect(vendorManualChunk(`${nm}/react-use-measure/dist/web.js`)).toBeUndefined();
    // Root scheduler is the 0.21 copy only react-reconciler uses.
    expect(vendorManualChunk(`${nm}/scheduler/index.js`)).toBeUndefined();
    // Nested zustand@3 copies belong to their three-side owners.
    expect(vendorManualChunk(`${nm}/@react-three/fiber/node_modules/zustand/index.js`)).toBe('three-r3f');
    expect(vendorManualChunk(`${nm}/tunnel-rat/node_modules/zustand/index.js`)).toBeUndefined();
    // Other app dependencies stay in the entry chunk.
    expect(vendorManualChunk(`${nm}/zod/lib/index.mjs`)).toBeUndefined();
    expect(vendorManualChunk('/workspace/store/playerUiStore.ts')).toBeUndefined();
  });
});
