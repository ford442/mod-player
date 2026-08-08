import { useEffect } from 'react';

/** Register PWA service worker (production builds only). */
export function usePwaRegistration(): void {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      console.log('[PWA] Service Worker not supported in this browser');
      return;
    }

    // Only register in production builds
    if (!import.meta.env.PROD) {
      console.log('[PWA] Skipping SW registration (development mode)');
      return;
    }

    // Detect actual base path from current location for subdirectory deployments
    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    const detectedBase = pathSegments.length > 0 ? `/${pathSegments[0]}/` : '/';
    const baseUrl = import.meta.env.BASE_URL !== '/' ? import.meta.env.BASE_URL : detectedBase;

    // Ensure consistent trailing slash for URL construction
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const swUrl = `${normalizedBase}sw.js`;
    const scope = normalizedBase;

    console.log('[PWA] ==================================================');
    console.log('[PWA] Registering Service Worker...');
    console.log('[PWA] Service Worker URL:', swUrl);
    console.log('[PWA] Scope:', scope);
    console.log('[PWA] BASE_URL (env):', import.meta.env.BASE_URL);
    console.log('[PWA] Detected base:', detectedBase);
    console.log('[PWA] ==================================================');

    navigator.serviceWorker.register(swUrl, { scope }).then((reg) => {
      console.log('[PWA] ✅ Service Worker registered successfully');
      console.log('[PWA] Scope:', reg.scope);
      console.log('[PWA] State:', reg.installing ? 'installing' : reg.waiting ? 'waiting' : 'active');
    }).catch((err) => {
      console.error('[PWA] ❌ Service Worker registration failed:', err);
      console.error('[PWA] Failed URL:', swUrl);
      console.error('[PWA] This usually means sw.js is missing from the build output');
    });
  }, []);
}
