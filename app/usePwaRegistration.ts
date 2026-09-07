import { useEffect } from 'react';

/** Register PWA service worker (production builds only). */
export function usePwaRegistration(): void {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Only register in production builds
    if (!import.meta.env.PROD) return;

    // Detect actual base path from current location for subdirectory deployments
    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    const detectedBase = pathSegments.length > 0 ? `/${pathSegments[0]}/` : '/';
    const baseUrl = import.meta.env.BASE_URL !== '/' ? import.meta.env.BASE_URL : detectedBase;

    // Ensure consistent trailing slash for URL construction
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const swUrl = `${normalizedBase}sw.js`;
    const scope = normalizedBase;

    navigator.serviceWorker.register(swUrl, { scope }).catch((err) => {
      console.error('[PWA] Service Worker registration failed:', err, `(url: ${swUrl})`);
    });
  }, []);
}
