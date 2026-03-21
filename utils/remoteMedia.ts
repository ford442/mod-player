import type { MediaItem } from '../types';

// Adjust this path to match where you drop your files on the FTP
const REMOTE_MEDIA_BASE_URL = `${import.meta.env.BASE_URL}media/`;

export const fetchRemoteMedia = async (): Promise<MediaItem[]> => {
  try {
    const response = await fetch(REMOTE_MEDIA_BASE_URL);
    if (!response.ok) throw new Error('Failed to access media folder');
    
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    
    const mediaItems: MediaItem[] = [];
    const mediaRegex = /\.(mp4|webm|mkv|mov|gif|png|jpg|jpeg)$/i;
    const videoRegex = /\.(mp4|webm|mkv|mov)$/i;
    const gifRegex = /\.gif$/i;

    const anchors = doc.querySelectorAll('a');
    for (const a of anchors) {
      const href = a.getAttribute('href');
      
      if (href && mediaRegex.test(href)) {
        // Handle Nginx/Apache differences where href might include the path
        const cleanName = href.split('/').pop() || href;
        const isVideo = videoRegex.test(cleanName);
        const isGif = gifRegex.test(cleanName);

        mediaItems.push({
          id: `remote-${cleanName}`,
          url: `${REMOTE_MEDIA_BASE_URL}${cleanName}`, // Construct full URL
          fileName: decodeURIComponent(cleanName),
          kind: isVideo ? 'video' : (isGif ? 'gif' : 'image'),
          mimeType: isVideo ? 'video/mp4' : 'image/jpeg', // Approximation
          muted: true,
          loop: isGif,
          fit: 'contain',
          isObjectUrl: false
        });
      }
    }

    return mediaItems;
  } catch (e) {
    console.error("Could not fetch remote media:", e);
    return [];
  }
};
