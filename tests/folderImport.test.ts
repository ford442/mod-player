/** Ported from utils/__debug__/folderImport.test.cjs (which also ran through `npx tsx`). */
import { describe, expect, it } from 'vitest';
import {
  formatFromFileName,
  inferWebkitRootLabel,
  isModuleFileName,
  type ScannedFileRef,
} from '../utils/folderImport';

function scanned(relativePath: string, fileName: string): ScannedFileRef {
  return { relativePath, fileName, size: 1, lastModified: 0, getArrayBuffer: async () => new ArrayBuffer(0) };
}

describe('folderImport', () => {
  it('accepts tracker module extensions case-insensitively, including nested paths', () => {
    expect(isModuleFileName('track.XM')).toBe(true);
    expect(isModuleFileName('deep/nested/module.it')).toBe(true);
  });

  it('rejects non-module files and names with no extension', () => {
    expect(isModuleFileName('readme.txt')).toBe(false);
    expect(isModuleFileName('noextension')).toBe(false);
  });

  it('derives the format from the last extension', () => {
    expect(formatFromFileName('foo.bar.mod')).toBe('mod');
    expect(formatFromFileName('UPPER.XM')).toBe('xm');
    expect(formatFromFileName('noextension')).toBe('');
  });

  it('uses the first path segment as the webkit root label', () => {
    expect(inferWebkitRootLabel([scanned('MyMods/sub/chip.mod', 'chip.mod')])).toBe('MyMods');
  });

  it('falls back to a default label for a flat or empty selection', () => {
    expect(inferWebkitRootLabel([scanned('chip.mod', 'chip.mod')])).toBe('Imported Folder');
    expect(inferWebkitRootLabel([])).toBe('Imported Folder');
  });
});
