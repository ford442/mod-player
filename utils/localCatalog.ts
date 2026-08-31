import { withBase } from '../src/lib/paths';
import { ALL_SHADER_OPTIONS } from '../appConfig';
import type { RemoteSong, ShaderMeta } from './storageApi';

const LOCAL_MODULE_FILES: ReadonlyArray<{ fileName: string; title: string }> = [
  { fileName: '4-mat_madness.mod', title: '4-mat Madness' },
  { fileName: 'test.xm', title: 'test.xm' },
  { fileName: 'libopenmpt-test.mod', title: 'libopenmpt test' },
];

/** Bundled tracker files served from public/ — used when the cloud library is unavailable. */
export function getLocalCatalogSongs(): RemoteSong[] {
  return LOCAL_MODULE_FILES.map(({ fileName, title }) => {
    const downloadUrl = withBase(fileName);
    return {
      id: `local:${fileName}`,
      fileName,
      title,
      artist: '',
      downloadUrl,
    };
  });
}

/** Picker shaders as catalog rows (no cloud ratings). */
export function getLocalShaderCatalog(): ShaderMeta[] {
  return ALL_SHADER_OPTIONS.map((option) => ({
    id: option.id,
    name: option.label,
    averageRating: null,
    voteCount: null,
    userRating: null,
  }));
}
