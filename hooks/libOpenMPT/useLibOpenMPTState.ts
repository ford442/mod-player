import { useState } from 'react';
import type { ChannelShadowState, ModuleInfo, PatternMatrix, SyncDebugInfo } from '../../types';
import { emptyInstrumentTable } from '../../types/instruments';
import type { InstrumentTable } from '../../types/instruments';

export function useLibOpenMPTState(initialVolume: number) {
  const [status, setStatus] = useState<string>('Initializing...');
  const [isReady, setIsReady] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isModuleLoaded, setIsModuleLoaded] = useState<boolean>(false);
  const [moduleInfo, setModuleInfo] = useState<ModuleInfo>({
    title: 'None',
    order: 0,
    row: 0,
    bpm: 125,
    numChannels: 0,
  });
  const [patternData, _setPatternData] = useState<Uint8Array | null>(null);
  const [sequencerMatrix, setSequencerMatrix] = useState<PatternMatrix | null>(null);
  const [instrumentNames, setInstrumentNames] = useState<string[]>([]);
  const [sampleNames, setSampleNames] = useState<string[]>([]);
  const [moduleFormat, setModuleFormat] = useState<string>('');
  const [instrumentTable, setInstrumentTable] = useState<InstrumentTable>(emptyInstrumentTable());
  const [moduleComments, setModuleComments] = useState<string>('');
  const [moduleDurationSeconds, setModuleDurationSeconds] = useState<number>(0);
  const [moduleFileName, setModuleFileName] = useState<string>('');
  const [sequencerCurrentRow, setSequencerCurrentRow] = useState<number>(0);
  const [sequencerGlobalRow, setSequencerGlobalRow] = useState<number>(0);
  const [playbackSeconds, setPlaybackSeconds] = useState<number>(0);
  const [playbackRowFraction, setPlaybackRowFraction] = useState<number>(0);
  const [totalPatternRows, setTotalPatternRows] = useState<number>(0);
  const [channelStates, setChannelStates] = useState<ChannelShadowState[]>([]);
  const [beatPhase, setBeatPhase] = useState<number>(0);
  const [grooveAmount, _setGrooveAmount] = useState<number>(0);
  const [kickTrigger, _setKickTrigger] = useState<number>(0);
  const [activeChannels, _setActiveChannels] = useState<number[]>([]);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [panValue, setPanValue] = useState<number>(0);
  const [volume, _setVolume] = useState<number>(initialVolume);
  const [activeEngine, setActiveEngine] = useState<'worklet' | 'native-worklet'>('worklet');
  const [isWorkletSupported, setIsWorkletSupported] = useState<boolean>(false);
  const [isNativeWorkletAvailable, setIsNativeWorkletAvailable] = useState<boolean>(false);
  const [restartPlayback, setRestartPlayback] = useState<boolean>(false);
  const [syncDebug, setSyncDebug] = useState<SyncDebugInfo>({
    mode: 'none',
    bufferMs: 0,
    driftMs: 0,
    row: 0,
    starvationCount: 0,
    audioContextState: 'none',
    sampleRate: 0,
    baseLatency: 0,
    outputLatency: 0,
    workletSupported: typeof AudioWorklet !== 'undefined',
    wasmSupported: typeof WebAssembly !== 'undefined',
    driftAccumulator: 0,
    lastCorrectedTime: 0,
    lastWorkletUpdate: 0,
    seekPending: false,
    bufferHealth: 0,
  });
  const [workletLoadError, setWorkletLoadError] = useState<string | null>(null);

  return {
    status,
    setStatus,
    isReady,
    setIsReady,
    isPlaying,
    setIsPlaying,
    isModuleLoaded,
    setIsModuleLoaded,
    moduleInfo,
    setModuleInfo,
    patternData,
    sequencerMatrix,
    setSequencerMatrix,
    instrumentNames,
    setInstrumentNames,
    sampleNames,
    setSampleNames,
    moduleFormat,
    setModuleFormat,
    instrumentTable,
    setInstrumentTable,
    moduleComments,
    setModuleComments,
    moduleDurationSeconds,
    setModuleDurationSeconds,
    moduleFileName,
    setModuleFileName,
    sequencerCurrentRow,
    setSequencerCurrentRow,
    sequencerGlobalRow,
    setSequencerGlobalRow,
    playbackSeconds,
    setPlaybackSeconds,
    playbackRowFraction,
    setPlaybackRowFraction,
    totalPatternRows,
    setTotalPatternRows,
    channelStates,
    setChannelStates,
    beatPhase,
    setBeatPhase,
    grooveAmount,
    kickTrigger,
    activeChannels,
    isLooping,
    setIsLooping,
    panValue,
    setPanValue,
    volume,
    _setVolume,
    activeEngine,
    setActiveEngine,
    isWorkletSupported,
    setIsWorkletSupported,
    isNativeWorkletAvailable,
    setIsNativeWorkletAvailable,
    restartPlayback,
    setRestartPlayback,
    syncDebug,
    setSyncDebug,
    workletLoadError,
    setWorkletLoadError,
  };
}

export type LibOpenMPTState = ReturnType<typeof useLibOpenMPTState>;
