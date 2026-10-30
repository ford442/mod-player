import { describe, expect, it } from 'vitest';
import { mediaCrossOrigin } from '../utils/remoteMedia';

const PAGE = 'https://test.1ink.us/xm-player/?media=x';

describe('mediaCrossOrigin', () => {
  it('leaves blob: and data: URLs alone', () => {
    expect(mediaCrossOrigin('blob:https://test.1ink.us/1234-5678', PAGE)).toBeUndefined();
    expect(mediaCrossOrigin('data:image/png;base64,iVBORw0KGgo=', PAGE)).toBeUndefined();
  });

  it('leaves same-origin URLs alone, relative paths included', () => {
    expect(mediaCrossOrigin('https://test.1ink.us/xm-player/media/a.png', PAGE)).toBeUndefined();
    expect(mediaCrossOrigin('media/a.png', PAGE)).toBeUndefined();
    expect(mediaCrossOrigin('/xm-player/media/a.mp4', PAGE)).toBeUndefined();
  });

  it('requests CORS for cross-origin http(s) URLs', () => {
    expect(mediaCrossOrigin('https://images.example.com/a.jpg', PAGE)).toBe('anonymous');
    expect(mediaCrossOrigin('http://test.1ink.us/xm-player/a.jpg', PAGE)).toBe('anonymous');
    expect(mediaCrossOrigin('https://go.1ink.us/xm-player/a.webm', PAGE)).toBe('anonymous');
  });
});
