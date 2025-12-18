import type { MediaItem } from '../types';

// Adjust this path to match where you drop your files on the FTP
const REMOTE_MEDIA_BASE_URL = './media/'; 

export const fetchRemoteMedia = async (): Promise<MediaItem[]> => {
  try {
    const response = await fetch(REMOTE_MEDIA_BASE_URL);
    if (!response.ok) throw new Error('Failed to access media folder');
    
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    
    // Scrape all links from the auto-generated index page
    const links = Array.from(doc.querySelectorAll('a'))
      .map(a => a.getAttribute('href'))
      .filter((href): href is string => !!href)
      // Filter for common media extensions
      .filter(href => /\.(mp4|webm|mkv|mov|gif|png|jpg|jpeg)$/i.test(href));

    // Convert to MediaItem objects
    return links.map(filename => {
      // Handle Nginx/Apache differences where href might include the path
      const cleanName = filename.split('/').pop() || filename;
      const isVideo = /\.(mp4|webm|mkv|mov)$/i.test(cleanName);
      const isGif = /\.gif$/i.test(cleanName);
      
      return {
        id: `remote-${cleanName}`,
        url: `${REMOTE_MEDIA_BASE_URL}${cleanName}`, // Construct full URL
        fileName: decodeURIComponent(cleanName),
        kind: isVideo ? 'video' : (isGif ? 'gif' : 'image'),
        mimeType: isVideo ? 'video/mp4' : 'image/jpeg', // Approximation
        muted: true,
        loop: isGif,
        fit: 'contain',
        isObjectUrl: false
      };
    });
  } catch (e) {
    console.error("Could not fetch remote media:", e);
    return [];
  }
};
