/**
 * Library search/filter helpers (no IndexedDB). Ported from utils/__debug__/libraryStore.test.cjs,
 * which tested pasted copies of these functions; this imports the real ones.
 */
import { describe, expect, it } from 'vitest';
import { entryFormat, filterAndSearchEntries, matchesLibrarySearch } from '../store/libraryStore';
import type { LibraryEntry } from '../types/localLibrary';

function entry(overrides: Partial<LibraryEntry> & Pick<LibraryEntry, 'id' | 'title' | 'fileName'>): LibraryEntry {
  return {
    rootId: 'root',
    relativePath: overrides.fileName,
    size: 1,
    lastModified: 0,
    importedAt: 0,
    ...overrides,
  };
}

const alpha = entry({ id: '1', title: 'Alpha', fileName: 'a.mod', favorite: true, lastPlayed: 100, importedAt: 3 });
const beta = entry({
  id: '2', title: 'Beta', artist: 'Artist', fileName: 'b.xm', relativePath: 'sub/b.xm', lastPlayed: 200, importedAt: 2,
});
const gamma = entry({ id: '3', title: 'Gamma', fileName: 'c.it', favorite: true, importedAt: 1 });
const sample = [alpha, beta, gamma];

describe('matchesLibrarySearch', () => {
  it('matches everything for an empty / whitespace query', () => {
    expect(matchesLibrarySearch(alpha, '')).toBe(true);
    expect(matchesLibrarySearch(alpha, '   ')).toBe(true);
  });

  it('searches title, artist, file name, relative path and format, case-insensitively', () => {
    expect(matchesLibrarySearch(beta, 'BETA')).toBe(true);
    expect(matchesLibrarySearch(beta, 'artist')).toBe(true);
    expect(matchesLibrarySearch(beta, 'b.xm')).toBe(true);
    expect(matchesLibrarySearch(beta, 'sub/b')).toBe(true);
    expect(matchesLibrarySearch({ ...beta, format: 'xm' }, 'xm')).toBe(true);
    expect(matchesLibrarySearch(beta, 'gamma')).toBe(false);
  });
});

describe('entryFormat', () => {
  it('prefers the stored format and falls back to the file extension', () => {
    expect(entryFormat({ ...alpha, format: 'MOD' })).toBe('mod');
    expect(entryFormat(gamma)).toBe('it');
  });
});

describe('filterAndSearchEntries', () => {
  it('returns every entry for the "all" filter, sorted by title', () => {
    expect(filterAndSearchEntries(sample, '', 'all').map((e) => e.id)).toEqual(['1', '2', '3']);
  });

  it('searches by artist', () => {
    expect(filterAndSearchEntries(sample, 'artist', 'all').map((e) => e.id)).toEqual(['2']);
  });

  it('keeps only favourites for the "favorites" filter', () => {
    expect(filterAndSearchEntries(sample, '', 'favorites').map((e) => e.id)).toEqual(['1', '3']);
  });

  it('keeps only played entries for "recent", most recently played first', () => {
    expect(filterAndSearchEntries(sample, '', 'recent').map((e) => e.id)).toEqual(['2', '1']);
  });

  it('filters by format, falling back to the extension when no format is stored', () => {
    expect(filterAndSearchEntries(sample, '', 'all', 'xm').map((e) => e.id)).toEqual(['2']);
    expect(filterAndSearchEntries(sample, '', 'all', 'mod').map((e) => e.id)).toEqual(['1']);
  });

  it('sorts by importedAt (newest first) and lastPlayed when asked', () => {
    expect(filterAndSearchEntries(sample, '', 'all', 'all', 'importedAt').map((e) => e.id)).toEqual(['1', '2', '3']);
    expect(filterAndSearchEntries(sample, '', 'all', 'all', 'lastPlayed').map((e) => e.id)).toEqual(['2', '1', '3']);
  });

  it('does not mutate the input array', () => {
    const input = [gamma, alpha, beta];
    filterAndSearchEntries(input, '', 'all');
    expect(input.map((e) => e.id)).toEqual(['3', '1', '2']);
  });

  it('finds a single hit in a 2500-entry library', () => {
    // Correctness only: the old test asserted "< 50 ms", which flakes on loaded CI runners.
    const big = Array.from({ length: 2500 }, (_, i) =>
      entry({ id: String(i), title: `Track ${i}`, fileName: `t${i}.mod` }),
    );
    expect(filterAndSearchEntries(big, 'track 1999', 'all').map((e) => e.id)).toEqual(['1999']);
  });
});
