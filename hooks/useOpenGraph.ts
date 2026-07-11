import { useEffect } from 'react';

const DEFAULT_TITLE = 'MOD Player Pro';
const DEFAULT_DESCRIPTION = 'Browser-based tracker module player with WebGPU visualizations';

function upsertMeta(property: string, content: string, attr: 'property' | 'name' = 'property') {
  let el = document.querySelector(`meta[${attr}="${property}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, property);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

export interface OpenGraphState {
  title?: string;
  description?: string;
  url?: string;
  image?: string;
}

/** Update document title + Open Graph tags for social previews. */
export function useOpenGraph({ title, description, url, image }: OpenGraphState) {
  useEffect(() => {
    const pageTitle = title?.trim() || DEFAULT_TITLE;
    document.title = pageTitle;
    upsertMeta('og:title', pageTitle);
    upsertMeta('twitter:title', pageTitle, 'name');

    const desc = description?.trim() || DEFAULT_DESCRIPTION;
    upsertMeta('og:description', desc);
    upsertMeta('description', desc, 'name');
    upsertMeta('twitter:description', desc, 'name');

    if (url) {
      upsertMeta('og:url', url);
    }
    if (image) {
      upsertMeta('og:image', image);
      upsertMeta('twitter:image', image, 'name');
      upsertMeta('twitter:card', 'summary_large_image', 'name');
    } else {
      upsertMeta('twitter:card', 'summary', 'name');
    }

    upsertMeta('og:type', 'website');
  }, [title, description, url, image]);
}
