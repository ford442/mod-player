/**
 * Octave brightness curve parity (patternv0.50.wgsl reference).
 *
 * Run with: node utils/__debug__/octaveBrightness.test.cjs
 */

const assert = require('assert');

const NOTE_MAX = 119;

/** Mirrors patternv0.50.wgsl `octaveBrightness` verbatim. */
function octaveBrightness(note) {
  if (note === 0 || note > NOTE_MAX) {
    return 1.0;
  }
  const oct = Math.floor((note - 1) / 12); // 0..9
  return 0.65 + 0.35 * oct / 9.0;
}

function approx(actual, expected, eps = 1e-3) {
  assert(Math.abs(actual - expected) < eps, `expected ~${expected}, got ${actual}`);
}

// Reference anchors from acceptance criteria
approx(octaveBrightness(1), 0.650);   // C-0, oct 0
approx(octaveBrightness(13), 0.689);   // C-1, oct 1
approx(octaveBrightness(109), 1.000);  // C-9, oct 9

// Guards: empty / note-off must not dim non-note paths
assert.strictEqual(octaveBrightness(0), 1.0);
assert.strictEqual(octaveBrightness(120), 1.0);
assert.strictEqual(octaveBrightness(255), 1.0);

// Same pitch class, different octaves
assert(octaveBrightness(25) < octaveBrightness(49)); // C-2 vs C-4

console.log('octaveBrightness.test.cjs: all assertions passed');
