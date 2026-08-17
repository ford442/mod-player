import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRemoteSongs, isTrackerLibrarySong } from '../utils/storageApi';
import { inferFileNameFromUrl } from '../utils/remoteMedia';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('isTrackerLibrarySong', () => {
  it('accepts tracker extensions and the mods download proxy', () => {
    expect(isTrackerLibrarySong({
      id: 'a', fileName: 'tune.xm', title: 't', artist: '', downloadUrl: 'https://storage.noahcohn.com/files/mods/tune.xm',
    })).toBe(true);
    expect(isTrackerLibrarySong({
      id: 'b', fileName: 'download', title: 't', artist: '', downloadUrl: 'https://storage.noahcohn.com/api/mods/bb_watch/download',
    })).toBe(true);
  });

  it('rejects flac_player audio entries', () => {
    expect(isTrackerLibrarySong({
      id: 'c',
      fileName: '9fcae3b5_song.flac',
      title: 'Sweet Chariot',
      artist: '',
      downloadUrl: 'https://storage.noahcohn.com/files/audio/music/9fcae3b5_song.flac',
    })).toBe(false);
  });
});

describe('inferFileNameFromUrl', () => {
  it('uses the module filename from a static mods URL', () => {
    expect(inferFileNameFromUrl('https://storage.noahcohn.com/files/mods/achmed.xm')).toBe('achmed.xm');
  });

  it('does not treat /download as the filename', () => {
    expect(inferFileNameFromUrl('https://storage.noahcohn.com/api/mods/achmed/download')).toBe('achmed.mod');
  });
});

describe('fetchRemoteSongs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads /api/mods and ignores the FLAC /api/songs catalog', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/mods')) {
        return jsonResponse([
          {
            id: 'achmed',
            filename: 'achmed.xm',
            fileName: 'achmed.xm',
            title: 'Achmed the turk',
            downloadUrl: 'https://storage.noahcohn.com/api/mods/achmed/download',
          },
        ]);
      }
      if (url.includes('/api/songs') && !url.includes('type=mod')) {
        return jsonResponse([
          {
            id: '9fcae3b5',
            filename: '9fcae3b5_song.flac',
            title: 'Sweet Chariot',
            url: 'https://storage.noahcohn.com/files/audio/music/9fcae3b5_song.flac',
          },
        ]);
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const songs = await fetchRemoteSongs();
    expect(songs).toHaveLength(1);
    expect(songs[0]?.fileName).toBe('achmed.xm');
    expect(songs[0]?.downloadUrl).toContain('/api/mods/achmed/download');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/mods'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => /\/api\/songs(?:\?|$)/.test(String(url)) && !String(url).includes('type=mod'))).toBe(false);
  });

  it('falls back to /api/songs?type=mod when /api/mods is unreachable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/mods')) {
        return jsonResponse({ detail: 'not found' }, 404);
      }
      if (url.includes('/api/songs?type=mod') || url.includes('type=mod')) {
        return jsonResponse([
          {
            id: 'bb_watch',
            filename: 'BB_WATCH.XM',
            title: 'Watching You',
            url: 'https://storage.noahcohn.com/api/mods/bb_watch/download',
          },
        ]);
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const songs = await fetchRemoteSongs();
    expect(songs).toHaveLength(1);
    expect(songs[0]?.fileName).toBe('BB_WATCH.XM');
    expect(isTrackerLibrarySong(songs[0]!)).toBe(true);
  });

  it('drops leftover FLAC rows if a fallback list is mixed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/mods')) {
        return jsonResponse({ detail: 'not found' }, 404);
      }
      return jsonResponse([
        {
          id: 'flac',
          filename: 'track.flac',
          url: 'https://storage.noahcohn.com/files/audio/music/track.flac',
        },
        {
          id: 'mod',
          filename: 'tune.it',
          url: 'https://storage.noahcohn.com/api/mods/tune/download',
        },
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const songs = await fetchRemoteSongs();
    expect(songs.map((s) => s.fileName)).toEqual(['tune.it']);
  });
});
