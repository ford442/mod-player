# MIDI & Hardware Controls

The XASM-1 player treats external controllers like physical transport on a hardware deck. All inputs normalize into the shared **player command bus** (`utils/playerCommands.ts`) — the same commands used by keyboard shortcuts.

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
| Note **94** (0x5E) | Play |
| Note **93** (0x5D) | Pause / stop |
| Note **91** (0x5B) | Previous order |
| Note **92** (0x5C) | Next order |
| Note **60** (Middle C) | Play / pause toggle |

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

## Developer notes

```typescript
import { playerCommands } from './utils/playerCommands';

// Dispatch from any input source
playerCommands.dispatch('transport.playPause', 'midi');

// Register handlers once at app boot
import { useRegisterPlayerCommands } from './hooks/useRegisterPlayerCommands';
```

Keyboard shortcuts were refactored to dispatch through this bus (`hooks/useKeyboardShortcuts.ts`). Add new transport features by extending `PlayerCommandId` and registering a handler.
