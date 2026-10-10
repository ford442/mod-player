/**
 * Content fingerprint of a loaded module file (#453) — the key for per-song
 * FX presets.
 *
 * `computeModuleHash` (appConfig.ts) hex-encodes only the first 16 bytes, so
 * every XM file ("Extended Module: …") gets the same key. This hashes the
 * whole file: SHA-256 via crypto.subtle where available (secure contexts),
 * else a 64-bit FNV-1a pair (plain-http LAN hosts have no subtle crypto).
 * The prefix says which, so the two never collide with each other.
 */

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Two 32-bit FNV-1a lanes with different offset bases → 64 bits. */
export function fnv1a64(bytes: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i]!;
    a = Math.imul(a ^ v, 0x01000193) >>> 0;
    b = Math.imul(b ^ v ^ (i & 0xff), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export async function computeSongFingerprint(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      // digest() needs an ArrayBuffer-backed view (not a SharedArrayBuffer one).
      const data = bytes.buffer instanceof ArrayBuffer ? bytes : bytes.slice();
      const digest = await subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
      return `sha256:${hex(new Uint8Array(digest)).slice(0, 32)}`;
    } catch {
      /* fall through */
    }
  }
  return `fnv64:${fnv1a64(bytes)}`;
}
