/**
 * utils/moduleFormats.generated.ts (and public/sw.js's copy) is exactly what the committed
 * libopenmpt says it loads: openmpt_get_supported_extensions() of public/worklets/libopenmpt-worklet.wasm.
 * A libopenmpt rebuild that adds or drops a format fails here until
 * `node scripts/gen-module-formats.mjs` is re-run (scripts/build-js-libopenmpt.sh does it).
 */
import { describe, expect, it } from 'vitest';
import { normalizeExtensions, staleOutputs } from '../../scripts/gen-module-formats.mjs';
import { LIBOPENMPT_MODULE_EXTENSIONS } from '../../utils/moduleFormats.generated';
import { loadLibOpenMPTNode } from '../helpers/libopenmptNode';

describe('module formats match the shipped libopenmpt', () => {
  it('the generated list equals openmpt_get_supported_extensions()', async () => {
    const { lib, restore } = await loadLibOpenMPTNode();
    try {
      const raw = lib as unknown as {
        _openmpt_get_supported_extensions: () => number;
        _openmpt_is_extension_supported: (ptr: number) => number;
        _openmpt_free_string: (ptr: number) => void;
        UTF8ToString: (ptr: number) => string;
        stringToUTF8: (s: string) => number;
        _free: (ptr: number) => void;
      };
      const ptr = raw._openmpt_get_supported_extensions();
      const fromWasm = raw.UTF8ToString(ptr).split(';').map((e) => e.trim().toLowerCase()).filter(Boolean);
      raw._openmpt_free_string(ptr);

      expect([...LIBOPENMPT_MODULE_EXTENSIONS]).toEqual(normalizeExtensions(fromWasm));

      // And libopenmpt agrees extension by extension.
      for (const ext of LIBOPENMPT_MODULE_EXTENSIONS) {
        const p = raw.stringToUTF8(ext);
        expect(raw._openmpt_is_extension_supported(p), ext).toBe(1);
        raw._free(p);
      }
    } finally {
      restore();
    }
  });

  it('utils/moduleFormats.generated.ts and public/sw.js are fresh (gen-module-formats --check)', async () => {
    expect(await staleOutputs()).toEqual([]);
  });
});
