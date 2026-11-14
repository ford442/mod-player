/**
 * One list of module file types (utils/moduleFormats.ts, generated from the shipped libopenmpt):
 * the helpers behave, and no component / util goes back to a hand-typed extension list.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MODULE_FILE_ACCEPT,
  MODULE_FILE_EXTENSIONS,
  filterSupportedModuleFiles,
  isSupportedModuleFileName,
  isSupportedModuleUrl,
  moduleFileExtension,
  moduleFormatsSummary,
  supportedModuleFileList,
} from '../../utils/moduleFormats';
import { isModuleFileName } from '../../utils/folderImport';
import { isTrackerLibrarySong } from '../../utils/storageApi';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('module format helpers', () => {
  it('lists the libopenmpt formats, lower-case and sorted', () => {
    expect(MODULE_FILE_EXTENSIONS.length).toBeGreaterThan(40);
    for (const ext of ['mod', 'xm', 's3m', 'it', 'mptm', 'mo3', 'med', 'okt', 'mtm', '669']) {
      expect(MODULE_FILE_EXTENSIONS).toContain(ext);
    }
    expect([...MODULE_FILE_EXTENSIONS]).toEqual([...MODULE_FILE_EXTENSIONS].sort());
    for (const ext of MODULE_FILE_EXTENSIONS) expect(ext).toBe(ext.toLowerCase());
  });

  it('builds the accept attribute from every extension', () => {
    const parts = MODULE_FILE_ACCEPT.split(',');
    expect(parts).toHaveLength(MODULE_FILE_EXTENSIONS.length);
    expect(parts).toContain('.mod');
    expect(parts).toContain('.mo3');
    expect(parts.every((p) => /^\.[a-z0-9]+$/.test(p))).toBe(true);
  });

  it('matches file names case-insensitively, by the last extension only', () => {
    expect(isSupportedModuleFileName('Track.XM')).toBe(true);
    expect(isSupportedModuleFileName('deep/nested/song.okt')).toBe(true);
    expect(isSupportedModuleFileName('C:\\mods\\space.MED')).toBe(true);
    expect(isSupportedModuleFileName('song #2.mod')).toBe(true); // '#' is part of a file name
    expect(isSupportedModuleFileName('song.mod.txt')).toBe(false);
    expect(isSupportedModuleFileName('readme')).toBe(false);
    expect(isSupportedModuleFileName('mods.d/readme')).toBe(false);
    expect(isSupportedModuleFileName('cover.png')).toBe(false);
    expect(moduleFileExtension('a.b.IT')).toBe('it');
  });

  it('ignores a URL query string and hash', () => {
    expect(isSupportedModuleUrl('https://x.test/files/tune.xm?v=3#t=1')).toBe(true);
    expect(isSupportedModuleUrl('https://x.test/files/tune.flac?x=.mod')).toBe(false);
  });

  it('summarises the formats for help text', () => {
    const text = moduleFormatsSummary();
    expect(text).toMatch(/^Supports \.mod, \.xm, \.s3m, \.it/);
    expect(text).toContain(`${MODULE_FILE_EXTENSIONS.length - 6} more`);
  });

  it('folder import and the remote library use the same list (.med / .okt / .mo3 included)', () => {
    for (const name of ['a.med', 'b.okt', 'c.mo3', 'd.mod']) expect(isModuleFileName(name)).toBe(true);
    expect(isModuleFileName('notes.txt')).toBe(false);
    expect(isTrackerLibrarySong({
      id: 'o', fileName: 'tune.okt', title: '', artist: '', downloadUrl: 'https://x.test/a?b',
    })).toBe(true);
  });
});

describe('drop / picker filtering', () => {
  const file = (name: string) => ({ name }) as File;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps only module files', () => {
    const picked = filterSupportedModuleFiles([file('a.mod'), file('b.txt'), file('c.IT')]);
    expect(picked.map((f) => f.name)).toEqual(['a.mod', 'c.IT']);
  });

  it('returns the same FileList when everything is a module, else a filtered one', () => {
    class FakeDataTransfer {
      private readonly list: File[] = [];
      readonly items = { add: (f: File) => { this.list.push(f); } };
      get files(): FileList {
        return Object.assign([...this.list], { item: (i: number) => this.list[i] ?? null }) as unknown as FileList;
      }
    }
    vi.stubGlobal('DataTransfer', FakeDataTransfer);
    const asList = (files: File[]) =>
      Object.assign([...files], { item: (i: number) => files[i] ?? null }) as unknown as FileList;

    const allModules = asList([file('a.mod'), file('b.xm')]);
    expect(supportedModuleFileList(allModules)).toBe(allModules);

    const mixed = supportedModuleFileList(asList([file('a.mod'), file('photo.jpg'), file('b.s3m')]));
    expect(Array.from(mixed).map((f) => f.name)).toEqual(['a.mod', 'b.s3m']);
  });
});

describe('no hand-typed module extension lists', () => {
  const SKIP = new Set(['node_modules', 'dist', '.git', 'tests', 'scripts', 'public', 'archive', 'docs', '.claude', '_codeql_detected_source_root']);
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  };

  it('file inputs take MODULE_FILE_ACCEPT, and no source spells .mod/.xm/.s3m/.it lists itself', () => {
    const offenders: string[] = [];
    for (const f of walk(ROOT)) {
      const rel = relative(ROOT, f);
      // The list itself, and the helpers' headline formats for help text.
      if (rel === 'utils/moduleFormats.generated.ts' || rel === 'utils/moduleFormats.ts') continue;
      const code = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // accept=".mod,…" or a regex / array naming several tracker extensions.
      if (/accept=["'][^"']*\.(?:mod|xm|s3m|it)\b/i.test(code)) offenders.push(`${rel}: accept list`);
      if (/\(mod\|xm|['"]\.?xm['"],\s*['"]\.?it['"]|['"]\.?mod['"],\s*['"]\.?xm['"]/i.test(code)) offenders.push(`${rel}: extension list`);
    }
    expect(offenders).toEqual([]);
  });
});
