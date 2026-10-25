/** Per-song memory on the song fingerprint (#511): SongSession store, shader restore, legacy migration. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeModuleHash } from '../appConfig';

const xm = (title: string, body: number) => {
  const bytes = new Uint8Array(400).fill(body);
  bytes.set(new TextEncoder().encode(`Extended Module: ${title}`), 0);
  return bytes;
};

function installBrowserStubs(): Map<string, string> {
  const store = new Map<string, string>();
  const memory = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  Object.defineProperty(window, 'localStorage', { value: memory, configurable: true, writable: true });
  Object.defineProperty(window, 'dispatchEvent', { value: () => true, configurable: true, writable: true });
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false }), configurable: true, writable: true });
  if (typeof globalThis.StorageEvent !== 'function') {
    (globalThis as unknown as { StorageEvent: unknown }).StorageEvent = class {
      constructor(public type: string) {}
    };
  }
  return store;
}

async function loadApp() {
  vi.resetModules();
  const session = await import('../utils/songSession');
  const memoryStore = session.createMemorySongSessionStore();
  session.setSongSessionStore(memoryStore);
  const identity = await import('../utils/songIdentity');
  const { useShaderPrefsStore } = await import('../store/shaderPrefsStore');
  const { AVAILABLE_SHADERS } = await import('../appConfig');
  /** Load a song and wait until its shader restore (async, IndexedDB-shaped) has settled. */
  const load = async (bytes: Uint8Array) => {
    await identity.publishSongBytes(bytes);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { session, memoryStore, identity, store: useShaderPrefsStore, shaders: AVAILABLE_SHADERS.map((s) => s.id), load };
}

describe('SongSession store (#511)', () => {
  it('memory adapter: get / put / subscribe, records are copies', async () => {
    const { createMemorySongSessionStore, emptySongSession } = await import('../utils/songSession');
    const s = createMemorySongSessionStore();
    const seen: string[] = [];
    const off = s.subscribe((r) => seen.push(r.fingerprint));
    expect(await s.get('sha256:a')).toBeNull();
    const rec = { ...emptySongSession('sha256:a'), shader: 'x.wgsl' };
    await s.put(rec);
    rec.shader = 'mutated';
    expect((await s.get('sha256:a'))?.shader).toBe('x.wgsl');
    off();
    await s.put(emptySongSession('sha256:b'));
    expect(seen).toEqual(['sha256:a']);
  });

  it('serialised patches keep each other\'s fields; lastPosition is recorded', async () => {
    const m = await import('../utils/songSession');
    m.setSongSessionStore(m.createMemorySongSessionStore());
    await Promise.all([
      m.updateSongSession('fp', { shader: 's.wgsl' }),
      m.recordSongPosition('fp', { order: 3, row: 12, seconds: 41.5 }),
    ]);
    expect(await m.readSongSession('fp')).toEqual({
      fingerprint: 'fp',
      shader: 's.wgsl',
      lastPosition: { order: 3, row: 12, seconds: 41.5 },
      legacyShaderMigrated: false,
    });
  });
});

describe('shader memory on the fingerprint (#511)', () => {
  let ls: Map<string, string>;
  beforeEach(() => {
    ls = installBrowserStubs();
  });

  it('two XMs with the same 16-byte prefix restore two different shaders', async () => {
    const a = xm('Song A', 1);
    const b = xm('Song B', 2);
    expect(computeModuleHash(a)).toBe(computeModuleHash(b)); // the fixture collides on the old key
    const { store, shaders, load } = await loadApp();
    const [s1, s2] = [shaders[1]!, shaders[2]!];

    await load(a);
    store.getState().selectShader(s1);
    await load(b);
    store.getState().selectShader(s2);
    await load(a);
    expect(store.getState().storedShader).toBe(s1);
    await load(b);
    expect(store.getState().storedShader).toBe(s2);
    expect([...ls.keys()].some((k) => k.startsWith('xasm1_module_shader_'))).toBe(false); // no per-song localStorage key
  });

  it('a legacy key migrates once; a later load does not clobber the fingerprint entry', async () => {
    const a = xm('Song A', 1);
    const { store, shaders, load, session, identity } = await loadApp();
    const [legacy, picked] = [shaders[3]!, shaders[4]!];
    ls.set(`xasm1_module_shader_${computeModuleHash(a)}`, legacy);

    await load(a);
    expect(store.getState().storedShader).toBe(legacy);
    const fp = identity.getSongFingerprint()!;
    expect((await session.readSongSession(fp))?.legacyShaderMigrated).toBe(true);

    store.getState().selectShader(picked);
    await load(xm('other', 9));
    await load(a);
    expect(store.getState().storedShader).toBe(picked);
    expect((await session.readSongSession(fp))?.shader).toBe(picked);
  });

  it('an existing fingerprint shader wins over a legacy entry', async () => {
    const a = xm('Song A', 1);
    const { store, shaders, load, session } = await loadApp();
    const { computeSongFingerprint } = await import('../utils/songFingerprint');
    const fp = await computeSongFingerprint(a);
    await session.updateSongSession(fp, { shader: shaders[5]! });
    ls.set(`xasm1_module_shader_${computeModuleHash(a)}`, shaders[3]!);
    await load(a);
    expect(store.getState().storedShader).toBe(shaders[5]);
  });

  it('a shader shared by link is not overridden by the song restore', async () => {
    const a = xm('Song A', 1);
    const { store, shaders, load } = await loadApp();
    await load(a);
    store.getState().selectShader(shaders[1]!);
    await load(xm('x', 7));
    store.getState().selectShader(shaders[2]!);
    store.getState().markSkipModuleShaderRestore();
    await load(a);
    expect(store.getState().storedShader).toBe(shaders[2]);
  });

  it('legacyModuleKey matches computeModuleHash (migration reads the right key)', async () => {
    const { legacyModuleKey } = await import('../utils/songIdentity');
    const a = xm('Song A', 1);
    expect(legacyModuleKey(a)).toBe(computeModuleHash(a));
  });
});
