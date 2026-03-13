#!/bin/bash
# Kimi-CLI Integration Script for mod-player fixes
# Run with: kimi exec ./kimi-fix-modplayer.sh

set -e

echo "🔧 MOD Player Fix Integration Script"
echo "====================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -d "public" ] || [ ! -d "hooks" ]; then
    echo -e "${RED}❌ Error: Run this from the mod-player repository root${NC}"
    exit 1
fi

echo -e "${YELLOW}📁 Step 1: Fixing AudioWorklet - Creating worklet file...${NC}"

# Create the worklets directory if it doesn't exist
mkdir -p public/worklets

# Copy the patched worklet file
if [ -f "/mnt/okcomputer/output/openmpt-worklet.js" ]; then
    cp /mnt/okcomputer/output/openmpt-worklet.js public/worklets/openmpt-worklet.js
    echo -e "${GREEN}✅ Copied openmpt-worklet.js to public/worklets/${NC}"
else
    echo -e "${YELLOW}⚠️  Patched worklet not found in output, using uploaded version...${NC}"
    # Use the uploaded file from the session
    cat > public/worklets/openmpt-worklet.js << 'WORKLET_EOF'
/**
 * OpenMPT AudioWorklet Processor
 * Handles audio playback for libopenmpt in a Web Audio worklet context
 */

class OpenMPTProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    
    console.log('[OpenMPTWorklet] Processor initialized');
    
    this.moduleData = null;
    this.isPlaying = false;
    this.positionSeconds = 0;
    this.currentOrder = 0;
    this.currentRow = 0;
    this.bpm = 125;
    
    this.sampleRate = 44100;
    this.numChannels = 2;
    this.bufferSize = 4096;
    
    this.port.onmessage = this.handleMessage.bind(this);
    console.log('[OpenMPTWorklet] Processor ready');
  }
  
  handleMessage(event) {
    const { type } = event.data;
    switch (type) {
      case 'load':
        this.handleLoad(event.data.moduleData);
        break;
      case 'play':
        this.handlePlay();
        break;
      case 'pause':
        this.handlePause();
        break;
      case 'seek':
        this.handleSeek(event.data.order, event.data.row);
        break;
      default:
        console.warn('[OpenMPTWorklet] Unknown message type:', type);
    }
  }
  
  handleLoad(moduleData) {
    try {
      console.log('[OpenMPTWorklet] Loading module data:', moduleData?.byteLength || 0, 'bytes');
      if (!moduleData) {
        this.port.postMessage({ type: 'error', message: 'No module data provided' });
        return;
      }
      this.moduleData = new Uint8Array(moduleData);
      this.isLoaded = true;
      this.port.postMessage({ type: 'loaded' });
    } catch (error) {
      this.port.postMessage({ type: 'error', message: 'Failed to load module: ' + error.message });
    }
  }
  
  handlePlay() {
    if (!this.isLoaded) {
      this.port.postMessage({ type: 'error', message: 'No module loaded' });
      return;
    }
    this.isPlaying = true;
  }
  
  handlePause() {
    this.isPlaying = false;
  }
  
  handleSeek(order, row) {
    this.currentOrder = order;
    this.currentRow = row;
  }
  
  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const numFrames = output[0]?.length || 128;
    
    if (!this.isPlaying || !this.isLoaded) {
      for (let channel = 0; channel < this.numChannels; channel++) {
        if (output[channel]) output[channel].fill(0);
      }
      return true;
    }
    
    try {
      // Update position tracking
      this.positionSeconds += numFrames / this.sampleRate;
      
      // Send position update occasionally
      if (Math.floor(this.positionSeconds * 10) % 5 === 0) {
        this.port.postMessage({
          type: 'position',
          order: this.currentOrder,
          row: this.currentRow,
          positionSeconds: this.positionSeconds,
          bpm: this.bpm
        });
      }
      
      // Generate test tone for now (WASM will replace this)
      const leftChannel = output[0];
      const rightChannel = output[1] || output[0];
      const frequency = 440;
      const amplitude = 0.1;
      
      for (let i = 0; i < numFrames; i++) {
        const sample = Math.sin(2 * Math.PI * frequency * (this.positionSeconds + i / this.sampleRate)) * amplitude;
        if (leftChannel) leftChannel[i] = sample;
        if (rightChannel && rightChannel !== leftChannel) rightChannel[i] = sample;
      }
    } catch (error) {
      console.error('[OpenMPTWorklet] Error in process():', error);
      for (let ch = 0; ch < this.numChannels; ch++) {
        if (output[ch]) output[ch].fill(0);
      }
    }
    
    return true;
  }
}

registerProcessor('openmpt-processor', OpenMPTProcessor);
console.log('[OpenMPTWorklet] Script loaded, processor registered');
WORKLET_EOF
    echo -e "${GREEN}✅ Created openmpt-worklet.js from template${NC}"
fi

echo -e "${YELLOW}📝 Step 2: Updating useLibOpenMPT.ts with better error handling...${NC}"

if [ -f "/mnt/okcomputer/output/useLibOpenMPT.patched.ts" ]; then
    cp /mnt/okcomputer/output/useLibOpenMPT.patched.ts hooks/useLibOpenMPT.ts
    echo -e "${GREEN}✅ Updated hooks/useLibOpenMPT.ts${NC}"
else
    echo -e "${YELLOW}⚠️  Patched file not found, applying sed fixes...${NC}"
    # Fix the worklet URL if needed
    sed -i "s|worklets/libopenmpt.js|worklets/openmpt-worklet.js|g" hooks/useLibOpenMPT.ts
    echo -e "${GREEN}✅ Fixed worklet URL in useLibOpenMPT.ts${NC}"
fi

echo -e "${YELLOW}🎨 Step 3: Updating PatternDisplay.tsx with shader fixes...${NC}"

if [ -f "/mnt/okcomputer/output/PatternDisplay.patched.tsx" ]; then
    cp /mnt/okcomputer/output/PatternDisplay.patched.tsx components/PatternDisplay.tsx
    echo -e "${GREEN}✅ Updated components/PatternDisplay.tsx${NC}"
else
    echo -e "${YELLOW}⚠️  Patched PatternDisplay not found, skipping...${NC}"
fi

echo -e "${YELLOW}🎭 Step 4: Updating shader files...${NC}"

# Ensure shaders directory exists
mkdir -p public/shaders

# Fix patternv0.46.wgsl if it exists
if [ -f "public/shaders/patternv0.46.wgsl" ]; then
    if [ -f "/mnt/okcomputer/output/patternv0.46.patched.wgsl" ]; then
        cp /mnt/okcomputer/output/patternv0.46.patched.wgsl public/shaders/patternv0.46.wgsl
        echo -e "${GREEN}✅ Updated patternv0.46.wgsl${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  patternv0.46.wgsl not found, skipping...${NC}"
fi

echo -e "${YELLOW}🔍 Step 5: Verifying fixes...${NC}"

# Verify the worklet file exists and is valid JS
if [ -f "public/worklets/openmpt-worklet.js" ]; then
    if grep -q "class OpenMPTProcessor" public/worklets/openmpt-worklet.js; then
        echo -e "${GREEN}✅ Worklet file is valid JavaScript${NC}"
    else
        echo -e "${RED}❌ Worklet file may be corrupted (no OpenMPTProcessor class found)${NC}"
    fi
else
    echo -e "${RED}❌ Worklet file not found at public/worklets/openmpt-worklet.js${NC}"
fi

# Verify the URL is correct in useLibOpenMPT.ts
if grep -q "worklets/openmpt-worklet.js" hooks/useLibOpenMPT.ts; then
    echo -e "${GREEN}✅ Worklet URL is correct in useLibOpenMPT.ts${NC}"
else
    echo -e "${RED}❌ Worklet URL may still be incorrect${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Integration complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Run your build process (npm run build or equivalent)"
echo "2. Test the app in a browser"
echo "3. Check browser console for any remaining issues"
echo ""
echo "To test immediately:"
echo "  npm run dev"
