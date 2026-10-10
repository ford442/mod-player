// FX rack character stage (#453) in Faust — for the ADR comparison only
// (docs/ADR-fx-character-dsp.md); the shipped stage is the TypeScript worklet
// in audio-worklet/js/fx/. Same chain, same constants, same ×2 halfband taps:
//
//   crush → A500 RC → LED 2-pole → ×2 up → tape (tanh + DC block) → ×2 down → trim
//
// The ×2 resampling is written as explicit polyphase at the base rate, exactly
// like the TS kernels: up = (2·FIR_even(x), x@11); down = FIR_even(e) + ½·o@12.
// The 2·fs DC blocker therefore runs as a pair of interleaved recursions.
// Taps: halfband_taps.lib, generated from the TS design by
// scripts/bench-fx-character.mjs.

import("stdfaust.lib");
import("halfband_taps.lib");

// ── Params (ranges = audio-worklet/fxCharacterParams.ts) ──────────────────────
tapeOn = checkbox("tapeOn") : si.smoo;
drive = hslider("drive", 0.3, 0, 1, 0.001);
bias = hslider("bias", 0.1, 0, 0.5, 0.001);
ledOn = checkbox("ledOn") : si.smoo;
ledModel = hslider("ledModel", 0, 0, 1, 1);
crushOn = checkbox("crushOn") : si.smoo;
crushRate = hslider("crushRate", 11025, 1000, 48000, 1);
crushBits = hslider("crushBits", 8, 2, 16, 0.01);
outputGain = hslider("outputGain", 0, -24, 12, 0.01) : ba.db2linear : si.smoo;

// ── Crush: Hz-accumulator sample-and-hold + mid-tread quantizer ───────────────
crush(x) = ba.sAndH(trig, q(x))
with {
  rate = min(crushRate, ma.SR);
  step = pow(2.0, 1.0 - crushBits);
  q(v) = rint(v / step) * step;
  acc = (+(rate) : \(p).(select2(p >= ma.SR, p, p - ma.SR))) ~ _;
  // The TS crusher takes sample 0, then wraps one sample after this accumulator.
  wrapped = acc < (acc' + rate - 0.5);
  trig = (wrapped@1) | (1 - 1');
};

// ── Amiga filters: A500 RC 4.42 kHz (1-pole) → LED 2-pole Butterworth 3275 Hz ─
rc = fi.tf1(b, b, a1)
with {
  k = tan(ma.PI * 4420 / ma.SR);
  b = k / (1 + k);
  a1 = (k - 1) / (k + 1);
};
led = fi.tf2(b0, b1, b2, a1, a2)
with {
  w0 = 2 * ma.PI * 3275 / ma.SR;
  alpha = sin(w0) / (2 * sqrt(0.5));
  a0 = 1 + alpha;
  b0 = (1 - cos(w0)) / 2 / a0;
  b1 = (1 - cos(w0)) / a0;
  b2 = b0;
  a1 = -2 * cos(w0) / a0;
  a2 = (1 - alpha) / a0;
};
amiga(x) = x + ledOn * (led(xr) - x)
with {
  rcOn = (ledModel < 0.5) : si.smoo;
  xr = x + rcOn * (rc(x) - x);
};

// ── Tape at 2·fs on the two polyphase streams ─────────────────────────────────
k = 0.25 * pow(10, 24 * drive / 20);
offset = ma.tanh(k * bias);
norm = max(ma.tanh(k * (1 + bias)) - offset, offset - ma.tanh(k * (bias - 1)));
sat(v) = (ma.tanh(k * (v + bias)) - offset) / norm;
R = exp(-2 * ma.PI * 10 / (2 * ma.SR));

// Interleaved DC blocker y = s − s₁ + R·y₁ over (even, odd) samples:
//   ye[n] = se[n] − so[n−1] + R·yo[n−1];  yo[n] = so[n] − se[n] + R·ye[n]
dcpair(se, so) = ye, yo
with {
  yo = (\(prev).(so - se + R * (se - so' + R * prev))) ~ _;
  ye = se - so' + R * yo';
};

tape(e, o) = e + tapeOn * (de - e), o + tapeOn * (do - o)
with {
  d = dcpair(sat(e), sat(o));
  de = d : _, !;
  do = d : !, _;
};

up(x) = 2 * (x : fi.fir(halfband_even)), x@11;
down(e, o) = (e : fi.fir(halfband_even)) + 0.5 * o@12;

channel(x) = (x + crushOn * (crush(x) - x)) : amiga : up : tape : down : *(outputGain);

process = channel, channel;
