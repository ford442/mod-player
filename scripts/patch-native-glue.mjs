#!/usr/bin/env node
/**
 * Patch emcc-generated openmpt-native.js:
 * 1. Do not clobber main-thread setTimeout (cpp/pre.js used to).
 * 2. Export emscriptenRegisterAudioObject / emscriptenGetAudioObject on Module
 *    (3.1.51 MODULARIZE leaves them as locals).
 *
 * Idempotent. Usage: node scripts/patch-native-glue.mjs [path/to/openmpt-native.js]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.argv[2] || 'public/worklets/openmpt-native.js');
if (!existsSync(target)) {
  console.error(`patch-native-glue: missing ${target}`);
  process.exit(1);
}

let src = readFileSync(target, 'utf8');
const original = src;

const smash =
  'globalThis.setTimeout=function(callback,delay){Promise.resolve().then(callback);return 0};globalThis.clearTimeout=function(){};';
const smashSpaced =
  'globalThis.setTimeout = function(callback, delay) {\n    Promise.resolve().then(callback); // Execute as a microtask\n    return 0;\n};\nglobalThis.clearTimeout = function() {};';
const guarded =
  'if(typeof globalThis.setTimeout!=="function"){globalThis.setTimeout=function(callback,delay){Promise.resolve().then(callback);return 0};globalThis.clearTimeout=function(){}};';

if (src.includes(smash)) {
  src = src.replace(smash, guarded);
} else if (src.includes(smashSpaced)) {
  src = src.replace(smashSpaced, guarded);
}

const exportAssign =
  'Module["emscriptenRegisterAudioObject"]=emscriptenRegisterAudioObject;Module["emscriptenGetAudioObject"]=emscriptenGetAudioObject;';
if (!src.includes('Module["emscriptenRegisterAudioObject"]') && !src.includes("Module['emscriptenRegisterAudioObject']")) {
  const needle = 'Module["UTF8ToString"]=UTF8ToString;';
  const needle2 = "Module['UTF8ToString']=UTF8ToString;";
  if (src.includes(needle)) {
    src = src.replace(needle, needle + exportAssign);
  } else if (src.includes(needle2)) {
    src = src.replace(needle2, needle2 + exportAssign);
  } else {
    console.error('patch-native-glue: could not find Module UTF8ToString assign to hang exports on');
    process.exit(1);
  }
}

if (src === original) {
  console.log(`patch-native-glue: already patched ${target}`);
  process.exit(0);
}
writeFileSync(target, src);
console.log(`patch-native-glue: patched ${target} (${src.length - original.length >= 0 ? '+' : ''}${src.length - original.length} bytes)`);
