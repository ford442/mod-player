import type { Plugin } from 'vite';
import {
  LIBOPENMPT_DIR,
  LIBOPENMPT_JS_INTEGRITY,
} from '../utils/libopenmptAssets';

const PLACEHOLDER_START = '<!-- LIBOPENMPT_SCRIPT -->';
const PLACEHOLDER_END = '<!-- /LIBOPENMPT_SCRIPT -->';

function normalizeTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function resolveLibOpenMPTJsUrl(base: string, cdnOverride?: string): string {
  const override = (cdnOverride ?? '').trim();
  if (override) {
    return `${normalizeTrailingSlash(override)}libopenmptjs.js`;
  }
  const siteBase = normalizeTrailingSlash(base || '/');
  return `${siteBase}${LIBOPENMPT_DIR}/libopenmptjs.js`;
}

/**
 * Injects the libopenmpt script tag into index.html with BASE_URL-aware src
 * and optional SRI for self-hosted assets.
 */
export function libopenmptHtmlPlugin(base: string, cdnOverride?: string): Plugin {
  const jsUrl = resolveLibOpenMPTJsUrl(base, cdnOverride);
  const useCdn = Boolean((cdnOverride ?? '').trim());
  const integrityAttr = useCdn
    ? ''
    : ` integrity="${LIBOPENMPT_JS_INTEGRITY}" crossorigin="anonymous"`;

  return {
    name: 'libopenmpt-html',
    transformIndexHtml(html) {
      const scriptTag =
        `<script charset="utf-8" src="${jsUrl}"${integrityAttr}\n` +
        `    onerror="window._libopenmptReject && window._libopenmptReject(new Error('Failed to load libopenmpt script'))"></script>`;

      const placeholderRe = new RegExp(
        `${PLACEHOLDER_START}[\\s\\S]*?${PLACEHOLDER_END}`,
      );
      if (!placeholderRe.test(html)) {
        throw new Error(
          'index.html is missing LIBOPENMPT_SCRIPT placeholder for libopenmptHtml plugin',
        );
      }

      let next = html.replace(placeholderRe, scriptTag);

      if (useCdn) {
        if (!next.includes('wasm.noahcohn.com')) {
          next = next.replace(
            '<link rel="preconnect" href="https://esm.sh" crossorigin>',
            '<link rel="preconnect" href="https://wasm.noahcohn.com" crossorigin>\n  <link rel="preconnect" href="https://esm.sh" crossorigin>',
          );
        }
      } else {
        next = next.replace(
          /\s*<link rel="preconnect" href="https:\/\/wasm\.noahcohn\.com" crossorigin>\n?/,
          '',
        );
      }

      return next;
    },
  };
}
