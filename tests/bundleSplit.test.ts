import { describe, expect, it } from 'vitest';
import {
  CROSS_ORIGIN_ISOLATION_HEADERS,
  threeVendorManualChunk,
} from '../vite-plugins/crossOriginIsolationHeaders';

describe('crossOriginIsolationHeaders', () => {
  it('exports COOP same-origin and COEP credentialless', () => {
    expect(CROSS_ORIGIN_ISOLATION_HEADERS['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(CROSS_ORIGIN_ISOLATION_HEADERS['Cross-Origin-Embedder-Policy']).toBe('credentialless');
  });

  it('routes three/R3F/drei into three-r3f vendor chunk', () => {
    expect(threeVendorManualChunk('/workspace/node_modules/three/build/three.module.js')).toBe('three-r3f');
    expect(threeVendorManualChunk('/workspace/node_modules/@react-three/fiber/dist/index.js')).toBe('three-r3f');
    expect(threeVendorManualChunk('/workspace/node_modules/@react-three/drei/index.js')).toBe('three-r3f');
    expect(threeVendorManualChunk('/workspace/components/App.tsx')).toBeUndefined();
  });
});
