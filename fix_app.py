import re

# Fix App.tsx - add SW logging
with open('App.tsx', 'r') as f:
    content = f.read()

old_sw = '''// Register PWA service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const swUrl = `${import.meta.env.BASE_URL}sw.js`;
      const scope = import.meta.env.BASE_URL || '/';
      navigator.serviceWorker.register(swUrl, { scope }).catch((err) => {
        console.warn('[PWA] Service worker registration failed:', err);
      });
    }
  }, []);'''

new_sw = '''// Register PWA service worker
  useEffect(() => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      const swUrl = `${import.meta.env.BASE_URL}sw.js`;
      const scope = import.meta.env.BASE_URL || '/';
      console.log('[PWA] Registering service worker:', { swUrl, scope });
      navigator.serviceWorker.register(swUrl, { scope }).then((reg) => {
        console.log('[PWA] Service worker registered:', reg.scope);
      }).catch((err) => {
        console.warn('[PWA] Service worker registration failed:', err);
      });
    } else {
      console.log('[PWA] Skipping SW registration (dev mode or not supported)');
    }
  }, []);'''

if old_sw in content:
    content = content.replace(old_sw, new_sw)
    print("✅ Fixed App.tsx SW registration")
else:
    print("⚠️ App.tsx pattern not found")

with open('App.tsx', 'w') as f:
    f.write(content)

print("Done with App.tsx")
