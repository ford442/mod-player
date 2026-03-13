# Full Module Metadata Panel - Implementation Summary

## Overview
Enhanced the metadata system to expose full libopenmpt metadata API with instrument/sample browser and order list.

---

## Files Modified

### 1. types.ts

**Added libopenmpt functions to LibOpenMPT interface:**
```typescript
_openmpt_module_get_num_instruments: (modPtr: number) => number;
_openmpt_module_get_instrument_name: (modPtr: number, index: number) => number;
_openmpt_module_get_num_samples: (modPtr: number) => number;
_openmpt_module_get_sample_name: (modPtr: number, index: number) => number;
```

**Updated ModuleMetadata interface:**
```typescript
export interface ModuleMetadata {
  title: string;
  artist: string;
  tracker: string;
  numChannels: number;
  numOrders: number;
  numPatterns: number;
  numInstruments: number;
  numSamples: number;        // NEW
  durationSeconds: number;
  currentBpm: number;
  instruments: string[];
  samples: string[];         // NEW
  format: string;            // NEW (XM/IT/S3M/MOD)
  comments: string;          // NEW (module message)
  orderList: number[];       // NEW (pattern sequence)
}
```

---

### 2. hooks/useLibOpenMPT.ts

**Added state:**
```typescript
const [moduleMetadata, setModuleMetadata] = useState<ModuleMetadata | null>(null);
```

**Enhanced metadata extraction in processModuleData():**
```typescript
// Read all metadata fields
const title = getMetadata("title");
const artist = getMetadata("artist");
const tracker = getMetadata("tracker");
const type = getMetadata("type");        // Format type
const comments = getMetadata("message"); // Module comments

// Get instrument and sample counts
const numInstruments = lib._openmpt_module_get_num_instruments(modPtr);
const numSamples = lib._openmpt_module_get_num_samples(modPtr);

// Read instrument names
const instruments: string[] = [];
for (let i = 0; i < numInstruments; i++) {
  const namePtr = lib._openmpt_module_get_instrument_name(modPtr, i);
  instruments.push(lib.UTF8ToString(namePtr));
}

// Read sample names
const samples: string[] = [];
for (let i = 0; i < numSamples; i++) {
  const namePtr = lib._openmpt_module_get_sample_name(modPtr, i);
  samples.push(lib.UTF8ToString(namePtr));
}

// Build order list
const orderList: number[] = [];
for (let i = 0; i < numOrders; i++) {
  orderList.push(lib._openmpt_module_get_order_pattern(modPtr, i));
}
```

**Exported in return object:**
```typescript
return {
  // ... other exports
  moduleMetadata,
  // ...
};
```

---

### 3. components/MetadataPanel.tsx (NEW)

Tabbed metadata panel with four sections:

#### Tabs:
1. **Info** - General module information
2. **Instruments** - List of all instruments with names
3. **Samples** - List of all samples with names
4. **Order List** - Pattern sequence with current position highlighted

#### Features:
- **Format badge** - Color-coded by format (XM=purple, IT=blue, S3M=green, MOD=orange)
- **Scrolling metadata** - Personal notes from sample names and comments
- **Order highlighting** - Current pattern shown with pulsing indicator
- **Responsive design** - Tailwind-styled dark UI

---

### 4. components/MetadataOverlay.tsx (NEW)

Scrolling text overlay designed for center of round shaders:

**Features:**
- Circular mask matching shader shape
- Auto-scrolling text animation
- Displays: Title, artist, format, samples, instruments, comments
- Fades at top/bottom for smooth scroll
- Glowing cyan text effect

**Usage in shader layouts:**
```tsx
<div className="relative w-full h-full">
  {/* Shader canvas */}
  <canvas className="absolute inset-0" />
  
  {/* Metadata overlay in center */}
  <MetadataOverlay 
    metadata={moduleMetadata}
    currentOrder={moduleInfo.order}
    isPlaying={isPlaying}
  />
</div>
```

---

## Usage Example

```tsx
import { useLibOpenMPT } from './hooks/useLibOpenMPT';
import { MetadataPanel } from './components/MetadataPanel';
import { MetadataOverlay } from './components/MetadataOverlay';

function Player() {
  const {
    moduleMetadata,
    moduleInfo,
    isPlaying,
    // ... other exports
  } = useLibOpenMPT();

  return (
    <div className="flex h-screen">
      {/* Shader display */}
      <div className="flex-1 relative">
        <ShaderCanvas />
        
        {/* Centered scrolling metadata */}
        <MetadataOverlay
          metadata={moduleMetadata}
          currentOrder={moduleInfo.order}
          isPlaying={isPlaying}
        />
      </div>
      
      {/* Side panel */}
      <div className="w-80">
        <MetadataPanel
          metadata={moduleMetadata}
          currentOrder={moduleInfo.order}
          isPlaying={isPlaying}
        />
      </div>
    </div>
  );
}
```

---

## Data Flow

```
Module Load
    ↓
processModuleData()
    ↓
Extract metadata via libopenmpt:
  - get_metadata(keys: title, artist, tracker, type, message)
  - get_num_instruments + get_instrument_name
  - get_num_samples + get_sample_name
  - Build orderList from get_order_pattern
    ↓
setModuleMetadata()
    ↓
MetadataPanel displays tabbed view
MetadataOverlay shows scrolling text
```

---

## libopenmpt API Reference

| Function | Purpose |
|----------|---------|
| `_openmpt_module_get_metadata(mod, key)` | Get string metadata (title, artist, type, message) |
| `_openmpt_module_get_num_instruments(mod)` | Count instruments |
| `_openmpt_module_get_instrument_name(mod, idx)` | Get instrument name |
| `_openmpt_module_get_num_samples(mod)` | Count samples |
| `_openmpt_module_get_sample_name(mod, idx)` | Get sample name |
| `_openmpt_module_get_order_pattern(mod, order)` | Get pattern index for order position |

---

## Styling

All components use Tailwind CSS with dark theme:

```css
/* Panel background */
bg-gray-900/90 backdrop-blur-sm

/* Active tab */
bg-cyan-500/20 text-cyan-400 border-cyan-400

/* Format badges */
XM: bg-purple-600
IT: bg-blue-600
S3M: bg-green-600
MOD: bg-orange-600

/* Text colors */
Title: text-cyan-400
Data: text-cyan-400 font-mono
Labels: text-gray-500
```

---

## Testing Checklist

- [ ] Metadata loads for XM/IT/S3M/MOD files
- [ ] Format badge shows correct color
- [ ] Instruments tab lists all instruments
- [ ] Samples tab lists all samples
- [ ] Order list shows pattern sequence
- [ ] Current order highlighted
- [ ] Scrolling overlay displays metadata
- [ ] Comments/message display properly
- [ ] Long sample names truncate with ellipsis
- [ ] Dark theme matches existing UI
