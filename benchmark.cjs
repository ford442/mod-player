const count = 10000;
const media = Array.from({ length: count }, (_, i) => ({
  id: `id-${i}`,
  kind: 'image',
  url: `url-${i}`,
  fileName: `file-${i}`,
  mimeType: 'image/png'
}));

const searchId = `id-${count - 1}`;

console.log(`Benchmarking with ${count} items...`);

console.time('Array.find');
for (let i = 0; i < 10000; i++) {
  media.find(m => m.id === searchId);
}
console.timeEnd('Array.find');

const mediaMap = new Map(media.map(m => [m.id, m]));
console.time('Map.get');
for (let i = 0; i < 10000; i++) {
  mediaMap.get(searchId);
}
console.timeEnd('Map.get');
