# Time Display and Pattern Navigation - Implementation Summary

## Overview
Added elapsed time / duration display and pattern navigation functionality with keyboard shortcuts.

---

## Files Modified

### 1. types.ts
**Added:** `_openmpt_module_get_duration_seconds` to LibOpenMPT interface

```typescript
_openmpt_module_get_duration_seconds: (modPtr: number) => number;
```

---

### 2. hooks/useLibOpenMPT.ts

**Added state:**
```typescript
const [durationSeconds, setDurationSeconds] = useState(0);
```

**Added functions:**

#### `goToPattern(orderIndex: number)`
- Jumps to the start of a specific pattern by order index
- Clamps to valid range [0, numOrders-1]
- Updates UI state and worklet refs
- Logs navigation event

#### `previousPattern()`
- Navigates to previous pattern in sequence
- Calls `goToPattern(currentOrder - 1)`

#### `nextPattern()`
- Navigates to next pattern in sequence
- Calls `goToPattern(currentOrder + 1)`

**Updated:**
- `processModuleData()` now extracts duration using `_openmpt_module_get_duration_seconds`
- Return object includes `durationSeconds` and navigation functions

**Added to return object:**
```typescript
return {
  // ... existing exports
  durationSeconds,
  previousPattern,
  nextPattern,
  goToPattern
};
```

---

### 3. hooks/useKeyboardShortcuts.ts

**Added actions:**
```typescript
interface KeyboardShortcutActions {
  // ... existing actions
  onPreviousPattern?: () => void;
  onNextPattern?: () => void;
}
```

**Updated keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `←` | Previous Pattern |
| `→` | Next Pattern |
| `Ctrl/Cmd + ←` | Seek backward (within pattern) |
| `Ctrl/Cmd + →` | Seek forward (within pattern) |

**Note:** Previous track navigation moved to `Shift + ←/→` or can be handled by `onPrevTrack`/`onNextTrack`

---

### 4. components/Controls.tsx (NEW)

**Features:**
- **Time Display:** Shows `MM:SS / MM:SS` format (elapsed / duration)
- **Progress Bar:** Visual indicator of playback position
- **Pattern Navigation Buttons:** PREV and NEXT buttons
- **Play/Stop Button:** Large central control
- **Pattern Indicator:** Shows current pattern number and total
- **Loop Toggle:** Button to toggle looping
- **Keyboard Shortcuts Hint:** Shows available shortcuts

**Props:**
```typescript
interface ControlsProps {
  isPlaying: boolean;
  isModuleLoaded: boolean;
  playbackSeconds: number;
  durationSeconds: number;
  currentOrder: number;
  numOrders: number;
  onPlay: () => void;
  onStop: () => void;
  onPreviousPattern: () => void;
  onNextPattern: () => void;
  onToggleLoop: () => void;
  isLooping: boolean;
}
```

**Helper function:**
```typescript
formatTime(seconds: number) => "MM:SS"
```

---

## Usage Example

```tsx
import { useLibOpenMPT } from './hooks/useLibOpenMPT';
import { Controls } from './components/Controls';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

function Player() {
  const {
    isPlaying,
    isModuleLoaded,
    playbackSeconds,
    durationSeconds,
    moduleInfo,
    play,
    stopMusic,
    previousPattern,
    nextPattern,
    setIsLooping,
    isLooping,
    // ... other exports
  } = useLibOpenMPT();

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onPlayPause: isPlaying ? stopMusic : play,
    onStop: stopMusic,
    onPreviousPattern: previousPattern,
    onNextPattern: nextPattern,
    onToggleLoop: () => setIsLooping(!isLooping),
    // ... other actions
  });

  return (
    <Controls
      isPlaying={isPlaying}
      isModuleLoaded={isModuleLoaded}
      playbackSeconds={playbackSeconds}
      durationSeconds={durationSeconds}
      currentOrder={moduleInfo.order}
      numOrders={/* from your order count */}
      onPlay={play}
      onStop={stopMusic}
      onPreviousPattern={previousPattern}
      onNextPattern={nextPattern}
      onToggleLoop={() => setIsLooping(!isLooping)}
      isLooping={isLooping}
    />
  );
}
```

---

## Keyboard Shortcuts Reference

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` | Previous Pattern |
| `→` | Next Pattern |
| `Ctrl/Cmd + ←` | Seek backward |
| `Ctrl/Cmd + →` | Seek forward |
| `↑` | Volume up |
| `↓` | Volume down |
| `L` | Toggle loop |
| `F` | Toggle fullscreen |
| `1-9` | Toggle mute channel 1-9 |
| `Shift + 1-9` | Solo channel 1-9 |
| `Escape` | Stop |

---

## Data Flow

```
User presses → key
    ↓
onNextPattern callback
    ↓
nextPattern() in useLibOpenMPT
    ↓
goToPattern(currentOrder + 1)
    ↓
_libopenmpt_module_set_position_order_row(modPtr, newOrder, 0)
    ↓
Playback jumps to start of next pattern
    ↓
UI updates: moduleInfo.order, sequencerMatrix, etc.
```

---

## Testing Checklist

- [ ] Time display shows correct MM:SS format
- [ ] Duration extracted correctly from module
- [ ] Progress bar updates during playback
- [ ] Previous Pattern button works
- [ ] Next Pattern button works
- [ ] Buttons disabled when at first/last pattern
- [ ] ← key navigates to previous pattern
- [ ] → key navigates to next pattern
- [ ] Ctrl+← seeks backward within pattern
- [ ] Ctrl+→ seeks forward within pattern
- [ ] Pattern indicator shows correct number
- [ ] Navigation logged to console

---

## Future Enhancements

1. **Pattern list view:** Show all patterns with clickable thumbnails
2. **Bookmark patterns:** Mark frequently accessed patterns
3. **Pattern names:** Display pattern names if available in module
4. **Seamless transitions:** Crossfade between patterns
5. **Pattern loop points:** Loop within a pattern section
6. **Time remaining:** Show countdown instead of elapsed

---

## libopenmpt Integration

The implementation uses libopenmpt's native functions:

```typescript
// Get total duration
const duration = lib._openmpt_module_get_duration_seconds(modPtr);

// Get current position
const position = lib._openmpt_module_get_position_seconds(modPtr);

// Jump to pattern
lib._openmpt_module_set_position_order_row(modPtr, orderIndex, row);
```
