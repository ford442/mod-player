# Phase 1 — Manual Audible Checklist

Run after any audio-path or playhead-prediction change. Use headphones or speakers — CI cannot assert audio output.

## Setup

```bash
npm run dev
# Diagnostic URL (force JS worklet + pin shader):
open 'http://localhost:5173/?engine=js&renderer=webgl2&shader=patternv0.30b.wgsl'
```

Optional playhead diagnostics:

```javascript
localStorage.setItem('xasm1_playhead_debug', '1');
// or append ?playheadDebug=1 to the URL
```

Watch the browser console for `[Playhead]` warnings (sustained lag > ~1.5 rows or position flood > ~75 Hz).

---

## Checklist (~5 minutes)

### 1. Default module — first play

| Step | Action | Pass |
|------|--------|------|
| 1a | Fresh tab (hard refresh `Ctrl+Shift+R`) | ☐ |
| 1b | Wait for `4-mat_madness.mod` to auto-load (status shows Loaded) | ☐ |
| 1c | Click **Play** once | ☐ |
| 1d | Hear tracker music (not 440 Hz sine, not silence) | ☐ |
| 1e | Order/row counters advance smoothly | ☐ |

**Fail signs:** 440 Hz test tone, silence with UI "Playing", console `Lib init failed` / `WASM library init timeout`.

---

### 2. File picker — play → stop → play

| Step | Action | Pass |
|------|--------|------|
| 2a | Open file picker, load `test.xm` (or any local `.xm`) | ☐ |
| 2b | Module auto-plays after load | ☐ |
| 2c | Click **Stop** | ☐ |
| 2d | Click **Play** again (no extra gesture) | ☐ |
| 2e | Audio resumes immediately | ☐ |

**Fail signs:** Second play silent until page refresh; `AudioContext` stuck `suspended`.

---

### 3. MOD ↔ XM switch while playing

| Step | Action | Pass |
|------|--------|------|
| 3a | Load `4-mat_madness.mod`, click **Play** | ☐ |
| 3b | While playing, load `test.xm` via picker | ☐ |
| 3c | New module plays without silence gap > 1 s | ☐ |
| 3d | Console has no spam of `ended → seek 0` | ☐ |
| 3e | Switch back to a `.mod` while playing — same | ☐ |

**Fail signs:** XM silent after switch (#329); runaway seek loop in console.

---

### 4. Seek + loop

| Step | Action | Pass |
|------|--------|------|
| 4a | Play any module | ☐ |
| 4b | Drag seek bar to ~50% — audio jumps, no permanent silence | ☐ |
| 4c | Enable **Loop**, let song reach end — restarts from top | ☐ |
| 4d | Disable loop, let song end — stops cleanly | ☐ |

---

### 5. Playhead sync (visual vs ear)

| Step | Action | Pass |
|------|--------|------|
| 5a | With `playheadDebug` on, open 🔍 debug panel | ☐ |
| 5b | While playing, `lagRows` stays &lt; 1.0 most of the time | ☐ |
| 5c | No `[Playhead] sustained` or `growing drift` warnings | ☐ |
| 5d | Outer playhead ring (v0.30b ch 0) tracks heard beat | ☐ |

Automated supplement:

```bash
npm run build && npm run preview -- --port 4173 &
npm run smoke:playhead   # median |lagRows| < 1.0 @ 125 BPM
```

---

## Quick console filter

DevTools → Console → filter: `[Worklet]` or `[Playhead]` or `[PLAY]`

Expected on healthy session:

```
[Worklet] libopenmpt ready ✅
[Worklet] Module loaded ✅ ptr= …
[PLAY] Hot reload — keeping existing audio graph wiring   (on module switch)
```

Must **not** appear repeatedly:

```
ended → seek 0
Ignoring stale worklet loaded ack   (occasional once is OK during fast switching)
[Playhead] position report flood
[Playhead] sustained playhead lag
```

---

## Exit criteria (Phase 1)

- [ ] All checklist items pass on Chrome with `?engine=js`
- [ ] `npm test -- worklet` — lifecycle guards green
- [ ] `npm run smoke:playhead` — median |lagRows| &lt; 1.0
- [ ] No 440 Hz tone, no silent "Playing" on common paths
