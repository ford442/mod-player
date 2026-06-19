const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testScript = `
import { createParserPromise } from '../parserPromise.ts';

class MockWorker {
  listeners = new Map<string, Set<Function>>();
  terminated = false;

  addEventListener(type: string, handler: Function) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: Function) {
    this.listeners.get(type)?.delete(handler);
  }

  postMessage() {
    // no-op by default
  }

  terminate() {
    this.terminated = true;
  }

  dispatch(type: string, data?: unknown) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(data);
    }
  }
}

(globalThis as any).Worker = MockWorker;
(globalThis as any).window = globalThis;

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('FAIL:', msg);
  }
}

async function testSuccess() {
  const worker = new MockWorker();
  const { promise } = createParserPromise<string>(
    worker as unknown as Worker,
    1000,
    () => worker.postMessage(),
    { shouldResolve: () => true },
  );
  setTimeout(() => worker.dispatch('message', { data: 'ok' }), 10);
  const result = await promise;
  assert(result === 'ok', 'success should resolve with message data');
  assert(worker.listeners.get('message')?.size === 0, 'success should remove message listener');
  assert(worker.listeners.get('error')?.size === 0, 'success should remove error listener');
  assert(worker.listeners.get('messageerror')?.size === 0, 'success should remove messageerror listener');
  assert(!worker.terminated, 'success should not terminate worker');
}

async function testErrorEvent() {
  const worker = new MockWorker();
  const { promise } = createParserPromise<string>(
    worker as unknown as Worker,
    1000,
    () => worker.postMessage(),
    { shouldResolve: () => true },
  );
  setTimeout(() => worker.dispatch('error', { message: 'boom' }), 10);
  let err: Error | null = null;
  try { await promise; } catch (e) { err = e as Error; }
  assert(err?.message === 'boom', 'error event should reject with message');
  assert(worker.listeners.get('message')?.size === 0, 'error should remove listeners');
}

async function testMessageError() {
  const worker = new MockWorker();
  const { promise } = createParserPromise<string>(
    worker as unknown as Worker,
    1000,
    () => worker.postMessage(),
    { shouldResolve: () => true },
  );
  setTimeout(() => worker.dispatch('messageerror'), 10);
  let err: Error | null = null;
  try { await promise; } catch (e) { err = e as Error; }
  assert(err?.message === 'Parser worker message deserialization failed', 'messageerror should reject');
  assert(worker.listeners.get('messageerror')?.size === 0, 'messageerror should remove listeners');
}

async function testTimeout() {
  const worker = new MockWorker();
  const { promise } = createParserPromise<string>(
    worker as unknown as Worker,
    50,
    () => worker.postMessage(),
    { shouldResolve: () => true },
  );
  let err: Error | null = null;
  try { await promise; } catch (e) { err = e as Error; }
  assert(err?.message === 'Parser timed out after 50ms', 'timeout should reject with timeout message');
  assert(worker.terminated, 'timeout should terminate worker');
  assert(worker.listeners.get('message')?.size === 0, 'timeout should remove listeners');
}

async function testPostMessageException() {
  const worker = new MockWorker();
  const { promise } = createParserPromise<string>(
    worker as unknown as Worker,
    1000,
    () => { throw new Error('post failed'); },
    { shouldResolve: () => true },
  );
  let err: Error | null = null;
  try { await promise; } catch (e) { err = e as Error; }
  assert(err?.message === 'post failed', 'postMessage exception should reject');
  assert(worker.listeners.get('message')?.size === 0, 'postMessage exception should remove listeners');
}

async function testIntermediateProgress() {
  const worker = new MockWorker();
  const intermediates: string[] = [];
  const { promise } = createParserPromise<{ type: string; stage: string }>(
    worker as unknown as Worker,
    1000,
    () => worker.postMessage(),
    {
      shouldResolve: (data) => data.type !== 'progress',
      onIntermediate: (data) => { if (data.type === 'progress') intermediates.push(data.stage); },
    },
  );
  setTimeout(() => worker.dispatch('message', { data: { type: 'progress', stage: 'wasm' } }), 10);
  setTimeout(() => worker.dispatch('message', { data: { type: 'progress', stage: 'patterns' } }), 20);
  setTimeout(() => worker.dispatch('message', { data: { type: 'parsed' } }), 30);
  const result = await promise;
  assert(intermediates.length === 2, 'should receive two progress intermediates');
  assert(intermediates[0] === 'wasm' && intermediates[1] === 'patterns', 'progress stages should be in order');
  assert(result.type === 'parsed', 'should resolve with final non-progress message');
}

(async () => {
  await testSuccess();
  await testErrorEvent();
  await testMessageError();
  await testTimeout();
  await testPostMessageException();
  await testIntermediateProgress();
  console.log(\`\\nparserPromise tests: \${passed} passed, \${failed} failed\`);
  if (failed > 0) process.exit(1);
})();
`;

const tempFile = path.join(__dirname, 'temp-parser-promise.test.ts');
fs.writeFileSync(tempFile, testScript);
const result = spawnSync('npx', ['tsx', tempFile], {
  encoding: 'utf-8',
  stdio: ['inherit', 'pipe', 'pipe'],
});
console.log(result.stdout);
if (result.stderr) console.error(result.stderr);
fs.unlinkSync(tempFile);
if (result.status !== 0) {
  process.exit(1);
}
