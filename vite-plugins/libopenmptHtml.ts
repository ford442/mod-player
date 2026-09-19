import type { Plugin } from 'vite';
import {
  LIBOPENMPT_ASSET_VERSION,
  LIBOPENMPT_DIR,
  LIBOPENMPT_GLUE_FILE,
  LIBOPENMPT_JS_INTEGRITY,
} from '../utils/libopenmptAssets';

const PLACEHOLDER_START = '<!-- LIBOPENMPT_SCRIPT -->';
const PLACEHOLDER_END = '<!-- /LIBOPENMPT_SCRIPT -->';

function normalizeTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Injects the real-WASM libopenmpt glue <script> into index.html with a BASE_URL-aware src, SRI,
 * and a content-hash ?v= (same value the worker / worklet loaders use).
 *
 * The glue fetches its sibling .wasm through Module.locateFile; the tiny inline hook below
 * appends the same ?v= so a cached old .wasm can never be paired with a new glue.
 */
export function libopenmptHtmlPlugin(base: string): Plugin {
  const siteBase = normalizeTrailingSlash(base || '/');
  const jsUrl = `${siteBase}${LIBOPENMPT_DIR}/${LIBOPENMPT_GLUE_FILE}?v=${LIBOPENMPT_ASSET_VERSION}`;

  return {
    name: 'libopenmpt-html',
    transformIndexHtml(html) {
      const locateHook =
        `<script>\n` +
        `    // Version the sibling .wasm exactly like the glue (see utils/libopenmptAssets.ts).\n` +
        `    window.libopenmpt.locateFile = function (p, dir) { return dir + p + '?v=${LIBOPENMPT_ASSET_VERSION}'; };\n` +
        `  </script>`;
      const scriptTag =
        `${locateHook}\n` +
        `  <script charset="utf-8" src="${jsUrl}" integrity="${LIBOPENMPT_JS_INTEGRITY}" crossorigin="anonymous"\n` +
        `    onerror="window._libopenmptReject && window._libopenmptReject(new Error('Failed to load libopenmpt script'))"></script>`;

      const placeholderRe = new RegExp(
        `${PLACEHOLDER_START}[\\s\\S]*?${PLACEHOLDER_END}`,
      );
      if (!placeholderRe.test(html)) {
        throw new Error(
          'index.html is missing LIBOPENMPT_SCRIPT placeholder for libopenmptHtml plugin',
        );
      }

      return html.replace(placeholderRe, scriptTag);
    },
  };
}
