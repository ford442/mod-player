import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadSymbolMap,
  parseSymbolMap,
  symbolicateReport,
  symbolicateText,
} from '../../scripts/lib/symbolicate.mjs';
import {
  buildDiagnosticsBundle,
  createMemoryFaultStore,
  recordFault,
  serializeDiagnosticsBundle,
  setFaultStoreForTests,
} from '../../utils/faultReport';

const MAPS = join(__dirname, '../fixtures/symbol-maps');
const WORKLET_KEY = 'f1x7ure0aa';
const PLAYBACK_KEY = 'f1x7ure0bb';

afterEach(() => setFaultStoreForTests(null));

/** A V8 trap in the shared pair: an anonymous wasm:// module (instantiated from bytes) and a URL frame. */
const V8_STACK = [
  'RuntimeError: unreachable',
  '    at wasm://wasm/0012abcd:wasm-function[12]:0x1f3c',
  '    at wasm://wasm/0012abcd:wasm-function[11]:0x2a00',
  '    at /xm-player/worklets/libopenmpt-worklet.wasm?v=f1x7ure0aa:wasm-function[6]:0x80',
  '    at Object.loadModule (/xm-player/assets/index-abc.js:1:2345)',
].join('\n');

describe('parseSymbolMap', () => {
  it('reads index:name lines and keeps the colons of C++ names', () => {
    const map = parseSymbolMap(readFileSync(join(MAPS, `libopenmpt-worklet.${WORKLET_KEY}.symbols`), 'utf8'));
    expect(map.get(0)).toBe('invoke_vi');
    expect(map.get(13)).toBe('openmpt::module_impl::read(int, unsigned long, float*)');
    expect(map.size).toBe(16);
  });

  it('skips blank and malformed lines', () => {
    const map = parseSymbolMap('\n7:foo\nbar\n:baz\nx1:qux\n8:\r\n9:a:b\r\n');
    expect([...map]).toEqual([[7, 'foo'], [9, 'a:b']]);
  });
});

describe('symbolicateText', () => {
  it('annotates each frame line with the function name of the pair the line names', () => {
    const worklet = loadSymbolMap([MAPS], 'libopenmpt-worklet', WORKLET_KEY)!.map;
    const playback = loadSymbolMap([MAPS], 'libopenmpt-playback', PLAYBACK_KEY)!.map;
    const text = [
      'at wasm://wasm/aa:wasm-function[9]:0x1',
      'at /w/libopenmpt-playback.wasm?v=x:wasm-function[7]:0x2',
      'at wasm-function[99] (wasm://wasm/aa:wasm-function[99]:0x3)',
      'at foo (index.js:1:1)',
    ].join('\n');
    const out = symbolicateText(text, (p) => (p === 'libopenmpt-worklet' ? worklet : playback), 'libopenmpt-worklet');
    expect(out.text.split('\n')).toEqual([
      'at wasm://wasm/aa:wasm-function[9]:0x1  → OpenMPT::CSoundFile::ReadNote()',
      'at /w/libopenmpt-playback.wasm?v=x:wasm-function[7]:0x2  → OpenMPT::CSoundFile::ProcessRamping(OpenMPT::ModChannel&)',
      'at wasm-function[99] (wasm://wasm/aa:wasm-function[99]:0x3)  → wasm-function[99]=?',
      'at foo (index.js:1:1)',
    ]);
    expect(out.resolved).toBe(2);
    expect(out.unresolved).toBe(1);
  });

  it('handles the SpiderMonkey frame shape', () => {
    const worklet = loadSymbolMap([MAPS], 'libopenmpt-worklet', WORKLET_KEY)!.map;
    const out = symbolicateText('read@/worklets/libopenmpt-worklet.wasm?v=1:wasm-function[13]:0x5a1', () => worklet, 'libopenmpt-worklet');
    expect(out.text).toMatch(/→ openmpt::module_impl::read\(int, unsigned long, float\*\)$/);
  });
});

describe('a fault report round-trips through symbolicate', () => {
  it('decodes the frames of a report the app wrote, with the ?v= keys it recorded', async () => {
    setFaultStoreForTests(createMemoryFaultStore());
    const trap = new WebAssembly.RuntimeError('unreachable');
    trap.stack = V8_STACK;
    recordFault({ kind: 'error', source: 'window', error: trap });
    recordFault({ kind: 'worklet-fault', source: 'worklet:process-trap', message: 'trap at wasm-function[7]', wasmPair: 'libopenmpt-playback' });
    recordFault({ kind: 'gpu-error', source: 'webgpu', message: 'GPU-ERROR: OperationError: no wasm here' });

    // What a user pastes: the serialised bundle, with this build's real keys in it.
    const pasted = JSON.parse(serializeDiagnosticsBundle(await buildDiagnosticsBundle()));
    for (const fault of pasted.faults) {
      expect(fault.context.assets['libopenmpt-worklet']).toMatch(/^[0-9a-f]{10}$/);
      fault.context.assets['libopenmpt-worklet'] = WORKLET_KEY;
      fault.context.assets['libopenmpt-playback'] = PLAYBACK_KEY;
    }

    const { report, resolved, unresolved, missing } = symbolicateReport(pasted, { mapDirs: [MAPS] });
    expect({ resolved, unresolved, missing }).toEqual({ resolved: 4, unresolved: 0, missing: [] });
    const [fromWindow, worklet, gpu] = report.faults;
    expect(fromWindow.symbolicated.stack.split('\n').slice(1, 4)).toEqual([
      '    at wasm://wasm/0012abcd:wasm-function[12]:0x1f3c  → OpenMPT::ITDecompression::ITDecompression(OpenMPT::FileReader&, OpenMPT::ModSample&, bool, bool, unsigned int)',
      '    at wasm://wasm/0012abcd:wasm-function[11]:0x2a00  → OpenMPT::CSoundFile::ReadIT(OpenMPT::FileReader&, OpenMPT::CSoundFile::ModLoadingFlags)',
      '    at /xm-player/worklets/libopenmpt-worklet.wasm?v=f1x7ure0aa:wasm-function[6]:0x80  → openmpt_module_create_from_memory2',
    ]);
    expect(worklet.symbolicated.message).toBe('trap at wasm-function[7]  → OpenMPT::CSoundFile::ProcessRamping(OpenMPT::ModChannel&)');
    expect(worklet.symbolicated.maps).toEqual([join(MAPS, `libopenmpt-playback.${PLAYBACK_KEY}.symbols`)]);
    expect(gpu.symbolicated).toBeUndefined();
  });

  it('names the map it could not find', () => {
    const report = { faults: [{ message: 'at wasm-function[3]', wasmPair: 'libopenmpt-worklet', context: { assets: { 'libopenmpt-worklet': 'deadbeef00' } } }] };
    const result = symbolicateReport(report, { mapDirs: [MAPS] });
    expect(result.missing).toEqual(['libopenmpt-worklet.deadbeef00.symbols']);
    expect(result.unresolved).toBe(1);
  });

  it('rejects input that is not a fault report', () => {
    expect(() => symbolicateReport({ hello: 1 }, { mapDirs: [MAPS] })).toThrow(/not a fault report/);
  });
});
