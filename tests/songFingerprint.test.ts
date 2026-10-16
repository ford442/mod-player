/** Song fingerprints for per-song FX presets (#453). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeModuleHash } from '../appConfig';
import { computeSongFingerprint, fnv1a64 } from '../utils/songFingerprint';
import { getSongFingerprint, publishSongBytes, subscribeSongFingerprint } from '../utils/songIdentity';

const xm = (title: string, body: number) => {
  const bytes = new Uint8Array(400).fill(body);
  bytes.set(new TextEncoder().encode(`Extended Module: ${title}`), 0);
  return bytes;
};

describe('computeSongFingerprint (#453)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is SHA-256 of the whole file (known vector)', async () => {
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(await computeSongFingerprint(new TextEncoder().encode('abc'))).toBe('sha256:ba7816bf8f01cfea414140de5dae2223');
  });

  it('tells XM files apart where the 16-byte header hash cannot', async () => {
    const a = xm('Song A', 1);
    const b = xm('Song B', 2);
    expect(computeModuleHash(a)).toBe(computeModuleHash(b)); // the old collision
    expect(await computeSongFingerprint(a)).not.toBe(await computeSongFingerprint(b));
  });

  it('falls back to FNV-1a 64 without subtle crypto (plain-http hosts)', async () => {
    vi.stubGlobal('crypto', {});
    const fp = await computeSongFingerprint(xm('x', 3));
    expect(fp).toBe(`fnv64:${fnv1a64(xm('x', 3))}`);
    expect(fp).toMatch(/^fnv64:[0-9a-f]{16}$/);
    expect(fnv1a64(xm('x', 3))).not.toBe(fnv1a64(xm('x', 4)));
  });
});

describe('songIdentity (#453)', () => {
  it('clears at once on a new load and publishes only the latest file', async () => {
    const seen: (string | null)[] = [];
    const unsubscribe = subscribeSongFingerprint((fp) => seen.push(fp));
    const first = publishSongBytes(xm('first', 1));
    const second = publishSongBytes(xm('second', 2));
    await Promise.all([first, second]);
    unsubscribe();
    const expected = await computeSongFingerprint(xm('second', 2));
    expect(getSongFingerprint()).toBe(expected);
    expect(seen.filter((fp) => fp !== null)).toEqual([expected]); // the first hash never landed
  });
});
