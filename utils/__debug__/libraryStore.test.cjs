/**
 * Node smoke test for library search/filter helpers (no IndexedDB).
 * Run: node utils/__debug__/libraryStore.test.cjs
 */

function matchesLibrarySearch(entry, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    entry.title.toLowerCase().includes(q) ||
    (entry.artist?.toLowerCase().includes(q) ?? false) ||
    entry.fileName.toLowerCase().includes(q) ||
    entry.relativePath.toLowerCase().includes(q) ||
    (entry.format?.toLowerCase().includes(q) ?? false)
  );
}

function filterAndSearchEntries(entries, query, filter, formatFilter = 'all', sortBy = 'title') {
  let result = entries;
  if (formatFilter !== 'all') {
    result = result.filter((e) => (e.format ?? e.fileName.split('.').pop() ?? '').toLowerCase() === formatFilter);
  }
  if (filter === 'favorites') result = result.filter((e) => e.favorite === true);
  else if (filter === 'recent') result = result.filter((e) => e.lastPlayed !== undefined);
  if (filter === 'recent' || sortBy === 'lastPlayed') {
    result = [...result].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
  } else if (sortBy === 'importedAt') {
    result = [...result].sort((a, b) => b.importedAt - a.importedAt);
  } else {
    result = [...result].sort((a, b) => a.title.localeCompare(b.title));
  }
  if (!query.trim()) return result;
  return result.filter((e) => matchesLibrarySearch(e, query));
}

const sample = [
  { id: '1', title: 'Alpha', fileName: 'a.mod', relativePath: 'a.mod', favorite: true, lastPlayed: 100 },
  { id: '2', title: 'Beta', artist: 'Artist', fileName: 'b.xm', relativePath: 'sub/b.xm', lastPlayed: 200 },
  { id: '3', title: 'Gamma', fileName: 'c.it', relativePath: 'c.it', favorite: true },
];

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  }
}

assert(filterAndSearchEntries(sample, '', 'all').length === 3, 'all entries');
assert(filterAndSearchEntries(sample, 'artist', 'all').length === 1, 'search artist');
assert(filterAndSearchEntries(sample, '', 'favorites').length === 2, 'favorites filter');
assert(filterAndSearchEntries(sample, '', 'recent')[0].id === '2', 'recent sort');
assert(matchesLibrarySearch(sample[1], 'sub/b'), 'path search');

// Scale: 2500 entries should filter in reasonable time
const big = Array.from({ length: 2500 }, (_, i) => ({
  id: String(i),
  title: `Track ${i}`,
  fileName: `t${i}.mod`,
  relativePath: `t${i}.mod`,
}));
const t0 = performance.now();
const hits = filterAndSearchEntries(big, 'track 1999', 'all');
const elapsed = performance.now() - t0;
assert(hits.length === 1, 'big library search hits');
assert(elapsed < 50, `big library search under 50ms (was ${elapsed.toFixed(1)}ms)`);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('libraryStore search/filter: OK');
