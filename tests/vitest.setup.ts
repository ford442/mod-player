/** Minimal browser globals for unit tests that transitively import appConfig. */
const testLocation = {
  href: 'https://player.example.com/xm-player/',
  origin: 'https://player.example.com',
  search: '',
  pathname: '/xm-player/',
};

Object.defineProperty(globalThis, 'window', {
  value: { location: testLocation },
  writable: true,
  configurable: true,
});
