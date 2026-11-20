# MIDI & Hardware Controls

The XASM-1 player treats external controllers like physical transport on a hardware deck. All inputs normalize into the shared **player command bus** (`utils/playerCommands.ts`) — the same commands used by keyboard shortcuts.

This page covers MIDI **in** (controllers driving the player) first, and [MIDI out](#midi-out-clock-transport-notes) (the player driving a DAW or a synth) after it.

## Browser support

| API | Chrome / Edge | Firefox | Safari |
|-----|---------------|---------|--------|
| Web MIDI | ✅ | ❌ | ❌ |
| Gamepad | ✅ | ✅ | ✅ (limited) |
| WebHID | ✅ (flags) | ❌ | ❌ |

**Recommended:** Chrome or Edge with a USB MIDI controller for live demos.

## Enabling MIDI

1. Open the player and expand **MIDI / Hardware** in the side panel.
2. Click **Enable MIDI** — Chrome will prompt for access.
3. Ensure **Active** is checked.
4. Connect a controller before or after granting access; hot-plug is supported.

MIDI works even when keyboard shortcuts are blocked (e.g. focus in a text field). Keyboard shortcuts remain available when not typing.

## Default mappings

### Transport (MMC-style notes, any channel)

| MIDI | Command |
|------|---------|
| Note **94** (0x5E) | Play (resumes from the paused position if paused) |
| Note **93** (0x5D) | Stop (resets to the start; before the pause feature this note paused) |
| Note **91** (0x5B) | Previous order |
| Note **92** (0x5C) | Next order |
| Note **60** (Middle C) | Play / pause toggle (pauses in place; the next press resumes) |

There is no default note for a bare **Pause** (`transport.pause`) yet; add one to the stored JSON (see
[Custom mappings](#custom-mappings)) if you want it separate from the Middle C toggle. A mapping set that
was already saved to `localStorage` (or restored with **Reset mappings** before this change) keeps its
stored commands, so its `93 → transport.pause` now genuinely pauses where it used to stop. Click **Reset
mappings** to pick up the new default (`93 → transport.stop`).

### Order jumps (pad notes, like keyboard `1`–`9`)

| MIDI Note | Command |
|-----------|---------|
| 36–44 (C2–G#2) | Jump to order 0–8 |

### Expression

| MIDI | Command |
|------|---------|
| CC **7** (volume) | Master volume 0–100% |
| CC **10** (pan) | Stereo pan −1…+1 |
| **Program Change** | Select shader by index mod shader list length |

### FX rack (#453)

| MIDI | Command |
|------|---------|
| CC **91** (reverb send) | Room mix 0–100 % |
| CC **74** (brightness) | EQ high shelf −12…+12 dB |
| CC **71** (timbre) | Character drive 0…1 |

A CC drives a param across its whole range along the param's own scale
(linear or logarithmic — frequencies sweep geometrically), the same 0…1 the
knobs use. Custom mappings can target any module param with
`fxTarget: { module, param }` and `command: 'fx.setParam'`, toggle a module with
`command: 'fx.toggle'` (a note toggles; a CC sets on at ≥ 64), or step presets
with `command: 'fx.preset'` (a note steps by `fxTarget.step`, default +1; a
Program Change selects preset *n*).

When two mappings match, the one bound to the message's exact channel wins
over an any-channel one — so a Program Change mapping on channel 2 can select
FX presets while the default any-channel one still selects shaders.

## Conflict resolution

| Situation | Keyboard | MIDI |
|-----------|----------|------|
| Focus in text input | Blocked | **Works** |
| Shortcuts help open | Blocked (except Esc) | **Works** |
| Edit mode undo (Ctrl+Z) | Separate listener | N/A |
| Same command from both | Both may fire | Idempotent handlers |

Mappings persist in `localStorage` (`xasm1_midi_mappings`). Toggle MIDI off with the **Active** checkbox without revoking browser permission.

## Custom mappings

Mappings are stored as JSON. Click **Reset mappings** to restore defaults. Future UI will allow per-control rebinding.

## Gamepad (planned)

Face buttons → transport; left stick X → seek rows; right stick Y → volume. Will use the same command bus with source `gamepad`.

## WebHID (stretch)

Custom XASM-1-style controllers via `navigator.hid` — device-specific report parsers feeding the command bus.

## MIDI out: clock, transport, notes

The player can be the **clock master** for a DAW or a hardware sequencer, and — opt-in — send the
pattern's **notes** to a synth. It uses Web MIDI (Chrome / Edge); where Web MIDI does not exist (Safari,
stock Firefox) the panel does not render and nothing else changes. Nothing in `audio-worklet/` is
involved: MIDI out is a framework-free observer of the `PlayerEngine`
(`audio/midi/midiOutController.ts`), the way the OS media controls are.

### Turning it on

1. Open **MIDI / Hardware** in the side panel and click **Enable MIDI out**. Chrome asks for MIDI access
   (no SysEx is requested).
2. Pick an output (a hardware port, or a virtual one: IAC on macOS, loopMIDI on Windows, `snd-virmidi` /
   a2jmidid on Linux). The choice is saved; on the next load the output is reopened silently if the
   browser has already granted MIDI (a restore never raises a prompt).
3. **Clock & transport** is on by default once an output is chosen; **Pattern notes** is off.

Unplugging the output stops the stream quietly; plugging it back in (or choosing another output)
brings the receiver to where the song is — see *Seeking* below. Changing the output mid-song sends the
old port a Stop and note-offs.

### What is sent

| When | Bytes |
|------|-------|
| Playing | **Timing Clock** `F8`, 24 per beat |
| A song starts from its beginning | **Start** `FA` just before the first clock, which is the song's downbeat |
| Pause | **Stop** `FC`, at the instant the audio stops |
| Resume | **Continue** `FB` just before the first clock; the beat phase continues where the pause left it |
| Stop, a faulted worklet, unloading a module | **Stop** `FC` |
| A seek while playing | **Stop**, **Song Position Pointer** `F2`, **Continue** — 1 ms apart, just before the first clock at the new position |
| A seek while paused | **Song Position Pointer** immediately; **Continue** follows on resume |
| Starting from a position that is not the start (`seekOrder` from stopped) | **Song Position Pointer**, **Continue** (no Start: Start means position 0) |
| Choosing the output (or switching the clock on) mid-song | the same Stop / Song Position / Continue as a seek, at the next position report |
| The song wraps with no seek (libopenmpt looping) | the same relocation as a seek |

Song Position Pointer counts sixteenth notes = six clocks. The player's unit is the pattern row, which is
a sixteenth at the trackers' default of four rows per beat, so **SPP = the global row index** (the same
count as `sequencerGlobalRow`) and a row is six clocks. MOD, XM and S3M have no rows-per-beat setting,
so they are always like that; an IT pattern with a custom rows-per-beat keeps the right clock *rate* but gets a proportionally wrong SPP
(libopenmpt's C API does not expose rows-per-beat, so there is nothing to correct it with).

### The tempo

The clock follows libopenmpt's **estimated BPM** — `tempo × 24 / (speed × rows-per-beat)`: 125 for a
default MOD, 107.143 after an `F07` at tempo 125. So both tempo (`Fxx` ≥ 32, `Txx`) and speed
(`Fxx` < 32, `Axx`) changes move the DAW's tempo, as they move the beat the song is actually played at.

**A tempo change takes effect from the next pulse that has not been handed to the browser — not at the
next row boundary.** A row boundary would defer a speed change by up to a row (120 ms at 125 BPM) and
ignore tempo slides; the pulses already queued cannot be recalled (`MIDIOutput.clear()` is not
implemented in Chromium), so a change is followed within the 100 ms lookahead, counted from when the
change is *heard*, not when it was rendered.

### Timing

Every message is stamped with a `performance.now()` time and handed to the browser up to 100 ms early
(`MIDIOutput.send(data, timestamp)`), from a 10 ms timer on the main thread. The stamp is derived from
the audio clock: where the audio at time *T* is at the speakers, `AudioContext.getOutputTimestamp()`
says — so output latency is already in it, and MIDI sounds with the audio, not ahead of it. Each
timestamp reading carries a few ms of jitter, so the offset between the audio and performance clocks is
kept as a slow average (`audio/midi/audioPerfClock.ts`) instead of being used raw.

* **Clock:** pulses are 2.5 / BPM seconds apart on a free-running grid anchored at the song start (or the
  resume point), so they are regular regardless of the 60 Hz position reports. Against a simulated
  worklet with ±3 ms of timestamp noise, every pulse lands within ±1 ms of its grid slot and every
  interval within ±1 ms of nominal (`tests/unit/midiOutController.test.ts`). What that test cannot show
  is a real receiver: Chromium's own send scheduling and the OS MIDI driver add their jitter on top, and
  that has not been measured with a DAW.
* **Notes:** the player only learns a position 60 times a second, so a row boundary is placed at the
  middle of the interval it was observed in: up to ±8 ms, unbiased. The first row after a start or seek
  is exact.
* **A hidden tab keeps going.** The UI loop (`requestAnimationFrame`) stops with the tab, so MIDI out
  drains the position reports on its own timer (`PlayerEngine.pollPosition`). Chromium does not throttle
  timers on a page that is playing audio. If the browser ever does throttle it, late messages are counted in the
  panel (`late`) and pulses more than one interval late are dropped rather than bunched up
  (`dropped`); the beat phase is kept.
* **Sync drift:** the grid is not re-phased to the rows while playing (the position reports are too
  coarse to do it better than the grid already is), so a long song with many tempo changes can slide a
  few ms against its rows; a start, a seek or a loop wrap re-anchors it (a resume continues the phase the
  pause left).

### Pattern notes (opt-in)

* One tracker channel → one MIDI channel (`n mod 16`; channel 10 is General MIDI percussion), or all on a
  single chosen channel. Muted tracker channels send nothing.
* Note numbers follow the pattern display: OpenMPT's middle C, C-5 (libopenmpt value 61), is MIDI 60.
* Velocity comes from the volume column's set-volume or `Cxx` (0–64 → 1–127); a note with neither plays
  at 100.
* **Note-off is derived** — a pattern has none:
  the next note on the channel (off, then on), a key-off / cut / fade cell (`===`, `^^^`, `~~~`), `ECx` /
  `SCx` (at tick *x* of the row), a set-volume of 0 (volume column or `C00`), and — for everything still
  held — a pause, stop, seek, or switching note-out off. `EDx` / `SDx` delay a note to tick *x*.
* That is what the pattern says, and it is **not enough for one-shot samples**: a drum hit that simply
  runs out never announces it, so its MIDI note is held until one of the events above. That is harmless
  for drums on a sampler, and wrong for a sustained pad that is meant to stop with its sample.
* Not sent: tone portamento (a slide to the cell's note is not a new note), pitch and vibrato effects,
  instrument → program change, panning, volume slides. **Do not route the output back into a controller
  this player listens to**: the notes would trigger its transport mappings (notes 36–44, 60, 91–94).
* Needs the AudioWorklet engine's position reports. On the ScriptProcessor fallback only the clock
  works (free-running from the module's BPM); notes are not sent.

### Developer notes

```
audio/midi/midiOutController.ts   the observer: transport edges, seeks, the 10 ms scheduler, ports
audio/midi/pulseGrid.ts           the 24-per-beat pulse times (pure)
audio/midi/audioPerfClock.ts      audio time → performance.now(), averaged (pure)
audio/midi/noteOutPlanner.ts      pattern cells → timed note messages (pure)
audio/midi/midiMessages.ts        byte builders
utils/midiOut.ts                  Web MIDI access, permission query, stored settings
hooks/useMidiOut.ts, components/MidiOutPanel.tsx   the React side (lazy: components/MidiOutPanelLazy.tsx)
hooks/useMidiOutRestore.ts        eager: reopens a saved output on load, by a dynamic import
```

The controller and its panel are a **lazy chunk** (`midiOutController-*.js`; the initial page carries none
of it, and where Web MIDI is absent it is never fetched). `scripts/verify-bundle-budget.mjs` fails the
build if eager code starts importing it statically — keep `useMidiOutRestore.ts` and everything else
eager free of static imports of `audio/midi/` and `hooks/useMidiOut.ts`.

`PlayerEngine` gained three read-only observers for this: `pollPosition()` (drains the shared ring on
the caller's timer), `getPatternMatrix(order)` (every order — the snapshot only holds the one on
screen), and `onSeek(listener)` (every way of seeking, including a loop-region wrap). Tests:
`tests/unit/midiOutCore.test.ts`, `tests/unit/midiOutController.test.ts` (a simulated engine, audio clock
and MIDI port) and the `observers for MIDI out` block of `tests/unit/playerEngine.test.ts`.

## Developer notes (command bus)

```typescript
import { playerCommands } from './utils/playerCommands';

// Dispatch from any input source
playerCommands.dispatch('transport.playPause', 'midi');

// Register handlers once at app boot
import { useRegisterPlayerCommands } from './hooks/useRegisterPlayerCommands';
```

Keyboard shortcuts were refactored to dispatch through this bus (`hooks/useKeyboardShortcuts.ts`). Add new transport features by extending `PlayerCommandId` and registering a handler.
