# Channel Mute/Solo Controls - Implementation Summary

## Overview
Implemented per-channel mute and solo functionality with keyboard shortcuts and visual feedback.

---

## Files Modified

### 1. types.ts
**Added:** `_openmpt_module_set_channel_mute` to LibOpenMPT interface

```typescript
_openmpt_module_set_channel_mute: (
  modPtr: number,
  channel: number,
  mute: number  // 0 = unmuted, 1 = muted
) => void;
```

---

### 2. hooks/useLibOpenMPT.ts

**Added state tracking:**
```typescript
const mutedChannelsRef = useRef<boolean[]>([]);
```

**Added functions:**

#### `muteChannel(channel: number, muted: boolean)`
- Toggles mute state for a specific channel
- Calls `_openmpt_module_set_channel_mute` to update libopenmpt
- Updates local `mutedChannelsRef` for UI state
- Updates `channelStatesRef` for GPU visualization

#### `soloChannel(channel: number)`
- Mutes all channels except the selected one
- If channel is already soloed, unmutes all (toggle behavior)
- Uses `_openmpt_module_set_channel_mute` for each channel

#### `isChannelMuted(channel: number): boolean`
- Returns current mute state for a channel

**Added to return object:**
```typescript
return {
  // ... existing exports
  muteChannel,
  soloChannel,
  isChannelMuted
};
```

---

### 3. components/ChannelMeters.tsx (REWRITTEN)

**New props:**
```typescript
interface ChannelMetersProps {
  numChannels: number;
  levels: number[];
  peaks?: number[];
  mutedChannels?: boolean[];
  onMuteChannel?: (channel: number, muted: boolean) => void;
  onSoloChannel?: (channel: number) => void;
}
```

**New UI elements per channel:**
- **M button:** Toggle mute (red when muted, gray when unmuted)
- **S button:** Solo channel
- **Visual dimming:** Muted channels shown at 40% opacity with grayed-out meters
- **Transition effects:** Smooth opacity and color transitions

**Visual feedback:**
- Muted channels: 40% opacity, gray meter bars, dimmed labels
- Active channels: Full opacity, green meter bars
- Peak indicators hidden for muted channels

---

### 4. hooks/useKeyboardShortcuts.ts

**Added actions:**
```typescript
interface KeyboardShortcutActions {
  // ... existing actions
  onMuteChannel?: (channel: number) => void;
  onSoloChannel?: (channel: number) => void;
}
```

**New keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `1-9` | Toggle mute on channels 1-9 |
| `Shift+1-9` | Solo channel 1-9 |
| `Shift+M` | Mute all channels (emergency mute) |

---

## Usage Example

### In parent component:

```tsx
import { useLibOpenMPT } from './hooks/useLibOpenMPT';
import { ChannelMeters } from './components/ChannelMeters';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

function Player() {
  const {
    channelStates,
    muteChannel,
    soloChannel,
    isChannelMuted,
    // ... other exports
  } = useLibOpenMPT();

  // Build muted channels array for UI
  const mutedChannels = useMemo(() => {
    return channelStates.map(ch => ch?.isMuted === 1);
  }, [channelStates]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onPlayPause: () => {},
    onStop: () => {},
    // ... other actions
    onMuteChannel: (ch) => muteChannel(ch, !isChannelMuted(ch)),
    onSoloChannel: soloChannel,
  });

  return (
    <ChannelMeters
      numChannels={channelStates.length}
      levels={channelStates.map(ch => ch?.volume ?? 0)}
      mutedChannels={mutedChannels}
      onMuteChannel={muteChannel}
      onSoloChannel={soloChannel}
    />
  );
}
```

---

## GPU Integration

The mute state flows to WebGPU shaders via `ChannelShadowState`:

```typescript
export interface ChannelShadowState {
  // ... other fields
  isMuted: number;  // 0 = active, 1 = muted
}
```

Shaders can dim muted channels:
```wgsl
let ch = channels[in.channel];
if (ch.isMuted == 1u) {
  // Dim this channel's visualization
  finalColor *= 0.3;
}
```

---

## libopenmpt Integration

The implementation uses libopenmpt's native channel muting:

```typescript
// Mute a channel (stops audio output)
lib._openmpt_module_set_channel_mute(modPtr, channel, 1);

// Unmute a channel (restores audio output)
lib._openmpt_module_set_channel_mute(modPtr, channel, 0);
```

This is more efficient than gain-based muting as it prevents processing of muted channels.

---

## Solo Behavior

Solo works by muting all other channels:

```
Solo Channel 3:
  Channel 1: Muted
  Channel 2: Muted
  Channel 3: Active (soloed)
  Channel 4: Muted
  ...

Press Solo on Channel 3 again:
  All channels: Unmuted (solo released)
```

---

## Testing Checklist

- [ ] Click M button toggles mute
- [ ] Click S button solos channel (mutes others)
- [ ] Click S on soloed channel releases solo
- [ ] Muted channels visually dimmed
- [ ] Keys 1-9 toggle mute
- [ ] Shift+1-9 toggles solo
- [ ] Shift+M mutes all
- [ ] Audio output muted in libopenmpt
- [ ] GPU visualization dims muted channels
- [ ] Mute state persists during playback
- [ ] Mute state cleared on new module load

---

## Future Enhancements

1. **Master mute button:** Mute all channels at once
2. **Mute groups:** Group channels for collective mute
3. **Solo multiple:** Ctrl+click to solo multiple channels
4. **Visual indicators:** Show mute state in pattern display
5. **Automation:** Record/playback mute automation
