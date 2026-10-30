import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function readShaderSource(relative: string): string {
  return readFileSync(join(ROOT, 'shaders', relative), 'utf8');
}

/** `const NAME: u32 = 12u;` → { NAME: 12 } for every integer const in the source. */
export function wgslU32Consts(source: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of source.matchAll(/^const\s+(\w+)\s*:\s*u32\s*=\s*(0x[0-9a-fA-F]+|\d+)u\s*;/gm)) {
    out[m[1]!] = Number(m[2]);
  }
  return out;
}

/**
 * Turns one small integer-only WGSL function (`fn f(a: u32, b: u32) -> u32 { … }`) into a JS
 * function, so a shader helper can be run against its TypeScript twin without a GPU. Supports
 * exactly what these helpers use: u32 literals (`4u`, `0xF0u`), let/var, if/else, min(), the
 * bitwise and logical operators. Anything else throws instead of silently mistranslating.
 */
export function wgslFnToJs(source: string, name: string, consts: Record<string, number>): (...args: number[]) => number | boolean {
  const start = source.search(new RegExp(`\\bfn\\s+${name}\\s*\\(`));
  if (start < 0) throw new Error(`WGSL fn ${name} not found`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (; end < source.length; end++) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}' && --depth === 0) break;
  }
  const header = source.slice(start, open);
  const params = [...header.matchAll(/(\w+)\s*:\s*u32/g)].map((m) => m[1]!);
  let body = source.slice(open + 1, end);
  body = body
    .replace(/\/\/.*$/gm, '')
    .replace(/\b(0x[0-9a-fA-F]+|\d+)u\b/g, '$1')
    .replace(/\b(let|var)\b/g, 'let')
    .replace(/\bmin\(/g, 'Math.min(')
    .replace(/\bf32\(|\bi32\(/g, '(');
  if (/[^\w\s(){}[\];,.!=<>&|+\-*/%?:^~]/.test(body) || /\b(select|array|vec\d|struct|loop|for|while)\b/.test(body)) {
    throw new Error(`WGSL fn ${name} uses syntax outside the supported subset:\n${body}`);
  }
  const names = Object.keys(consts);
  const factory = new Function(...names, `return function (${params.join(', ')}) {${body}}`) as (...v: number[]) => (...a: number[]) => number | boolean;
  return factory(...names.map((n) => consts[n]!));
}
