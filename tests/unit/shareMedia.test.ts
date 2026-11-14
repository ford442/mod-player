/**
 * Shared media overlay URLs: a local file's blob: URL never leaves the tab (og:url, copied link,
 * share-code POST), and a share code's stored media goes through the same host allowlist as
 * ?media= (it used to be trusted as any zod `.url()`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveShareCode, shareableMediaUrl, validateShareMediaUrl } from '../../utils/shareState';
import { createLocalMediaItem } from '../../app/useAppMedia';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validateShareMediaUrl', () => {
  it('accepts an allowed host', () => {
    const result = validateShareMediaUrl('https://storage.noahcohn.com/media/clouds.mp4');
    expect(result).toEqual({ ok: true, url: 'https://storage.noahcohn.com/media/clouds.mp4' });
  });

  it('rejects other hosts, schemes and credentials', () => {
    expect(validateShareMediaUrl('https://evil.example/x.mp4').ok).toBe(false);
    expect(validateShareMediaUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateShareMediaUrl('blob:https://player.example.com/1234').ok).toBe(false);
    expect(validateShareMediaUrl('https://user:pw@storage.noahcohn.com/x.mp4').ok).toBe(false);
  });
});

describe('shareableMediaUrl', () => {
  it('drops object URLs and blob/data URLs', () => {
    expect(shareableMediaUrl(null)).toBeUndefined();
    expect(shareableMediaUrl({ url: 'blob:https://a/1', isObjectUrl: true })).toBeUndefined();
    // Even an item that lost its flag never shares a blob: or data: URL.
    expect(shareableMediaUrl({ url: 'blob:https://a/1' })).toBeUndefined();
    expect(shareableMediaUrl({ url: 'data:image/png;base64,AAAA' })).toBeUndefined();
    expect(shareableMediaUrl({ url: 'https://storage.noahcohn.com/m.mp4' })).toBe('https://storage.noahcohn.com/m.mp4');
  });
});

describe('createLocalMediaItem', () => {
  it('flags the object URL so it is revoked and never shared', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'id-1' });
    const file = new File([new Uint8Array([1])], 'clip.webm', { type: 'video/webm' });
    const item = createLocalMediaItem(file, () => 'blob:https://player.example.com/abc');
    expect(item.isObjectUrl).toBe(true);
    expect(item.kind).toBe('video');
    expect(shareableMediaUrl(item)).toBeUndefined();
  });
});

describe('resolveShareCode media', () => {
  function stubShareResponse(state: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
  }

  it('drops a media URL on a host outside the allowlist', async () => {
    stubShareResponse({ shader: 'patternv0.57.wgsl', media: 'https://evil.example/track.gif' });
    const state = await resolveShareCode('abcd1234');
    expect(state).not.toBeNull();
    expect(state?.media).toBeUndefined();
    expect(state?.shader).toBe('patternv0.57.wgsl');
  });

  it('reads a bare (unwrapped) state too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ order: 2, media: 'https://evil.example/x.png' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    const state = await resolveShareCode('abcd1234');
    expect(state).toEqual({ order: 2 });
  });

  it('keeps an allowed media URL', async () => {
    stubShareResponse({ media: 'https://storage.noahcohn.com/media/a.mp4' });
    const state = await resolveShareCode('abcd1234');
    expect(state?.media).toBe('https://storage.noahcohn.com/media/a.mp4');
  });
});
