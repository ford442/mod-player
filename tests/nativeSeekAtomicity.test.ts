/**
 * #seek-race → #491: order and row used to be two separate atomics, each read
 * via its own exchange(-1); the audio thread could run between the main
 * thread's two stores and see a valid order paired with row === -1. #seek-race
 * packed both into one std::atomic<uint64_t>; #491 replaced every control
 * atomic with ONE single-producer / single-consumer command ring
 * (cpp/native_engine.h), where a seek is a single slot that carries order and
 * row together and is published by one release store of the ring head — the
 * audio thread sees the whole seek or nothing.
 *
 * Runtime proof lives in cpp/host/ (scripts/native-host-test.sh, under TSan);
 * these are the source guards that keep the design from drifting back.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const glue = readFileSync(join(ROOT, 'cpp/worklet_processor.cpp'), 'utf8');
const engine = readFileSync(join(ROOT, 'cpp/native_engine.cpp'), 'utf8');
const header = readFileSync(join(ROOT, 'cpp/native_engine.h'), 'utf8');

function body(src: string, signature: string): string {
  const at = src.indexOf(signature);
  expect(at, signature).toBeGreaterThan(-1);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced body for ${signature}`);
}

describe('native seek: one ring command carrying order and row together', () => {
  it('no per-field seek atomics remain (neither the two-atomic nor the packed-u64 design)', () => {
    for (const src of [glue, engine, header]) {
      expect(src).not.toMatch(/g_cmdSeekOrder|g_cmdSeekRow|g_cmdSeek\b/);
      expect(src).not.toMatch(/std::atomic<[^>]+>\s+g_cmd/);
    }
  });

  it('seek_order_row() forwards both halves in one call', () => {
    expect(body(glue, 'void seek_order_row(')).toMatch(/g_engine\.seek\(order, row\)/);
  });

  it('the command is built whole, then pushed once', () => {
    const make = body(engine, 'Command NativeEngine::makeSeek(');
    expect(make).toMatch(/c\.a = order;/);
    expect(make).toMatch(/c\.b = row;/);
    expect(make).toMatch(/c\.generation = generation;/);
    const seek = body(engine, 'void NativeEngine::seek(');
    expect(seek.match(/pushOrDefer\(/g) ?? []).toHaveLength(1);
  });

  it('the ring publishes a slot with a release store of head after the slot copy', () => {
    const push = header.slice(header.indexOf('bool push(const T& value)'));
    const copyIdx = push.indexOf('slots_[head & (N - 1)] = value;');
    const releaseIdx = push.indexOf('head_.store(head + 1, std::memory_order_release)');
    expect(copyIdx).toBeGreaterThan(-1);
    expect(releaseIdx).toBeGreaterThan(copyIdx);
    // …and the consumer acquires head before reading any slot.
    const drain = header.slice(header.indexOf('uint32_t drain(F&& apply)'));
    expect(drain.indexOf('head_.load(std::memory_order_acquire)')).toBeLessThan(drain.indexOf('apply('));
  });

  it('the audio thread applies order and row from the same slot', () => {
    const apply = body(engine, 'void NativeEngine::applyCommand(');
    expect(apply).toMatch(/seekOrderRow\(cmd\.a, cmd\.b\)/);
  });

  it('a seek only lands on the module it was sent for (generation tag)', () => {
    const apply = body(engine, 'void NativeEngine::applyCommand(');
    expect(apply).toMatch(/cmd\.generation < live_->generation\) return;/);
    expect(apply).toContain('deferredSeek_ = cmd;');
  });
});
