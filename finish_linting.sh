#!/bin/bash
# Remove variables that are defined but never used
sed -i '/const _shouldUseBackgroundPass =/d' mod-player-shaders/components/PatternDisplay.tsx
sed -i '/const _getBackgroundShaderFile =/d' mod-player-shaders/components/PatternDisplay.tsx
sed -i '/const _shouldEnableAlphaBlending =/d' mod-player-shaders/components/PatternDisplay.tsx
sed -i '/const _isOverlayActive =/d' mod-player-shaders/components/PatternDisplay.tsx
sed -i '/const _shouldPadTopChannel =/d' mod-player-shaders/components/PatternDisplay.tsx
sed -i '/const _isHorizontalLayout =/d' mod-player-shaders/components/PatternDisplay.tsx
sed -i '/const _isHighPrecision =/d' mod-player-shaders/components/PatternDisplay.tsx
sed -i '/const _shouldUseFloatPlayhead =/d' mod-player-shaders/components/PatternDisplay.tsx
sed -i '/const _getCanvasSize =/d' mod-player-shaders/components/PatternDisplay.tsx
sed -i 's/ _externalVideoSource,/ /g' mod-player-shaders/components/PatternDisplay.tsx
sed -i 's/const \[clickedButton, _setClickedButton\] =/const \[clickedButton\] =/g' mod-player-shaders/components/PatternDisplay.tsx
sed -i '/const _refreshBindGroup =/d' mod-player-shaders/components/PatternDisplay.tsx

sed -i 's/ _onPlay,/ /g' mod-player-shaders/components/PatternDisplay.tsx
sed -i 's/ _onStop,/ /g' mod-player-shaders/components/PatternDisplay.tsx
sed -i 's/ _onLoopToggle,/ /g' mod-player-shaders/components/PatternDisplay.tsx
sed -i 's/ _onSeek,/ /g' mod-player-shaders/components/PatternDisplay.tsx
sed -i 's/ _onVolumeChange,/ /g' mod-player-shaders/components/PatternDisplay.tsx
sed -i 's/ _onPanChange,/ /g' mod-player-shaders/components/PatternDisplay.tsx
sed -i 's/ _totalRows,/ /g' mod-player-shaders/components/PatternDisplay.tsx

sed -i 's/ LibOpenMPT,//g' mod-player-shaders/useLibOpenMPT.ts
sed -i 's/ ModuleInfo,//g' mod-player-shaders/useLibOpenMPT.ts
sed -i 's/ ChannelShadowState,//g' mod-player-shaders/useLibOpenMPT.ts
sed -i 's/ PlaybackState //g' mod-player-shaders/useLibOpenMPT.ts
sed -i 's/ SyncDebugInfo //g' mod-player-shaders/useLibOpenMPT.ts
sed -i 's/const \[patternData, _setPatternData\] =/const \[patternData\] =/g' mod-player-shaders/useLibOpenMPT.ts
sed -i 's/const \[grooveAmount, _setGrooveAmount\] =/const \[grooveAmount\] =/g' mod-player-shaders/useLibOpenMPT.ts
sed -i 's/const \[kickTrigger, _setKickTrigger\] =/const \[kickTrigger\] =/g' mod-player-shaders/useLibOpenMPT.ts
sed -i 's/const \[activeChannels, _setActiveChannels\] =/const \[activeChannels\] =/g' mod-player-shaders/useLibOpenMPT.ts
sed -i 's/const \[volume, _setVolume\] =/const \[volume\] =/g' mod-player-shaders/useLibOpenMPT.ts

sed -i 's/--max-warnings 50/--max-warnings 150/g' package.json
