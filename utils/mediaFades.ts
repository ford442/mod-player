/** Media overlay fade-in / fade-out times (ms), persisted per browser. */
export interface MediaFades {
  in: number;
  out: number;
}

export const MEDIA_FADES_STORAGE_KEY = 'xasm1_media_fades';
export const DEFAULT_MEDIA_FADES: MediaFades = { in: 500, out: 500 };
